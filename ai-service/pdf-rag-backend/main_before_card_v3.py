import json
import os
import re
from pathlib import Path

import requests
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from pypdf import PdfReader
except Exception:
    try:
        from PyPDF2 import PdfReader
    except Exception:
        PdfReader = None


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text:latest")


class PdfQuizRequest(BaseModel):
    question: str | None = None
    quiz_type: str = "mcq"
    difficulty: str = "mixed"
    questions_count: int = 5
    total_questions: int | None = None
    title: str | None = None



# ============================================================
# PDF TEXT EXTRACTION
# ============================================================

def _clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_pdf_text(raw_bytes: bytes) -> str:
    if PdfReader is None:
        raise HTTPException(
            status_code=500,
            detail="PDF reader is not installed. Run: pip install pypdf PyPDF2",
        )

    import io

    reader = PdfReader(io.BytesIO(raw_bytes))
    pages = []

    for index, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        if page_text.strip():
            pages.append(f"\n[Page {index}]\n{page_text}")

    return _clean_text("\n".join(pages))


def _chunk_text(text: str, max_chars: int = 1400) -> list[str]:
    paragraphs = [
        paragraph.strip()
        for paragraph in re.split(r"\n\s*\n", text)
        if paragraph.strip()
    ]

    chunks = []
    current = ""

    for paragraph in paragraphs:
        if len(current) + len(paragraph) + 2 <= max_chars:
            current = (current + "\n\n" + paragraph).strip()
        else:
            if current:
                chunks.append(current)
            current = paragraph

    if current:
        chunks.append(current)

    if not chunks and text:
        chunks = [text[i:i + max_chars] for i in range(0, len(text), max_chars)]

    return chunks[:100]


# ============================================================
# BASIC NLP HELPERS
# ============================================================

def _tokenize(text: str) -> set[str]:
    words = re.findall(r"[A-Za-z\u0600-\u06FF0-9]{3,}", text.lower())

    stop = {
        "the", "and", "for", "are", "you", "that", "this", "with", "from",
        "what", "how", "why", "when", "where", "who", "which", "into",
        "about", "does", "did", "can", "could", "would", "should", "only",
        "main", "primary", "according", "pdf", "text", "one", "type",
        "using", "use", "used", "following", "question", "answer",
        "generate", "exactly", "provided", "content", "difficulty",
        "medium", "hard", "questions", "quiz", "multiple", "choice",
    }

    return {word for word in words if word not in stop}


def _nlp_words(text: str) -> list[str]:
    return list(_tokenize(text))


def _nlp_overlap_score(a: str, b: str) -> float:
    a_words = set(_nlp_words(a))
    b_words = set(_nlp_words(b))

    if not a_words or not b_words:
        return 0.0

    return len(a_words & b_words) / max(1, len(a_words | b_words))


def _split_source_sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[.!?])\s+", text)

    sentences = []

    for part in parts:
        part = part.strip()
        if 30 <= len(part) <= 600:
            sentences.append(part)

    return sentences


def _select_context_chunks(question: str, chunks: list[str], top_k: int = 8) -> list[str]:
    question_lower = (question or "").lower()

    # Laravel sends a general prompt like "Generate exactly 5..."
    # This is not a real topic query, so do not over-filter the PDF.
    is_general_generation_prompt = (
        "generate exactly" in question_lower
        or "multiple choice" in question_lower
        or "quiz questions" in question_lower
    )

    if is_general_generation_prompt:
        return [chunk for chunk in chunks[:top_k] if chunk.strip()]

    question_terms = _tokenize(question)
    scored = []

    for chunk in chunks:
        chunk_terms = _tokenize(chunk)
        overlap = len(question_terms.intersection(chunk_terms))
        score = overlap * 3 + (1 if len(chunk.strip()) > 80 else 0)
        scored.append((score, chunk))

    scored.sort(key=lambda item: item[0], reverse=True)

    selected = [chunk for score, chunk in scored[:top_k] if score > 0]

    if not selected:
        selected = [chunk for chunk in chunks[:top_k] if chunk.strip()]

    return selected


def _best_evidence_for_question(question: str, correct_text: str, context: str) -> str:
    sentences = _split_source_sentences(context)

    if not sentences:
        return ""

    target = question + " " + correct_text

    scored = []

    for sentence in sentences:
        score = (
            _nlp_overlap_score(target, sentence) * 2.0
            + _nlp_overlap_score(correct_text, sentence) * 3.0
        )
        scored.append((score, sentence))

    scored.sort(key=lambda item: item[0], reverse=True)

    if not scored:
        return ""

    best_score, best_sentence = scored[0]

    if best_score <= 0:
        return ""

    return best_sentence


# ============================================================
# OLLAMA
# ============================================================

def _call_ollama(prompt: str, temperature: float = 0.2, num_predict: int = 1200) -> str:
    response = requests.post(
        f"{OLLAMA_HOST}/api/generate",
        json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": num_predict,
            },
        },
        timeout=600,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Ollama error: {response.text}")

    data = response.json()
    answer = (data.get("response") or "").strip()

    if not answer:
        raise HTTPException(status_code=502, detail="Ollama returned empty answer.")

    return answer


def _extract_json_object(text: str) -> dict | None:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)

    start = text.find("{")
    end = text.rfind("}")

    if start < 0 or end < 0 or end <= start:
        return None

    try:
        payload = json.loads(text[start:end + 1])
    except Exception:
        return None

    return payload if isinstance(payload, dict) else None


# ============================================================
# MCQ NORMALIZATION
# ============================================================

def _normalize_mcq_questions(payload: dict | None, count: int) -> list[dict]:
    if not isinstance(payload, dict):
        return []

    questions = payload.get("questions")

    if not isinstance(questions, list):
        return []

    normalized = []

    for index, item in enumerate(questions):
        if not isinstance(item, dict):
            continue

        question_text = str(item.get("question") or "").strip()
        explanation = str(item.get("explanation") or "").strip()
        source = str(item.get("source") or item.get("evidence") or "").strip()
        difficulty = (
            str(item.get("difficulty") or "").strip().lower()
            or ("hard" if index < 7 else "medium")
        )

        options = item.get("options") or {}

        if isinstance(options, list):
            letters = ["A", "B", "C", "D"]
            options = {
                letters[i]: str(value).strip()
                for i, value in enumerate(options[:4])
            }

        if not isinstance(options, dict):
            continue

        normalized_options = {
            "A": str(options.get("A") or options.get("a") or "").strip(),
            "B": str(options.get("B") or options.get("b") or "").strip(),
            "C": str(options.get("C") or options.get("c") or "").strip(),
            "D": str(options.get("D") or options.get("d") or "").strip(),
        }

        if any(not value for value in normalized_options.values()):
            continue

        correct_answer = str(
            item.get("correct_answer") or item.get("answer") or ""
        ).strip().upper()

        if correct_answer not in {"A", "B", "C", "D"}:
            continue

        if not question_text or not explanation:
            continue

        normalized.append(
            {
                "question": question_text,
                "difficulty": (
                    difficulty
                    if difficulty in {"hard", "medium", "easy"}
                    else ("hard" if index < 7 else "medium")
                ),
                "options": normalized_options,
                "correct_answer": correct_answer,
                "source": source,
                "explanation": explanation,
            }
        )

        if len(normalized) >= count:
            break

    return normalized


# ============================================================
# MCQ NLP VALIDATION + NOMIC EMBEDDING ANSWER REPAIR
# ============================================================

def _question_has_banned_option(options: dict) -> bool:
    banned_phrases = [
        "all of the above",
        "none of the above",
        "all the above",
        "none the above",
        "both a and b",
        "both b and c",
        "both a and c",
        "both c and d",
        "a and b only",
        "b and c only",
        "c and d only",
    ]

    for option in options.values():
        option_lower = str(option).lower()
        if any(phrase in option_lower for phrase in banned_phrases):
            return True

    return False


def _looks_like_comparison_question(question: str) -> bool:
    q = question.lower()

    comparison_words = [
        "difference",
        "different from",
        "distinguish",
        "compare",
        "comparison",
        "versus",
        " vs ",
        "while",
        "whereas",
        "facts and opinions",
        "facts vs opinions",
    ]

    return any(word in q for word in comparison_words)


def _answer_handles_comparison(correct_text: str) -> bool:
    c = correct_text.lower()

    comparison_links = [
        "while",
        "whereas",
        "but",
        "however",
        "unlike",
        "on the other hand",
        "in contrast",
        "objective",
        "subjective",
    ]

    return any(link in c for link in comparison_links)


def _option_too_similar_to_correct(correct_text: str, option_text: str) -> bool:
    correct_clean = correct_text.strip().lower()
    option_clean = option_text.strip().lower()

    if correct_clean == option_clean:
        return True

    score = _nlp_overlap_score(correct_text, option_text)
    return score >= 0.72



def _content_words(text: str) -> set[str]:
    return _tokenize(text)


def _content_coverage(short_text: str, long_text: str) -> float:
    short_words = _content_words(short_text)
    long_words = _content_words(long_text)

    if not short_words:
        return 0.0

    return len(short_words & long_words) / max(1, len(short_words))


def _is_claim_like_option(option_text: str) -> bool:
    words = _content_words(option_text)
    if len(words) >= 4:
        return True

    lowered = str(option_text or "").lower()
    claim_cues = [
        " to ", "the ", "that ", "which ", "because", "by ",
        "is ", "are ", "was ", "were ", "indicates", "depicts",
        "shows", "helps", "reduces", "extends", "initiates",
    ]
    return any(cue in f" {lowered} " for cue in claim_cues)


def _option_supported_by_text(option_text: str, evidence_text: str) -> tuple[bool, float]:
    option_text = str(option_text or "").strip()
    evidence_text = str(evidence_text or "").strip()

    if not option_text or not evidence_text:
        return False, 0.0

    option_norm = _normalize_for_match(option_text)
    evidence_norm = _normalize_for_match(evidence_text)

    # Exact/near phrase support is the strongest signal.
    if option_norm and len(option_norm) >= 12 and option_norm in evidence_norm:
        return True, 1.0

    coverage = _content_coverage(option_text, evidence_text)
    lexical = _nlp_overlap_score(option_text, evidence_text)
    score = max(coverage, lexical)

    # A short option with most of its content words in the source is usually supported.
    return score >= 0.62, round(score, 4)


def _find_source_support_for_option(option_text: str, context: str) -> tuple[bool, str, float]:
    best_sentence = ""
    best_score = 0.0

    for sentence in _split_source_sentences(context):
        supported, score = _option_supported_by_text(option_text, sentence)
        if score > best_score:
            best_score = score
            best_sentence = sentence
        if supported:
            return True, sentence, score

    return False, best_sentence, round(best_score, 4)


def _model_source_is_exact_or_near(source: str, context: str) -> bool:
    source = str(source or "").strip()
    if len(source) < 30:
        return False

    source_norm = _normalize_for_match(source)
    context_norm = _normalize_for_match(context)

    if source_norm and source_norm in context_norm:
        return True

    # If the model copied most source words but added "According to Page...", allow it.
    return _content_coverage(source, context) >= 0.82


def _supported_wrong_claim_options(options: dict, correct_letter: str, context: str) -> list[str]:
    supported_wrong = []

    for letter, option_text in options.items():
        if letter == correct_letter:
            continue

        # Single terms can appear in the source without being the answer.
        # Claim-like distractors, however, must NOT be supported anywhere in the PDF.
        if not _is_claim_like_option(str(option_text)):
            continue

        supported, sentence, score = _find_source_support_for_option(str(option_text), context)
        if supported:
            supported_wrong.append(f"{letter} supported by source (score={score})")

    return supported_wrong


def _question_too_generic(question: str) -> bool:
    q = question.lower().strip()

    # These stems often create more than one valid answer, especially in slides
    # where a concept has several benefits/purposes. We reject them instead of
    # trying to repair the answer key after generation.
    weak_patterns = [
        "which of the following is true",
        "which statement is correct",
        "which of the following statements",
        "what is one of",
        "what type of",
        "what is the main difference",
        "what is the difference",
        "difference between",
        "compare",
        "primary purpose",
        "main purpose",
        "primary benefit",
        "main benefit",
        "one benefit",
        "according to the pdf, which",
    ]

    return any(pattern in q for pattern in weak_patterns)


def _normalize_for_match(text: str) -> str:
    text = str(text or "").lower()
    text = re.sub(r"[^a-z0-9\u0600-\u06FF\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


_EMBED_CACHE: dict[str, list[float]] = {}


def _ollama_embedding(text: str) -> list[float]:
    text = re.sub(r"\s+", " ", str(text or "")).strip()

    if not text:
        return []

    text = text[:1200]
    cache_key = f"{EMBEDDING_MODEL}::{text}"

    if cache_key in _EMBED_CACHE:
        return _EMBED_CACHE[cache_key]

    # Ollama supports /api/embeddings in many versions.
    # Some newer versions also support /api/embed, so we keep a fallback.
    payloads = [
        (
            f"{OLLAMA_HOST}/api/embeddings",
            {"model": EMBEDDING_MODEL, "prompt": text},
            "embedding",
        ),
        (
            f"{OLLAMA_HOST}/api/embed",
            {"model": EMBEDDING_MODEL, "input": text},
            "embeddings",
        ),
    ]

    for url, payload, result_key in payloads:
        try:
            response = requests.post(url, json=payload, timeout=120)

            if response.status_code >= 400:
                continue

            data = response.json()

            if result_key == "embedding":
                embedding = data.get("embedding") or []
            else:
                embeddings = data.get("embeddings") or []
                embedding = embeddings[0] if embeddings and isinstance(embeddings[0], list) else []

            if isinstance(embedding, list) and embedding:
                _EMBED_CACHE[cache_key] = embedding
                return embedding

        except Exception:
            continue

    return []


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return dot / (norm_a * norm_b)


def _semantic_option_score(option_text: str, evidence_text: str) -> float:
    option_text = str(option_text or "").strip()
    evidence_text = str(evidence_text or "").strip()

    if not option_text or not evidence_text:
        return 0.0

    option_norm = _normalize_for_match(option_text)
    evidence_norm = _normalize_for_match(evidence_text)

    semantic = _cosine_similarity(
        _ollama_embedding(option_text),
        _ollama_embedding(evidence_text),
    )

    lexical = _nlp_overlap_score(option_text, evidence_text)

    phrase_bonus = 0.0
    if option_norm and option_norm in evidence_norm:
        phrase_bonus = 0.55

    option_words = set(_nlp_words(option_text))
    evidence_words = set(_nlp_words(evidence_text))

    coverage_bonus = 0.0
    if option_words:
        coverage_bonus = len(option_words & evidence_words) / max(1, len(option_words))
        coverage_bonus *= 0.35

    score = (semantic * 0.65) + (lexical * 0.35) + phrase_bonus + coverage_bonus
    return round(score, 4)


def _best_supported_answer_letter_embedding(
    question_text: str,
    options: dict,
    evidence_text: str,
) -> tuple[str | None, float, float, dict]:
    scores = {}

    full_evidence = f"{question_text}\n{evidence_text}"

    for letter, option_text in options.items():
        scores[letter] = _semantic_option_score(option_text, full_evidence)

    if not scores:
        return None, 0.0, 0.0, {}

    sorted_scores = sorted(scores.items(), key=lambda item: item[1], reverse=True)

    best_letter, best_score = sorted_scores[0]
    second_score = sorted_scores[1][1] if len(sorted_scores) > 1 else 0.0

    return best_letter, best_score, second_score, scores


def _repair_or_reject_answer_mismatch(question: dict, best_evidence: str) -> tuple[bool, str, dict]:
    q_text = str(question.get("question") or "").strip()
    options = question.get("options") or {}
    claimed_letter = str(question.get("correct_answer") or "").strip().upper()
    explanation = str(question.get("explanation") or "").strip()

    if claimed_letter not in {"A", "B", "C", "D"}:
        return False, "Invalid claimed correct answer", question

    # Use both PDF evidence and explanation. This catches:
    # source/explanation supports A, but model marked B.
    evidence_text = f"{best_evidence}\n{explanation}"

    best_letter, best_score, second_score, scores = _best_supported_answer_letter_embedding(
        q_text,
        options,
        evidence_text,
    )

    if not best_letter:
        return False, "Could not determine embedding-supported answer", question

    claimed_score = scores.get(claimed_letter, 0.0)

    # If no option is supported clearly, reject.
    if best_score < 0.50:
        return False, f"No option is strongly supported by embedding evidence. Scores: {scores}", question

    # If top options are too close, reject as ambiguous.
    if best_score - second_score < 0.08:
        return False, f"Ambiguous answer options by embedding. Scores: {scores}", question

    fixed_question = dict(question)

    # Never auto-repair MCQ answer letters. Repairing made bad questions look valid.
    # If another option seems more supported, reject and regenerate instead.
    if best_letter != claimed_letter:
        return False, (
            f"Correct answer mismatch. Claimed {claimed_letter}, "
            f"but evidence suggests {best_letter}. Scores: {scores}"
        ), question

    fixed_question["validation_repair"] = {
        "repaired": False,
        "correct_answer_verified": True,
        "scores": scores,
        "model": EMBEDDING_MODEL,
    }

    return True, "Correct answer verified by embedding", fixed_question


def _validate_mcq_nlp(question: dict, context: str) -> tuple[bool, str, dict]:
    q_text = str(question.get("question") or "").strip()
    options = question.get("options") or {}
    correct_letter = str(question.get("correct_answer") or "").strip().upper()
    explanation = str(question.get("explanation") or "").strip()
    source = str(question.get("source") or "").strip()

    if not q_text:
        return False, "Missing question text", question

    if correct_letter not in {"A", "B", "C", "D"}:
        return False, "Invalid correct answer letter", question

    if not isinstance(options, dict) or set(options.keys()) != {"A", "B", "C", "D"}:
        return False, "Options must be exactly A, B, C, D", question

    option_values = [str(value).strip() for value in options.values()]

    if any(not value for value in option_values):
        return False, "Empty option found", question

    normalized_option_values = [value.lower() for value in option_values]

    if len(set(normalized_option_values)) != 4:
        return False, "Duplicate options", question

    if _question_has_banned_option(options):
        return False, "Contains banned option like All/None/Both of the above", question

    correct_text = options[correct_letter]

    if len(correct_text.split()) < 2:
        return False, "Correct option is too short", question

    if len(explanation.split()) < 5:
        return False, "Explanation is too weak", question

    if _question_too_generic(q_text):
        return False, "Question is too generic", question

    if _looks_like_comparison_question(q_text) and not _answer_handles_comparison(correct_text):
        return False, "Comparison question answer does not explain both sides", question

    # Prefer the model's source if it exists.
    # If missing, search using question + explanation + all options, not only the claimed answer.
    # This avoids reinforcing a wrong correct_answer letter.
    evidence_query_text = (
        q_text
        + " "
        + explanation
        + " "
        + " ".join(str(value) for value in options.values())
    )

    if _model_source_is_exact_or_near(source, context):
        best_evidence = source
    else:
        best_evidence = _best_evidence_for_question(
            q_text,
            evidence_query_text,
            context,
        )

    if not best_evidence:
        return False, "No PDF evidence found", question

    correct_supported, correct_support_score = _option_supported_by_text(correct_text, best_evidence)
    if not correct_supported:
        return False, (
            "Correct option is not directly supported by its best PDF evidence "
            f"(score={correct_support_score})"
        ), question

    supported_wrong = _supported_wrong_claim_options(options, correct_letter, context)
    if supported_wrong:
        return False, "Distractor is also supported by PDF: " + "; ".join(supported_wrong), question

    repair_ok, repair_reason, repaired_question = _repair_or_reject_answer_mismatch(
        question,
        best_evidence,
    )

    if not repair_ok:
        return False, repair_reason, question

    question = repaired_question
    correct_letter = str(question.get("correct_answer") or "").strip().upper()
    correct_text = options[correct_letter]

    support_score = _content_coverage(correct_text, best_evidence)

    if support_score < 0.35:
        return False, "Correct answer is not supported enough by PDF evidence", question

    similar_wrong_options = []

    for letter, option_text in options.items():
        if letter == correct_letter:
            continue

        if _option_too_similar_to_correct(correct_text, option_text):
            similar_wrong_options.append(letter)

    if similar_wrong_options:
        return False, (
            "Ambiguous options close to correct answer: "
            + ", ".join(similar_wrong_options)
        ), question

    fixed_question = dict(question)
    fixed_question["source"] = best_evidence
    fixed_question["validation"] = {
        "accepted": True,
        "support_score": round(support_score, 3),
        "method": "strict_no_repair_validator",
    }

    return True, "Accepted", fixed_question


def _build_mcq_llm_validator_prompt(context: str, question: dict) -> str:
    options = question.get("options") or {}

    return f"""
You are a strict MCQ validator.

Use ONLY the provided PDF context.

Check each option independently.

An option is SUPPORTED only if it fully and directly answers the question based on the PDF context.
An option is UNSUPPORTED if it is false, incomplete, too broad, partially related, or not the direct answer.

Return JSON only:
{{
  "supported_options": ["A"],
  "is_valid": true,
  "correct_answer_should_be": "A",
  "reason": "short reason"
}}

Rules:
- A valid MCQ must have exactly ONE supported option.
- If 0 options are supported, invalid.
- If 2 or more options are supported, invalid.
- If the provided correct answer is not the only supported option, invalid.

PDF CONTEXT:
{context}

QUESTION:
{question.get("question", "")}

OPTIONS:
A. {options.get("A", "")}
B. {options.get("B", "")}
C. {options.get("C", "")}
D. {options.get("D", "")}

PROVIDED CORRECT ANSWER:
{question.get("correct_answer", "")}
""".strip()


def _validate_mcq_with_llm_judge(question: dict, context: str) -> tuple[bool, str, dict]:
    correct_letter = str(question.get("correct_answer") or "").strip().upper()

    if correct_letter not in {"A", "B", "C", "D"}:
        return False, "Invalid correct answer before LLM judge", question

    prompt = _build_mcq_llm_validator_prompt(context, question)

    try:
        raw = _call_ollama(prompt, temperature=0.0, num_predict=500)
    except Exception as e:
        return False, f"LLM judge failed: {str(e)}", question

    data = _extract_json_object(raw)

    if not isinstance(data, dict):
        return False, "LLM judge did not return valid JSON", question

    supported = data.get("supported_options") or []

    if not isinstance(supported, list):
        return False, "LLM judge returned invalid supported_options", question

    clean_supported = []

    for item in supported:
        letter = str(item or "").strip().upper()
        match = re.search(r"[ABCD]", letter)
        if match:
            clean_supported.append(match.group(0))

    clean_supported = list(dict.fromkeys(clean_supported))

    if len(clean_supported) != 1:
        return False, f"LLM judge rejected: supported options = {clean_supported}", question

    if clean_supported[0] != correct_letter:
        return False, (
            f"LLM judge found answer-key mismatch. Claimed {correct_letter}, "
            f"judge says {clean_supported[0]}."
        ), question

    fixed_question = dict(question)
    fixed_question["validation_llm_judge"] = {
        "repaired": False,
        "accepted": True,
        "supported_options": clean_supported,
        "reason": data.get("reason", ""),
    }

    return True, "LLM judge accepted", fixed_question


def _validate_mcq_questions_nlp(
    questions: list[dict],
    context: str,
    needed: int = 5,
) -> tuple[list[dict], list[dict]]:
    accepted = []
    rejected = []
    seen_questions = set()

    for question in questions:
        q_key = re.sub(
            r"\W+",
            " ",
            str(question.get("question", "")).lower(),
        ).strip()

        if not q_key:
            rejected.append({
                "question": question.get("question"),
                "reason": "Empty question",
            })
            continue

        if q_key in seen_questions:
            rejected.append({
                "question": question.get("question"),
                "reason": "Duplicate question meaning",
            })
            continue

        seen_questions.add(q_key)

        valid, reason, fixed_question = _validate_mcq_nlp(question, context)

        if valid:
            judge_valid, judge_reason, judged_question = _validate_mcq_with_llm_judge(
                fixed_question,
                context,
            )

            if judge_valid:
                accepted.append(judged_question)
            else:
                print("Rejected MCQ:", judge_reason)
                rejected.append({
                    "question": question.get("question"),
                    "reason": judge_reason,
                })
        else:
            print("Rejected MCQ:", reason)
            rejected.append({
                "question": question.get("question"),
                "reason": reason,
            })

        if len(accepted) >= needed:
            break

    return accepted[:needed], rejected


# ============================================================
# MCQ PROMPT + GENERATION
# ============================================================

def _build_mcq_prompt(
    context: str,
    title: str,
    requested_question: str | None = None,
    draft_count: int = 12,
) -> str:
    focus_line = (
        f"User request: {requested_question.strip()}\n"
        if requested_question and requested_question.strip()
        else ""
    )

    return f"""
You are a strict local study assistant creating multiple-choice questions from PDF content only.

Rules:
- Use ONLY the source context below.
- Do not add outside knowledge.
- Generate exactly {draft_count} draft MCQ questions.
- Make the first 7 questions HARD and the remaining questions MEDIUM.
- Each question must have exactly 4 options: A, B, C, D.
- Each question must have exactly 1 clearly correct answer.
- Do NOT use "All of the above" or "None of the above".
- Do NOT use options like "Both A and B".
- Avoid ambiguous questions.
- Avoid questions where two options could both be correct.
- Do NOT ask about the primary/main purpose or primary/main benefit.
- Do NOT ask comparison/difference questions.
- Prefer definition-style questions such as: "Which term is defined as ...?" or "How does the PDF define X?"
- The correct option must fully answer the question.
- Every distractor must be clearly wrong for the exact question, not another true statement from the PDF.
- Add an exact source sentence from the PDF context that supports the correct answer.
- Add a short explanation grounded in the source sentence.
- Keep options short and related to the PDF topic.
- Return only valid JSON.
- Do not wrap the JSON in code fences.

Return exactly this schema:
{{
  "questions": [
    {{
      "question": "string",
      "difficulty": "hard",
      "options": {{
        "A": "string",
        "B": "string",
        "C": "string",
        "D": "string"
      }},
      "correct_answer": "A",
      "source": "exact supporting sentence from the PDF context",
      "explanation": "short explanation"
    }}
  ]
}}

Source title:
{title}

{focus_line}Source context:
{context}
""".strip()


def _generate_mcq_from_pdf(
    raw_bytes: bytes,
    title: str | None = None,
    question: str | None = None,
) -> dict:
    text = _extract_pdf_text(raw_bytes)

    if len(text.strip()) < 20:
        raise HTTPException(
            status_code=422,
            detail="Could not extract enough readable text from this PDF.",
        )

    chunks = _chunk_text(text, max_chars=1400)

    if not chunks:
        raise HTTPException(
            status_code=422,
            detail="Could not split the PDF into usable chunks.",
        )

    context_chunks = _select_context_chunks(
        question or "generate quiz from the document",
        chunks,
        top_k=8,
    )

    context = "\n\n---\n\n".join(context_chunks)

    all_draft_questions = []
    all_rejected = []

    attempts = [
        {"temperature": 0.10, "draft_count": 12, "num_predict": 2600},
        {"temperature": 0.00, "draft_count": 12, "num_predict": 2800},
        {"temperature": 0.20, "draft_count": 14, "num_predict": 3000},
    ]

    for attempt in attempts:
        prompt = _build_mcq_prompt(
            context,
            title or "Uploaded PDF",
            question,
            draft_count=attempt["draft_count"],
        )

        raw = _call_ollama(
            prompt,
            temperature=attempt["temperature"],
            num_predict=attempt["num_predict"],
        )

        payload = _extract_json_object(raw)
        draft_questions = _normalize_mcq_questions(
            payload,
            attempt["draft_count"],
        )

        all_draft_questions.extend(draft_questions)

        accepted, rejected = _validate_mcq_questions_nlp(
            all_draft_questions,
            context,
            needed=5,
        )

        all_rejected.extend(rejected)

        if len(accepted) >= 5:
            for index, item in enumerate(accepted):
                item["difficulty"] = "hard" if index < 3 else "medium"

            return {
                "success": True,
                "type": "multiple_choice",
                "difficulty": "mixed",
                "questions": accepted[:5],
                "total_questions": 5,
                "topic": title or "Uploaded PDF",
                "quality": {
                    "validator": "nomic_embedding_validator_plus_llm_judge",
                    "draft_questions": len(all_draft_questions),
                    "accepted": len(accepted[:5]),
                    "rejected": all_rejected[:10],
                },
            }

    raise HTTPException(
        status_code=502,
        detail={
            "message": "Quiz generation failed to produce 5 high-quality MCQs after NLP validation.",
            "draft_questions": len(all_draft_questions),
            "rejected": all_rejected[:15],
        },
    )


# ============================================================
# MAIN PDF QUIZ ENDPOINT
# ============================================================

@app.post("/post")
async def post_quiz(
    document: UploadFile = File(...),
    question: str | None = Form(None),
    quiz_type: str = Form("mcq"),
    difficulty: str = Form("mixed"),
    questions_count: int = Form(5),
    total_questions: int | None = Form(None),
    title: str | None = Form(None),
):
    if not document.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Invalid file type. PDF is required.")

    raw_bytes = await document.read()

    # This backend is MCQ-only.
    # quiz_type/difficulty/questions_count are kept in the signature
    # so the current frontend request does not break.
    return _generate_mcq_from_pdf(
        raw_bytes,
        title=title or Path(document.filename).stem,
        question=question,
    )



# ============================================================
# HEALTH ENDPOINT
# ============================================================

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "pdf-rag-mcq-only",
        "model": OLLAMA_MODEL,
        "embedding_model": EMBEDDING_MODEL,
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8015, reload=True)