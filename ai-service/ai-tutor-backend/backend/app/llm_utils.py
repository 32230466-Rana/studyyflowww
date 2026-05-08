import json
import logging
import os
import re
from typing import Any

from openai import OpenAI
from app.crud import get_chapter_by_id, save_questions_for_chapter

logger = logging.getLogger(__name__)

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY", "ollama"),
    base_url=os.getenv("OPENAI_BASE_URL", "http://localhost:11434/v1"),
)

QUIZ_MODEL = os.getenv("OPENAI_MODEL", "llama3.2:3b")

TARGET_TOTAL = 5
TARGET_HARD = 3
TARGET_MEDIUM = 2

# FAST MODE SETTINGS
# Keep these small for 8GB RAM / local Ollama.
MAX_CHAPTER_CHARS = int(os.getenv("QUIZ_MAX_CHAPTER_CHARS", "3200"))
CANDIDATE_COUNT = int(os.getenv("QUIZ_CANDIDATE_COUNT", "8"))
FIRST_PASS_TOKENS = int(os.getenv("QUIZ_MAX_TOKENS", "1100"))


# =========================================================
# CLEANING + JSON PARSING
# =========================================================

def _clean_llm_text(text: str) -> str:
    if not text:
        return ""

    text = str(text).strip()
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)

    match = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if match:
        text = match.group(1).strip()

    text = text.replace("```json", "").replace("```", "").strip()
    return text


def _extract_complete_objects(text: str) -> list[dict]:
    text = _clean_llm_text(text)

    objects: list[str] = []
    start = None
    depth = 0
    in_string = False
    escape = False

    for i, ch in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue

        if ch == "{":
            if depth == 0:
                start = i
            depth += 1

        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start is not None:
                    objects.append(text[start:i + 1])
                    start = None

    parsed: list[dict] = []

    for obj in objects:
        if '"question"' not in obj:
            continue

        obj = re.sub(r",\s*}", "}", obj.strip())
        obj = re.sub(r",\s*]", "]", obj)

        try:
            item = json.loads(obj)
            if isinstance(item, dict):
                parsed.append(item)
        except Exception:
            continue

    return parsed


def _parse_llm_json(text: str) -> list:
    text = _clean_llm_text(text)
    parsed: Any = None

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None

    if parsed is None:
        object_match = re.search(r"\{.*\}", text, re.DOTALL)
        if object_match:
            try:
                parsed = json.loads(object_match.group(0))
            except json.JSONDecodeError:
                parsed = None

    if parsed is None:
        array_match = re.search(r"\[.*\]", text, re.DOTALL)
        if array_match:
            try:
                parsed = json.loads(array_match.group(0))
            except json.JSONDecodeError:
                parsed = None

    if isinstance(parsed, dict) and "questions" in parsed:
        parsed = parsed["questions"]

    if isinstance(parsed, list):
        return parsed

    salvaged = _extract_complete_objects(text)
    if salvaged:
        return salvaged

    raise ValueError("LLM response is not valid JSON and no valid question objects could be salvaged.")


# =========================================================
# GENERIC SOURCE SAFETY HELPERS
# No PDF-specific hardcoded answers.
# =========================================================

def _clean_part(text: str) -> str:
    text = str(text or "").replace("\x00", " ").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def _words_key(text: str) -> set[str]:
    stop_words = {
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
        "is", "are", "was", "were", "as", "that", "which", "what", "when",
        "does", "do", "from", "into", "by", "it", "they", "them", "this",
        "these", "those", "be", "been", "being", "can", "could", "would",
        "should", "must", "may", "might", "will", "shall", "has", "have",
        "had", "not", "but", "than", "then", "also", "only", "such", "more",
        "most", "less", "between", "among", "through", "about", "their",
        "there", "where", "while", "during", "because", "therefore",
        "according", "chapter", "source", "text", "document", "material",
        "question", "answer", "option", "following", "best", "explain",
        "explains", "describe", "describes", "statement", "correct",
        "incorrect", "used", "use", "using", "based", "content",
    }

    words = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]+", str(text).lower())
    return {w for w in words if w not in stop_words and len(w) > 2}


def _source_support_score(text: str, source_context: str) -> float:
    words = _words_key(text)
    source_words = _words_key(source_context)

    if not words or not source_words:
        return 0.0

    return len(words & source_words) / max(1, len(words))


def _unsupported_word_ratio(text: str, source_context: str) -> float:
    words = _words_key(text)
    source_words = _words_key(source_context)

    if not words:
        return 0.0
    if not source_words:
        return 1.0

    return len(words - source_words) / max(1, len(words))


def _text_similarity(text1: str, text2: str) -> float:
    w1 = _words_key(text1)
    w2 = _words_key(text2)

    if not w1 or not w2:
        return 0.0

    return len(w1 & w2) / max(1, len(w1 | w2))


def _source_has_example_language(source_context: str) -> bool:
    source = str(source_context or "").lower()
    return any(marker in source for marker in ["example", "examples", "for example", "e.g.", "such as"])


def _source_has_reason_language(source_context: str) -> bool:
    source = str(source_context or "").lower()
    markers = [
        "because", "therefore", "so that", "in order to", "reason", "reasons",
        "important", "importance", "significant", "significance", "benefit",
        "advantage", "pros", "cons", "leads to", "results in", "causes",
        "effect", "consequence", "allows", "enables", "requires", "must",
        "helps", "enhances", "reduces", "simplify", "functionality",
        "dependency", "sequence", "before", "after",
    ]
    return any(marker in source for marker in markers)


def _question_is_source_safe(question: str, source_context: str) -> bool:
    q = _clean_part(question).lower()

    if not q:
        return False

    if ("provide an example" in q or "give an example" in q) and not _source_has_example_language(source_context):
        return False

    reason_words = [
        "why is", "why are", "why does", "why do", "important", "importance",
        "significant", "significance", "benefit", "advantage", "necessary",
        "assumption", "assumptions", "limitation", "limitations",
        "drawback", "drawbacks", "bias", "model architecture",
        "real-world", "real world",
    ]

    if any(word in q for word in reason_words) and not _source_has_reason_language(source_context):
        return False

    # Softer than old versions: do not reject too much.
    if _unsupported_word_ratio(question, source_context) > 0.72:
        return False

    if _source_support_score(question, source_context) < 0.04:
        return False

    return True


def _is_obvious_easy_recall(question: str) -> bool:
    q = _clean_part(question).lower()

    weak_starts = [
        "what is ",
        "what are ",
        "define ",
        "list ",
        "identify ",
        "which type",
        "what type",
        "which diagram",
        "which of the following",
    ]

    return any(q.startswith(pattern) for pattern in weak_starts)


def _is_hard_style_question(question: str, source_context: str) -> bool:
    q = _clean_part(question).lower()

    if _is_obvious_easy_recall(q):
        return False

    if not _question_is_source_safe(question, source_context):
        return False

    hard_markers = [
        "how does", "how do", "how would", "explain how",
        "compare", "contrast", "differ", "different", "difference",
        "relationship", "relates", "connected", "sequence", "order",
        "step", "process", "consequence", "effect", "result",
        "leads to", "best explains", "best describes how", "most accurate",
        "why does", "why would", "in what way",
    ]

    return any(marker in q for marker in hard_markers)


def _question_quality_score(question: str, answer: str, source_context: str) -> int:
    q = _clean_part(question)
    a = _clean_part(answer)
    q_low = q.lower()

    score = 0

    if _is_hard_style_question(q, source_context):
        score += 35
    elif _question_is_source_safe(q, source_context):
        score += 10

    if any(x in q_low for x in ["compare", "contrast", "differ", "difference"]):
        score += 12

    if any(x in q_low for x in ["relationship", "relates", "connected", "depends", "dependency"]):
        score += 10

    if any(x in q_low for x in ["sequence", "order", "step", "process", "before", "after"]):
        score += 8

    support = _source_support_score(f"{q} {a}", source_context)

    if support >= 0.25:
        score += 8
    elif support >= 0.12:
        score += 4
    else:
        score -= 5

    if not _question_is_source_safe(q, source_context):
        score -= 35

    if _is_obvious_easy_recall(q):
        score -= 8

    bad_visible = [
        "chapter", "textbook", "publisher", "copyright",
        "the document", "this document", "source material",
    ]

    if any(x in q_low for x in bad_visible):
        score -= 40

    return score


def _infer_difficulty(question: str, answer: str, source_context: str) -> str:
    if _is_hard_style_question(question, source_context):
        return "Hard"
    return "Medium"


def _is_duplicate_question(new_q: dict, selected: list[dict]) -> bool:
    """
    Generic duplicate / near-duplicate detector.

    This is stricter than the previous version because fast one-call generation
    can produce several questions about the same example/story using different wording.
    It does NOT use any PDF-specific facts.
    """
    new_question = _clean_part(new_q.get("question", ""))
    new_text = f"{new_q.get('question', '')} {new_q.get('answer', '')}"
    new_words = _words_key(new_question)

    for old in selected:
        old_question = _clean_part(old.get("question", ""))
        old_text = f"{old.get('question', '')} {old.get('answer', '')}"
        old_words = _words_key(old_question)

        # Direct semantic overlap.
        if _text_similarity(new_text, old_text) >= 0.55:
            return True

        # Question-only overlap catches repeats like:
        # "How does X relate to Y?" and "How does X's use of data relate to Y?"
        if _text_similarity(new_question, old_question) >= 0.40:
            return True

        if new_words and old_words:
            common = new_words & old_words
            smaller = min(len(new_words), len(old_words))

            # If two questions share most of their important words, treat them as the same topic.
            if smaller >= 5 and len(common) / smaller >= 0.55:
                return True

            # If they share many core content words, they are probably same-story duplicates.
            if len(common) >= 5:
                return True

    return False


# =========================================================
# SOURCE FACT FALLBACK - PYTHON ONLY, NO EXTRA LLM CALL
# =========================================================

def _source_fact_rows(source_context: str) -> list[str]:
    raw = str(source_context or "").replace("\x00", " ")
    raw = re.sub(r"[ \t]+", " ", raw)

    lines = []
    for raw_line in raw.splitlines():
        line = _clean_part(raw_line)
        if not line:
            continue

        low = line.lower()

        if any(noise in low for noise in ["copyright", "all rights reserved", "http://", "https://", "www."]):
            continue

        if re.fullmatch(r"\d{1,4}", line):
            continue

        if len(line) >= 8:
            lines.append(line)

    facts = []

    for line in lines:
        if 20 <= len(line) <= 320:
            facts.append(line)

    for i in range(len(lines) - 1):
        combined = _clean_part(f"{lines[i]} {lines[i + 1]}")
        if 35 <= len(combined) <= 380:
            facts.append(combined)

    for i in range(len(lines) - 2):
        combined = _clean_part(f"{lines[i]} {lines[i + 1]} {lines[i + 2]}")
        if 45 <= len(combined) <= 420:
            facts.append(combined)

    unique = []
    for fact in facts:
        fact = _clean_part(fact)
        if not fact:
            continue
        if any(_text_similarity(fact, old) >= 0.88 for old in unique):
            continue
        unique.append(fact)

    return unique


def _best_source_facts(question: str, source_context: str, max_facts: int = 2) -> list[str]:
    facts = _source_fact_rows(source_context)
    q_words = _words_key(question)

    scored = []
    for fact in facts:
        f_words = _words_key(fact)
        if not f_words:
            continue

        overlap = len(q_words & f_words) / max(1, len(q_words))
        support = _source_support_score(fact, source_context)
        score = overlap * 0.85 + support * 0.15
        scored.append((score, fact))

    scored.sort(key=lambda x: x[0], reverse=True)

    selected = []
    for score, fact in scored:
        if score < 0.07:
            continue
        if any(_text_similarity(fact, old) >= 0.72 for old in selected):
            continue
        selected.append(fact)
        if len(selected) >= max_facts:
            break

    return selected


def _make_source_answer(question: str, model_answer: str, source_context: str) -> str:
    answer = _clean_part(model_answer)

    # Keep the model answer if it looks source-related and not empty.
    # Slightly stricter than v1 so fluent but weakly supported answers are replaced
    # with source-fact fallback instead of being accepted.
    if (
        len(answer.split()) >= 10
        and _source_support_score(answer, source_context) >= 0.14
        and _unsupported_word_ratio(answer, source_context) <= 0.58
        and answer.lower() != _clean_part(question).lower()
    ):
        return answer

    facts = _best_source_facts(question, source_context, max_facts=2)
    if facts:
        joined = " ".join(facts)
        joined = _clean_part(joined)
        words = joined.split()
        if len(words) > 65:
            joined = " ".join(words[:65]).rstrip(" ,;:") + "."
        elif joined and not joined.endswith((".", "!", "?")):
            joined += "."
        return joined

    return ""


# =========================================================
# NORMALIZATION + SELECTION
# =========================================================

def _normalize_subjective_questions(raw_questions: list, source_context: str) -> list[dict]:
    cleaned: list[dict] = []

    for item in raw_questions:
        if not isinstance(item, dict):
            continue

        q_type = str(item.get("type", "subjective")).strip().lower()
        if q_type != "subjective":
            continue

        question = _clean_part(item.get("question", ""))
        model_answer = _clean_part(item.get("answer", ""))
        difficulty = str(item.get("difficulty", "")).strip().title()

        if not question:
            continue

        if not _question_is_source_safe(question, source_context):
            continue

        answer = _make_source_answer(question, model_answer, source_context)

        if not answer:
            # Last resort temporary answer from question. It is still better than 20 minutes / error.
            answer = question

        inferred = _infer_difficulty(question, answer, source_context)
        if difficulty not in ["Hard", "Medium"]:
            difficulty = inferred

        if difficulty == "Hard" and inferred != "Hard":
            difficulty = "Medium"

        score = _question_quality_score(question, answer, source_context)

        if score < -20:
            continue

        cleaned.append({
            "type": "subjective",
            "difficulty": difficulty,
            "question": question,
            "answer": answer,
            "_score": score,
            "_difficulty": difficulty,
        })

    cleaned.sort(key=lambda q: q.get("_score", 0), reverse=True)
    return cleaned


def _fallback_questions_from_source(source_context: str, existing: list[dict]) -> list[dict]:
    facts = _source_fact_rows(source_context)
    generated = []

    useful_facts = []
    for fact in facts:
        if len(fact.split()) < 6:
            continue
        if any(_text_similarity(fact, old) >= 0.78 for old in useful_facts):
            continue
        useful_facts.append(fact)
        if len(useful_facts) >= 8:
            break

    # Medium fallback questions
    for fact in useful_facts:
        # Keep original word order instead of set order to avoid weird labels.
        raw_words = re.findall(r"[A-Za-z][A-Za-z0-9_-]+", fact)
        label_tokens = []
        for w in raw_words:
            lw = w.lower()
            if lw in _words_key(" ".join(label_tokens)):
                continue
            if lw in {"the", "and", "for", "with", "from", "that", "this", "are", "was", "were"}:
                continue
            if len(w) <= 2:
                continue
            label_tokens.append(w)
            if len(label_tokens) >= 4:
                break
        label = " ".join(label_tokens) if label_tokens else "this concept"
        question = f"Describe {label} based on the chapter."
        answer = fact if fact.endswith((".", "!", "?")) else fact + "."

        candidate = {
            "type": "subjective",
            "difficulty": "Medium",
            "question": question,
            "answer": answer,
            "_score": _question_quality_score(question, answer, source_context),
            "_difficulty": "Medium",
        }

        if not _is_duplicate_question(candidate, existing + generated):
            generated.append(candidate)

        if len(generated) >= 5:
            break

    return generated


def _select_final_subjective(candidates: list[dict], source_context: str) -> list[dict]:
    selected: list[dict] = []

    hard = [q for q in candidates if q.get("_difficulty") == "Hard"]
    medium = [q for q in candidates if q.get("_difficulty") != "Hard"]

    for q in hard:
        if len([x for x in selected if x.get("_difficulty") == "Hard"]) >= TARGET_HARD:
            break
        if not _is_duplicate_question(q, selected):
            selected.append(q)

    for q in medium:
        if len(selected) >= TARGET_TOTAL:
            break
        if len([x for x in selected if x.get("_difficulty") != "Hard"]) >= TARGET_MEDIUM:
            break
        if not _is_duplicate_question(q, selected):
            selected.append(q)

    for q in candidates:
        if len(selected) >= TARGET_TOTAL:
            break
        if not _is_duplicate_question(q, selected):
            selected.append(q)

    if len(selected) < TARGET_TOTAL:
        fallback = _fallback_questions_from_source(source_context, selected)
        for q in fallback:
            if len(selected) >= TARGET_TOTAL:
                break
            if not _is_duplicate_question(q, selected):
                selected.append(q)

    final = selected[:TARGET_TOTAL]

    # Display labels: first 3 Hard, last 2 Medium. No extra LLM call.
    for i, q in enumerate(final, start=1):
        q["difficulty"] = "Hard" if i <= TARGET_HARD else "Medium"
        q["_difficulty"] = q["difficulty"]

    return final


def _strip_internal_fields(questions: list[dict]) -> list[dict]:
    final = []
    for q in questions:
        q = dict(q)
        q.pop("_score", None)
        q.pop("_difficulty", None)
        final.append(q)
    return final


# =========================================================
# PROMPT - ONE CALL ONLY
# =========================================================

def _build_subjective_prompt(content_snippet: str, candidate_count: int = CANDIDATE_COUNT) -> str:
    return f"""
You are a strict university professor creating a FAST subjective written-answer quiz.

TASK:
Generate EXACTLY {candidate_count} candidate subjective questions from the chapter content.
The backend will select the best 5.

FINAL TARGET:
- 5 subjective questions.
- 3 Hard + 2 Medium.

HARD QUESTION RULES:
- Hard questions should require comparison, relationship, process logic, sequence, or source-stated reasoning.
- Hard questions must be answerable from the chapter only.
- Avoid direct recall for hard questions.
- Avoid "What is...", "Define...", "List...", and "Identify..." for hard questions.

MEDIUM QUESTION RULES:
- Medium questions may be more direct.
- Medium questions must still be useful and source-based.

SOURCE RULES:
- Use ONLY the chapter content.
- Use exact terms/topics from the chapter.
- Do NOT invent facts, examples, labels, assumptions, limitations, bias, model architecture, or outside examples.
- Do NOT ask for examples unless examples appear in the chapter.
- Do NOT mention chapter, source, document, page, slide, or textbook.
- Do NOT transfer a pro/con, advantage, drawback, or property from one concept to another. Keep each fact attached to the concept it describes in the chapter.

DIVERSITY RULES:
- Do NOT generate two questions about the same main example, story, or concept.
- Each question must focus on a different main topic from the chapter.
- Prefer broad coverage: one comparison question, one process/method question, one example/application question if examples exist, and one classification/type question if types exist.
- Avoid repeating the same named person, case, or example in more than two questions.

ANSWER RULES:
- Every question MUST include an answer.
- Answer must be 1-3 complete sentences.
- Answer must be based only on the chapter.
- Do NOT leave answer empty.
- Do NOT make answer identical to the question.

OUTPUT:
Return ONLY valid JSON, no markdown:
{{
  "questions": [
    {{
      "type": "subjective",
      "difficulty": "Hard",
      "question": "Question text?",
      "answer": "Answer text."
    }}
  ]
}}

Chapter content:
{content_snippet}
""".strip()


def _call_llm(prompt: str, max_tokens: int = FIRST_PASS_TOKENS):
    try:
        return client.chat.completions.create(
            model=QUIZ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.05,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
    except TypeError:
        return client.chat.completions.create(
            model=QUIZ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.05,
            max_tokens=max_tokens,
        )


# =========================================================
# MAIN PUBLIC FUNCTION USED BY ROUTES
# =========================================================

def generate_quiz(chapter_id: int, db):
    chapter = get_chapter_by_id(db, chapter_id)

    if not chapter:
        return {"error": "Chapter not found"}

    original_content = chapter.content or ""
    content_snippet = original_content[:MAX_CHAPTER_CHARS]

    try:
        prompt = _build_subjective_prompt(content_snippet, candidate_count=CANDIDATE_COUNT)
        response = _call_llm(prompt, max_tokens=FIRST_PASS_TOKENS)

        questions_text = response.choices[0].message.content
        raw_questions = _parse_llm_json(questions_text)

        candidates = _normalize_subjective_questions(raw_questions, content_snippet)
        final_questions = _select_final_subjective(candidates, content_snippet)

        if len(final_questions) < TARGET_TOTAL:
            return {
                "error": f"Only {len(final_questions)} subjective questions generated in fast mode. Try a longer chapter or increase QUIZ_MAX_TOKENS.",
                "debug_plan": {
                    "mode": "fast_one_call",
                    "original_content_chars": len(original_content),
                    "used_content_chars": len(content_snippet),
                    "candidate_count": CANDIDATE_COUNT,
                    "max_tokens": FIRST_PASS_TOKENS,
                },
                "raw_output": questions_text,
            }

        final_questions = _strip_internal_fields(final_questions[:TARGET_TOTAL])

        save_questions_for_chapter(db, chapter_id, final_questions)

        return {
            "chapter_id": chapter_id,
            "questions": final_questions,
            "model": QUIZ_MODEL,
            "quiz_mode": "subjective_fast_one_call_v2_diverse",
            "debug_plan": {
                "llm_calls": 1,
                "used_content_chars": len(content_snippet),
                "candidate_count": CANDIDATE_COUNT,
                "max_tokens": FIRST_PASS_TOKENS,
            },
        }

    except Exception as e:
        logger.exception("Failed to generate or parse LLM response")
        return {"error": f"Failed to generate quiz: {str(e)}"}
def _build_studyflow_prompt(
    content_snippet: str,
    quiz_type: str = "mcq",
    difficulty: str = "Mixed",
    questions_count: int = 5,
) -> str:
    quiz_type = (quiz_type or "mcq").lower().strip()
    difficulty = (difficulty or "Mixed").strip()
    questions_count = int(questions_count or 5)

    common_rules = f"""
SOURCE RULES:
- Use ONLY the provided content.
- Do NOT invent outside facts.
- Do NOT mention page, slide, chapter, source, document, or textbook.
- Questions must be useful for exam practice.
- Difficulty requested: {difficulty}.
- Generate EXACTLY {questions_count} questions.
- Return ONLY valid JSON. No markdown.
""".strip()

    if quiz_type == "true_false":
        return f"""
You are a strict university professor creating a True/False quiz.

{common_rules}

QUESTION STYLE:
- Make statements that test understanding, not random tiny details.
- Avoid obvious or childish questions.
- The answer must be either "True" or "False".
- Include a short explanation based only on the content.

OUTPUT JSON FORMAT:
{{
  "questions": [
    {{
      "type": "true_false",
      "difficulty": "Hard",
      "question": "Statement text.",
      "correct_answer": "True",
      "explanation": "Short explanation from the content."
    }}
  ]
}}

Content:
{content_snippet}
""".strip()

    if quiz_type == "subjective":
        return f"""
You are a strict university professor creating a subjective written-answer quiz.

{common_rules}

QUESTION STYLE:
- Prefer compare, explain how, relationship, process, sequence, and cause/effect questions.
- Avoid simple "What is..." questions when possible.
- Every question must include a model answer.
- The answer must be 1-3 sentences and based only on the content.

OUTPUT JSON FORMAT:
{{
  "questions": [
    {{
      "type": "subjective",
      "difficulty": "Hard",
      "question": "Question text?",
      "answer": "Model answer from the content."
    }}
  ]
}}

Content:
{content_snippet}
""".strip()

    return f"""
You are a strict university professor creating an MCQ quiz.

{common_rules}

QUESTION STYLE:
- Make strong MCQ questions, not direct copy/paste recall.
- Prefer comparison, relationship, process, sequence, cause/effect, and application.
- Each question must have exactly 4 options: A, B, C, D.
- Only one option must be correct.
- Do NOT use "All of the above" or "None of the above".
- The correct answer must be one letter only: A, B, C, or D.
- Include a short explanation based only on the content.

OUTPUT JSON FORMAT:
{{
  "questions": [
    {{
      "type": "mcq",
      "difficulty": "Hard",
      "question": "Question text?",
      "option_a": "Option A",
      "option_b": "Option B",
      "option_c": "Option C",
      "option_d": "Option D",
      "correct_answer": "A",
      "explanation": "Short explanation from the content."
    }}
  ]
}}

Content:
{content_snippet}
""".strip()


def _normalize_studyflow_questions(raw_questions: list, quiz_type: str, source_context: str) -> list[dict]:
    quiz_type = (quiz_type or "mcq").lower().strip()
    normalized = []

    for item in raw_questions:
        if not isinstance(item, dict):
            continue

        question = _clean_part(item.get("question", ""))
        difficulty = _clean_part(item.get("difficulty", "Medium")).title()

        if difficulty not in ["Hard", "Medium"]:
            difficulty = "Medium"

        if not question:
            continue

        if quiz_type == "true_false":
            correct = _clean_part(item.get("correct_answer", item.get("answer", ""))).title()

            if correct not in ["True", "False"]:
                continue

            explanation = _clean_part(item.get("explanation", ""))
            if not explanation:
                explanation = "The answer is based on the provided content."

            normalized.append({
                "type": "true_false",
                "difficulty": difficulty,
                "question": question,
                "correct_answer": correct,
                "explanation": explanation,
            })

        elif quiz_type == "subjective":
            answer = _clean_part(item.get("answer", ""))
            if not answer:
                answer = _make_source_answer(question, "", source_context)

            if not answer:
                continue

            normalized.append({
                "type": "subjective",
                "difficulty": difficulty,
                "question": question,
                "answer": answer,
            })

        else:
            option_a = _clean_part(item.get("option_a", ""))
            option_b = _clean_part(item.get("option_b", ""))
            option_c = _clean_part(item.get("option_c", ""))
            option_d = _clean_part(item.get("option_d", ""))
            correct = _clean_part(item.get("correct_answer", "")).upper()
            explanation = _clean_part(item.get("explanation", ""))

            if correct not in ["A", "B", "C", "D"]:
                continue

            if not all([option_a, option_b, option_c, option_d]):
                continue

            options = [option_a, option_b, option_c, option_d]
            if len(set([o.lower() for o in options])) < 4:
                continue

            if not explanation:
                explanation = "The correct answer is based on the provided content."

            normalized.append({
                "type": "mcq",
                "difficulty": difficulty,
                "question": question,
                "option_a": option_a,
                "option_b": option_b,
                "option_c": option_c,
                "option_d": option_d,
                "correct_answer": correct,
                "explanation": explanation,
            })

    return normalized


def generate_studyflow_quiz_from_text(
    original_content: str,
    quiz_type: str = "mcq",
    difficulty: str = "Mixed",
    questions_count: int = 5,
):
    original_content = original_content or ""
    quiz_type = (quiz_type or "mcq").lower().strip()

    if quiz_type not in ["mcq", "true_false", "subjective"]:
        quiz_type = "mcq"

    questions_count = int(questions_count or 5)
    questions_count = max(1, min(10, questions_count))

    content_snippet = original_content[:MAX_CHAPTER_CHARS]

    try:
        prompt = _build_studyflow_prompt(
            content_snippet=content_snippet,
            quiz_type=quiz_type,
            difficulty=difficulty,
            questions_count=questions_count,
        )

        response = _call_llm(prompt, max_tokens=FIRST_PASS_TOKENS)
        questions_text = response.choices[0].message.content

        raw_questions = _parse_llm_json(questions_text)
        final_questions = _normalize_studyflow_questions(
            raw_questions=raw_questions,
            quiz_type=quiz_type,
            source_context=content_snippet,
        )

        if len(final_questions) < questions_count:
            return {
                "error": f"Only {len(final_questions)} valid {quiz_type} questions generated. Try again or use longer content.",
                "raw_output": questions_text,
                "debug_plan": {
                    "quiz_type": quiz_type,
                    "requested_questions": questions_count,
                    "valid_questions": len(final_questions),
                    "used_content_chars": len(content_snippet),
                    "model": QUIZ_MODEL,
                },
            }

        return {
            "questions": final_questions[:questions_count],
            "quiz_type": quiz_type,
            "difficulty": difficulty,
            "model": QUIZ_MODEL,
            "debug_plan": {
                "mode": "studyflow_generate_quiz",
                "used_content_chars": len(content_snippet),
                "questions_count": questions_count,
                "max_tokens": FIRST_PASS_TOKENS,
            },
        }

    except Exception as e:
        logger.exception("Failed to generate StudyFlow quiz")
        return {
            "error": f"Failed to generate quiz: {str(e)}"
        }