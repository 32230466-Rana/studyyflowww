import json
import logging
import os
import re
import requests
from typing import Any

from app.crud import get_chapter_by_id, save_questions_for_chapter

logger = logging.getLogger(__name__)

# =========================================================
# LOCAL OLLAMA SETTINGS - NO OPENAI
# =========================================================

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
QUIZ_MODEL = os.getenv("QUIZ_MODEL", "llama3.2:3b")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "520"))

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


def _question_requests_example(question: str) -> bool:
    """Generic guard: no example questions in strict small-local-model mode.

    This avoids the model borrowing an example from a nearby but different concept.
    It is not topic/PDF specific.
    """
    q = _clean_part(question).lower()
    example_patterns = [
        r"\bprovide\s+an?\s+example\b",
        r"\bgive\s+an?\s+example\b",
        r"\binclude\s+an?\s+example\b",
        r"\bwith\s+an?\s+example\b",
        r"\busing\s+an?\s+example\b",
        r"\bexample\s+of\b",
        r"\bexamples\s+of\b",
        r"\bfor\s+example\b",
        r"\bfor\s+instance\b",
        r"\bsuch\s+as\b",
        r"\be\.g\.\b",
        r"\bscenario\s+where\b",
        r"\bscenario\s+in\s+which\b",
    ]
    return any(re.search(pattern, q, flags=re.IGNORECASE) for pattern in example_patterns)


def _answer_uses_example_language(answer: str) -> bool:
    """Reject answers that add examples when the quiz is in strict mode."""
    a = _clean_part(answer).lower()
    example_markers = [
        "for example",
        "for instance",
        "such as",
        "e.g.",
        "example:",
        "examples include",
        "in this scenario",
        "a scenario where",
        "a scenario in which",
    ]
    return any(marker in a for marker in example_markers)



def _answer_has_unsupported_inference(answer: str, source_context: str) -> bool:
    """Reject generic unsupported reasoning phrases added by the model.

    This is not PDF/topic specific. It prevents small local models from adding
    explanatory claims that are not directly stated in the source, such as
    "This means that..." or "This highlights..." when those ideas are not in
    the source text.
    """
    answer_low = _clean_part(answer).lower()
    source_low = _clean_part(source_context).lower()

    inference_phrases = [
        "this means that",
        "this means",
        "this indicates that",
        "this suggests that",
        "this implies that",
        "this highlights",
        "this distinction highlights",
        "as a result",
        "therefore",
        "thus",
        "allowing for",
        "resulting in",
        "leading to",
        "making it easier",
        "more effective",
        "more efficient",
        "more detailed understanding",
        "holistic view",
        "user experience",
    ]

    for phrase in inference_phrases:
        if phrase in answer_low and phrase not in source_low:
            return True

    return False


def _answer_has_generalization_distortion(answer: str, source_context: str) -> bool:
    """Reject generic singular/plural distortions.

    Example of the kind of issue this catches without hardcoding a PDF answer:
    source says "The X is Y", but answer generalizes to "Xs are considered Y"
    or "Xs can..." when that broader plural claim is not directly stated.
    """
    answer_low = _clean_part(answer).lower()
    source_low = _clean_part(source_context).lower()

    risky_patterns = [
        r"\b[a-z][a-z0-9_-]*s\s+are\s+considered\s+to\s+be\b",
        r"\b[a-z][a-z0-9_-]*s\s+are\s+considered\b",
        r"\b[a-z][a-z0-9_-]*s\s+can\s+initiate\b",
        r"\b[a-z][a-z0-9_-]*s\s+can\s+trigger\b",
        r"\b[a-z][a-z0-9_-]*s\s+can\s+cause\b",
    ]

    for pattern in risky_patterns:
        match = re.search(pattern, answer_low)
        if not match:
            continue

        phrase = match.group(0)
        # If the source itself contains the broad plural wording, allow it.
        if phrase in source_low:
            continue

        return True

    return False


def _answer_is_strictly_source_grounded(answer: str, source_context: str) -> bool:
    """Final strict answer guard for subjective model answers.

    Keeps answers close to source content and rejects unsupported explanation
    added by the model. Generic only; no topic-specific answers.
    """
    answer = _clean_part(answer)

    if not answer:
        return False

    if _answer_uses_example_language(answer):
        return False

    if _answer_has_unsupported_inference(answer, source_context):
        return False

    if _answer_has_generalization_distortion(answer, source_context):
        return False

    support = _source_support_score(answer, source_context)
    unsupported = _unsupported_word_ratio(answer, source_context)

    # Stricter than the first-pass answer maker. This reduces hallucinated
    # explanation while still allowing natural wording.
    if support < 0.12:
        return False

    if unsupported > 0.56 and support < 0.20:
        return False

    return True


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

    # Strict mode for small local models:
    # do not allow example/scenario questions because they are the most likely
    # to borrow examples from a different concept.
    if _question_requests_example(q):
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
    new_question = _clean_part(new_q.get("question", ""))
    new_text = f"{new_q.get('question', '')} {new_q.get('answer', '')}"
    new_words = _words_key(new_question)

    for old in selected:
        old_question = _clean_part(old.get("question", ""))
        old_text = f"{old.get('question', '')} {old.get('answer', '')}"
        old_words = _words_key(old_question)

        if _text_similarity(new_text, old_text) >= 0.55:
            return True

        if _text_similarity(new_question, old_question) >= 0.40:
            return True

        if new_words and old_words:
            common = new_words & old_words
            smaller = min(len(new_words), len(old_words))

            if smaller >= 5 and len(common) / smaller >= 0.55:
                return True

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

    if (
        len(answer.split()) >= 10
        and _source_support_score(answer, source_context) >= 0.16
        and _unsupported_word_ratio(answer, source_context) <= 0.54
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
            continue

        # Strict source-grounding guard:
        # reject unsupported inference, examples/scenarios, and broad
        # singular/plural generalizations added by the local model.
        if not _answer_is_strictly_source_grounded(answer, source_context):
            continue

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
    """
    Backup generator only.
    It uses real source facts, but avoids weak generic questions like:
    'Describe X based on the chapter.'

    No PDF-specific hardcoded questions.
    No memorized answers.
    No extra Ollama call.
    """

    def _topic_from_fact(fact: str) -> str:
        fact_clean = _clean_part(fact)

        # Try to get the main concept before common explanation verbs.
        split_patterns = [
            r"\s+is\s+",
            r"\s+are\s+",
            r"\s+refers\s+to\s+",
            r"\s+means\s+",
            r"\s+consists\s+of\s+",
            r"\s+includes\s+",
            r"\s+contains\s+",
            r"\s+represents\s+",
            r"\s+specifies\s+",
            r"\s+shows\s+",
            r"\s+describes\s+",
            r"\s+identifies\s+",
            r"\s+provides\s+",
            r"\s+allows\s+",
            r"\s+enables\s+",
            r"\s+requires\s+",
        ]

        for pattern in split_patterns:
            parts = re.split(pattern, fact_clean, maxsplit=1, flags=re.IGNORECASE)
            if len(parts) >= 2:
                topic = _clean_part(parts[0])
                topic_words = topic.split()

                if 2 <= len(topic_words) <= 8:
                    return topic.rstrip(" .,:;")

        # Fallback topic extraction from important words only.
        raw_words = re.findall(r"[A-Za-z][A-Za-z0-9_-]+", fact_clean)

        label_tokens = []
        banned = {
            "the", "and", "for", "with", "from", "that", "this", "these",
            "those", "are", "was", "were", "has", "have", "had", "can",
            "could", "would", "should", "must", "may", "might", "will",
            "shall", "into", "onto", "about", "because", "therefore",
        }

        seen = set()

        for word in raw_words:
            low = word.lower()

            if low in banned:
                continue

            if len(word) <= 2:
                continue

            if low in seen:
                continue

            seen.add(low)
            label_tokens.append(word)

            if len(label_tokens) >= 5:
                break

        if label_tokens:
            return " ".join(label_tokens)

        return "the main concept"

    def _question_from_fact(fact: str) -> str:
        low = fact.lower()
        topic = _topic_from_fact(fact)

        if any(x in low for x in ["different", "difference", "differ", "compare", "contrast"]):
            return f"Explain the difference involving {topic}."

        if any(x in low for x in ["relationship", "relates", "depends", "dependency", "association", "connected"]):
            return f"Explain the relationship involving {topic}."

        if any(x in low for x in ["process", "steps", "sequence", "before", "after", "first", "then", "finally"]):
            return f"Explain how {topic} works as a process."

        if any(x in low for x in ["purpose", "goal", "objective", "used to", "used for"]):
            return f"Explain the purpose of {topic}."

        if any(x in low for x in ["allows", "enables", "helps", "supports", "provides"]):
            return f"Explain how {topic} supports the system or concept being discussed."

        if any(x in low for x in ["type", "types", "category", "categories", "classification", "classified"]):
            return f"Explain how {topic} is classified or organized."

        return f"Explain the role of {topic}."

    facts = _source_fact_rows(source_context)
    generated = []
    useful_facts = []

    for fact in facts:
        fact = _clean_part(fact)

        if len(fact.split()) < 7:
            continue

        if any(_text_similarity(fact, old) >= 0.78 for old in useful_facts):
            continue

        useful_facts.append(fact)

        if len(useful_facts) >= 10:
            break

    for fact in useful_facts:
        question = _question_from_fact(fact)
        answer = fact if fact.endswith((".", "!", "?")) else fact + "."

        candidate = {
            "type": "subjective",
            "difficulty": "Medium",
            "question": question,
            "answer": answer,
            "_score": _question_quality_score(question, answer, source_context),
            "_difficulty": "Medium",
        }

        if candidate["_score"] < -10:
            continue

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

    # Keep your required display distribution: 3 Hard + 2 Medium.
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
# PROMPT - ONE LOCAL OLLAMA CALL ONLY
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
- Do NOT invent facts, labels, assumptions, limitations, bias, model architecture, examples, scenarios, or outside information.
- Do NOT ask for examples.
- Do NOT ask for scenarios.
- Do NOT include examples or scenarios in answers.
- Do NOT add conclusions like "This means that", "This highlights", "as a result", or "therefore" unless explicitly stated in the chapter.
- Do NOT generalize a singular source statement into a broad plural claim.
- Do NOT mention chapter, source, document, page, slide, or textbook.
- Do NOT transfer a pro/con, advantage, drawback, or property from one concept to another. Keep each fact attached to the concept it describes in the chapter.

DIVERSITY RULES:
- Do NOT generate two questions about the same main example, story, or concept.
- Each question must focus on a different main topic from the chapter.
- Prefer broad coverage: one comparison question, one process/method question, one relationship question, and one classification/type question if types exist.
- Avoid repeating the same named person, case, concept, or relationship in more than two questions.

ANSWER RULES:
- Every question MUST include an answer.
- Answer must be 1-3 complete sentences.
- Answer must be based only on the chapter.
- Keep the answer close to the chapter wording.
- Do NOT include examples or scenarios.
- Do NOT add unsupported explanation or extra conclusions.
- Do NOT generalize singular statements into plural claims.
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


def _call_llm(prompt: str, max_tokens: int = FIRST_PASS_TOKENS) -> str:
    """
    Direct local Ollama call.
    No OpenAI package, no OpenAI client, no OpenAI API.
    """

    url = f"{OLLAMA_BASE_URL}/api/chat"

    payload = {
        "model": QUIZ_MODEL,
        "messages": [
            {
                "role": "user",
                "content": prompt,
            }
        ],
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.05,
            "num_predict": max_tokens,
            "top_p": 0.9,
            "repeat_penalty": 1.1,
        },
    }

    try:
        response = requests.post(url, json=payload, timeout=OLLAMA_TIMEOUT)
        response.raise_for_status()
    except requests.exceptions.ConnectionError:
        raise RuntimeError(
            f"Cannot connect to Ollama at {OLLAMA_BASE_URL}. "
            "Make sure Ollama is running."
        )
    except requests.exceptions.Timeout:
        raise RuntimeError(
            f"Ollama timed out after {OLLAMA_TIMEOUT} seconds. "
            "Try increasing OLLAMA_TIMEOUT or reducing QUIZ_MAX_CHAPTER_CHARS."
        )
    except requests.exceptions.HTTPError as e:
        raise RuntimeError(f"Ollama HTTP error: {e} - {response.text}")

    data = response.json()

    message = data.get("message", {})
    content = message.get("content", "")

    if not content:
        content = data.get("response", "")

    if not content:
        raise RuntimeError(f"Ollama returned empty response: {data}")

    return content


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

        questions_text = _call_llm(prompt, max_tokens=FIRST_PASS_TOKENS)
        raw_questions = _parse_llm_json(questions_text)

        candidates = _normalize_subjective_questions(raw_questions, content_snippet)
        final_questions = _select_final_subjective(candidates, content_snippet)

        if len(final_questions) < TARGET_TOTAL:
            return {
                "error": f"Only {len(final_questions)} subjective questions generated in fast mode. Try a longer chapter or increase QUIZ_MAX_TOKENS.",
                "debug_plan": {
                    "mode": "fast_one_call_ollama_native",
                    "original_content_chars": len(original_content),
                    "used_content_chars": len(content_snippet),
                    "candidate_count": CANDIDATE_COUNT,
                    "max_tokens": FIRST_PASS_TOKENS,
                    "model": QUIZ_MODEL,
                    "ollama_url": OLLAMA_BASE_URL,
                },
                "raw_output": questions_text,
            }

        final_questions = _strip_internal_fields(final_questions[:TARGET_TOTAL])

        save_questions_for_chapter(db, chapter_id, final_questions)

        return {
            "chapter_id": chapter_id,
            "questions": final_questions,
            "model": QUIZ_MODEL,
            "quiz_mode": "subjective_fast_one_call_ollama_native_v6_strict_grounded_no_hardcode",
            "debug_plan": {
                "llm_calls": 1,
                "used_content_chars": len(content_snippet),
                "candidate_count": CANDIDATE_COUNT,
                "max_tokens": FIRST_PASS_TOKENS,
                "ollama_url": OLLAMA_BASE_URL,
            },
        }

    except Exception as e:
        logger.exception("Failed to generate or parse local Ollama response")
        return {"error": f"Failed to generate quiz: {str(e)}"}
