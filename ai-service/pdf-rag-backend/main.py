import hashlib
import json
import os
import random
import re
from pathlib import Path
from typing import Any

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
    text = text.replace("\ufeff", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_pdf_pages(raw_bytes: bytes) -> list[dict[str, Any]]:
    if PdfReader is None:
        raise HTTPException(
            status_code=500,
            detail="PDF reader is not installed. Run: pip install pypdf PyPDF2",
        )

    import io

    reader = PdfReader(io.BytesIO(raw_bytes))
    pages: list[dict[str, Any]] = []

    for index, page in enumerate(reader.pages, start=1):
        page_text = _clean_text(page.extract_text() or "")
        if page_text:
            pages.append({"page": index, "text": page_text})

    return pages


def _full_text_from_pages(pages: list[dict[str, Any]]) -> str:
    return "\n\n".join(f"[Page {p['page']}]\n{p['text']}" for p in pages)


# ============================================================
# BASIC HELPERS
# ============================================================

STOPWORDS = {
    "the", "and", "for", "are", "you", "that", "this", "with", "from",
    "what", "how", "why", "when", "where", "who", "which", "into",
    "about", "does", "did", "can", "could", "would", "should", "only",
    "main", "primary", "according", "pdf", "text", "one", "type", "term",
    "using", "use", "used", "following", "question", "answer", "option",
    "generate", "exactly", "provided", "content", "difficulty", "means",
    "medium", "hard", "questions", "quiz", "multiple", "choice", "mariam",
    "fakih", "page", "chapter", "copyright", "rights", "reserved",
    "their", "there", "these", "those", "because", "between", "within",
    "sentence", "sentences", "language", "arabic", "system", "systems",
}

GENERIC_TITLES = {
    "introduction", "challenges", "outlines", "conclusion", "natural language processing",
}

BAD_TERM_STARTS = {
    "some", "another", "all", "these", "this", "the", "for", "google",
    "correct", "while", "however", "therefore", "hence", "moreover",
    "although", "usually", "generally", "being", "able", "word",
    "in", "or", "and", "as", "communication",
}

BAD_TERM_PHRASES = {
    "is used", "are used", "presented", "following", "sentence",
    "translation", "transliteration", "example", "helps", "makes",
    "concepts for", "use-cases and project", "four types", "basic use",
    "sample", "model diagram", "types characterize", "as a language",
    "arabic text", "system concepts", "diagram example",
}

BAD_EXACT_TERMS = {
    "arabic", "nlp", "syntax", "graphically", "google translation",
    "correct translation", "transliteration english", "arabs",
    "v owels", "v oweledspelling", "or short vowels",
}

BAD_STEM_PARTS = [
    "which of the following is true",
    "which statement is correct",
    "which of the following statements",
    "main purpose",
    "primary purpose",
    "main benefit",
    "primary benefit",
    "difference between",
    "what is the difference",
    "compare",
]


def _normalize_for_match(text: str) -> str:
    text = str(text or "").lower()
    text = re.sub(r"[^a-z0-9\u0600-\u06FF\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _tokenize(text: str) -> set[str]:
    words = re.findall(r"[A-Za-z\u0600-\u06FF0-9]{3,}", str(text or "").lower())
    return {w for w in words if w not in STOPWORDS}


def _coverage(short_text: str, long_text: str) -> float:
    a = _tokenize(short_text)
    b = _tokenize(long_text)
    if not a:
        return 0.0
    return len(a & b) / max(1, len(a))


def _overlap(a: str, b: str) -> float:
    aw = _tokenize(a)
    bw = _tokenize(b)
    if not aw or not bw:
        return 0.0
    return len(aw & bw) / max(1, len(aw | bw))


def _shorten(text: str, max_chars: int = 190) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars].rsplit(" ", 1)[0].strip()
    return cut + "..."


def _clean_line(line: str) -> str:
    line = str(line or "")
    line = line.replace("•", " ")
    line = line.replace("➢", " ")
    line = line.replace("–", "-")
    line = line.replace("—", "-")
    line = re.sub(r"\s+", " ", line)
    return line.strip(" -\t")


def _safe_term(term: str) -> str:
    term = re.sub(r"\s+", " ", str(term or "")).strip()
    term = term.strip(" :-–—.,;\t\n")
    # Remove common PDF noise at the beginning/end.
    term = re.sub(r"^\d+[.-]?\d*\s*", "", term).strip()
    term = re.sub(r"\s*Mariam Fakih\s*\d*\s*$", "", term, flags=re.I).strip()
    return term


def _is_good_term(term: str) -> bool:
    term = _safe_term(term)
    if not term:
        return False
    norm = _normalize_for_match(term)
    if norm in GENERIC_TITLES or norm in BAD_EXACT_TERMS:
        return False
    if term and term[0].islower():
        return False
    words = norm.split()
    if not words:
        return False
    if words[0] in BAD_TERM_STARTS:
        return False
    if len(words) > 7:
        return False
    if len(norm) < 3 or len(norm) > 80:
        return False
    if norm.isdigit():
        return False
    bad = ["mariam fakih", "copyright", "mcgraw", "table", "figure"]
    if any(x in norm for x in bad):
        return False
    if any(x in norm for x in BAD_TERM_PHRASES):
        return False
    if words[-1] in {"for", "and", "of", "with", "to"}:
        return False
    # Reject clause-like options accidentally captured as terms.
    lowered = term.lower()
    if re.search(r"\b(can|could|should|would|will|has|have|had|was|were)\b", lowered) and len(words) > 3:
        return False
    return True


def _looks_like_bad_question(question: str) -> bool:
    q = str(question or "").lower()
    return any(part in q for part in BAD_STEM_PARTS)


# ============================================================
# CARD EXTRACTION: source-grounded atomic facts
# ============================================================

def _page_lines(page_text: str) -> list[str]:
    raw_lines = [_clean_line(x) for x in page_text.splitlines()]
    lines = []
    for line in raw_lines:
        if not line:
            continue
        if re.fullmatch(r"\d+", line):
            continue
        if "copyright" in line.lower():
            continue
        if line.lower().strip() == "mariam fakih":
            continue
        lines.append(line)
    return lines


def _page_title(lines: list[str]) -> str:
    for line in lines[:6]:
        candidate = _safe_term(line)
        if _is_good_term(candidate):
            # Slide titles are often short and capitalized / title-like.
            if len(candidate.split()) <= 5:
                return candidate
    return ""


def _looks_like_list_or_noise_definition(definition: str) -> bool:
    d = str(definition or "")
    dl = d.lower()
    if d.count("➢") >= 2 or d.count("•") >= 3:
        return True
    # Reject cards that are basically an outline/list of multiple unrelated headings.
    heading_hits = 0
    headings = [
        "nonappearance of capital letters", "arabic morphology", "morphology declension",
        "syntax is intricate", "multi word expressions", "ambiguous anaphora",
        "hidden anaphora", "agreement", "vowels", "lack of uniformity",
        "primary business actor", "primary system actor", "external server actor",
        "external receiver actor", "use case association", "use case extends",
        "use case uses", "depends on", "inheritance",
    ]
    for h in headings:
        if h in dl:
            heading_hits += 1
    if heading_hits >= 3:
        return True
    return False


def _add_card(cards: list[dict[str, Any]], term: str, definition: str, page: int, source: str, origin: str) -> None:
    term = _safe_term(term)
    definition = re.sub(r"\s+", " ", str(definition or "")).strip(" -")
    source = re.sub(r"\s+", " ", str(source or "")).strip(" -")

    if not _is_good_term(term):
        return
    if _looks_like_list_or_noise_definition(definition):
        return
    if len(definition) < 35 or len(definition) > 550:
        return
    if _normalize_for_match(term) == _normalize_for_match(definition):
        return

    # Avoid cards where the definition is only a list of other headings.
    if len(_tokenize(definition)) < 5:
        return

    cards.append(
        {
            "term": term,
            "definition": definition,
            "page": int(page),
            "source": source or definition,
            "origin": origin,
        }
    )


def _extract_cards_regex(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []

    definition_patterns = [
        # Term - definition
        re.compile(
            r"(?P<term>[A-Z][A-Za-z0-9 /()'\-]{2,75})\s*[-:]\s*(?P<definition>.{35,360}?)(?=(?:\.|\n|$))",
            re.S,
        ),
        # Term is/are/refers to/consists of ...
        re.compile(
            r"(?P<term>[A-Z][A-Za-z0-9 /()'\-]{2,75})\s+"
            r"(?P<link>is|are|refers to|consists of|represents|indicates|specifies|depicts|describes)\s+"
            r"(?P<definition>.{35,360}?)(?=(?:\.|\n|$))",
            re.I | re.S,
        ),
    ]

    for page in pages:
        page_no = int(page["page"])
        text = page["text"]
        normalized_page = re.sub(r"\s+", " ", text)

        for pattern in definition_patterns:
            for match in pattern.finditer(normalized_page):
                term = _safe_term(match.group("term"))
                definition = match.groupdict().get("definition", "")
                link = match.groupdict().get("link", "")
                if link:
                    definition = f"{link} {definition}"
                source = f"{term} {definition}"
                _add_card(cards, term, definition, page_no, source, "regex")

    return cards


def _extract_cards_from_titles(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []

    for page in pages:
        page_no = int(page["page"])
        lines = _page_lines(page["text"])
        title = _page_title(lines)

        if not title or _normalize_for_match(title) in GENERIC_TITLES:
            continue

        body_lines = []
        for line in lines:
            if _normalize_for_match(line) == _normalize_for_match(title):
                continue
            if len(line) < 15:
                continue
            if re.search(r"^(table|figure)\b", line, re.I):
                continue
            body_lines.append(line)

        if not body_lines:
            continue

        # Use first meaningful bullets as the definition/evidence for the title concept.
        definition = " ".join(body_lines[:3])
        definition = _shorten(definition, 360)
        source = f"{title}: {definition}"
        _add_card(cards, title, definition, page_no, source, "title")

    return cards


def _extract_cards_from_bullet_terms(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []

    starters = [
        "Use case", "Use-case diagram", "Use-case narrative", "Actor", "Temporal event",
        "Primary business actor", "Primary system actor", "External server actor",
        "External receiver actor", "Association", "Extension use case",
        "Abstract use case", "Depends On", "Inheritance", "User-centered development",
        "Use-case modeling", "Anaphora Resolution", "Hidden Anaphora", "Ambiguous Anaphora",
        "Defective Verb Ambiguity", "Nonappearance of capital letters", "Morphology declension",
        "Annexation", "Agreement", "Multi word expressions", "Syntactically flexible text sequence",
        "Vowels", "Diacritics", "Hamza Spelling", "Arabic orthography", "Arabic morphology",
        "Syntax is intricate",
    ]

    for page in pages:
        page_no = int(page["page"])
        one_line = re.sub(r"\s+", " ", page["text"])
        for term in starters:
            # Capture text after the known term until a strong next title/term marker or sentence boundary window.
            pattern = re.compile(
                rf"\b{re.escape(term)}\b\s*(?:[-–—:]\s*)?(?P<definition>.{{35,360}}?)(?=(?:\b[A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+\b\s*[-–—:]|$))",
                re.S,
            )
            for match in pattern.finditer(one_line):
                definition = match.group("definition").strip()
                # Trim repeated title fragments.
                definition = re.sub(r"\bMariam Fakih\b\s*\d*", "", definition, flags=re.I).strip()
                if definition.lower().startswith(term.lower()):
                    definition = definition[len(term):].strip()
                source = f"{term} {definition}"
                _add_card(cards, term, definition, page_no, source, "starter")

    return cards


def _dedupe_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen_terms: set[str] = set()
    seen_defs: set[str] = set()

    def card_score(card: dict[str, Any]) -> tuple[int, int, int]:
        # Prefer clean slide-title/starter cards over broad regex captures.
        origin_score = {"title": 4, "starter": 3, "regex": 2, "llm_card": 1}.get(card.get("origin"), 0)
        term_words = len(_tokenize(card.get("term", "")))
        def_words = len(_tokenize(card.get("definition", "")))
        return (origin_score, min(def_words, 34), -abs(term_words - 3))

    for card in sorted(cards, key=card_score, reverse=True):
        term_key = _normalize_for_match(card["term"])
        def_key = " ".join(sorted(_tokenize(card["definition"])))[:160]

        if term_key in seen_terms:
            continue
        if def_key in seen_defs:
            continue

        seen_terms.add(term_key)
        seen_defs.add(def_key)
        deduped.append(card)

    # Prefer cards with concrete terms and real definitions.
    deduped.sort(
        key=lambda c: (
            1 if c.get("origin") in {"regex", "starter"} else 0,
            len(_tokenize(c.get("definition", ""))),
            -int(c.get("page", 9999)),
        ),
        reverse=True,
    )
    return deduped


def _extract_cards(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    cards.extend(_extract_cards_regex(pages))
    cards.extend(_extract_cards_from_bullet_terms(pages))
    cards.extend(_extract_cards_from_titles(pages))
    return _dedupe_cards(cards)


# ============================================================
# OPTIONAL LLM CARD EXTRACTION FALLBACK ONLY
# The answer key is never trusted from the LLM.
# ============================================================

def _call_ollama(prompt: str, temperature: float = 0.0, num_predict: int = 1800) -> str:
    response = requests.post(
        f"{OLLAMA_HOST}/api/generate",
        json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": num_predict},
        },
        timeout=600,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Ollama error: {response.text}")

    answer = (response.json().get("response") or "").strip()
    if not answer:
        raise HTTPException(status_code=502, detail="Ollama returned empty answer.")
    return answer


def _extract_json_object(text: str) -> dict | None:
    text = str(text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
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


def _extract_cards_with_llm(pages: list[dict[str, Any]], title: str) -> list[dict[str, Any]]:
    # Keep source compact but broad: include beginning, middle, and end pages.
    selected = pages[:8] + pages[8::4] + pages[-8:]
    seen = set()
    parts = []
    for p in selected:
        if p["page"] in seen:
            continue
        seen.add(p["page"])
        parts.append(f"[Page {p['page']}]\n{_shorten(p['text'], 1100)}")

    context = "\n\n---\n\n".join(parts)[:14000]

    prompt = f"""
Extract source-grounded study cards from the PDF text only.

Return JSON only:
{{
  "cards": [
    {{
      "term": "short concept/term from the PDF",
      "definition": "what the PDF says about it, in one sentence",
      "page": 1,
      "source": "exact short quote copied from the PDF text"
    }}
  ]
}}

Rules:
- Extract 12 cards.
- Use only concepts explicitly present in the PDF.
- The source must be copied from the PDF text, not invented.
- Do not create questions.
- Do not choose answers.

Title: {title}

PDF TEXT:
{context}
""".strip()

    try:
        raw = _call_ollama(prompt, temperature=0.0, num_predict=2200)
    except Exception:
        return []

    payload = _extract_json_object(raw)
    if not isinstance(payload, dict) or not isinstance(payload.get("cards"), list):
        return []

    full_text_norm = _normalize_for_match(_full_text_from_pages(pages))
    cards: list[dict[str, Any]] = []

    for item in payload.get("cards", []):
        if not isinstance(item, dict):
            continue
        term = _safe_term(str(item.get("term") or ""))
        definition = str(item.get("definition") or "").strip()
        source = str(item.get("source") or definition).strip()
        try:
            page = int(item.get("page") or 0)
        except Exception:
            page = 0

        # Reject hallucinated source/card: source or definition must be highly covered by the PDF.
        source_norm = _normalize_for_match(source)
        if source_norm and source_norm not in full_text_norm and _coverage(source, _full_text_from_pages(pages)) < 0.75:
            continue
        _add_card(cards, term, definition, page or 1, source, "llm_card")

    return _dedupe_cards(cards)


# ============================================================
# MCQ BUILDING FROM CARDS
# ============================================================

def _stable_shuffle(items: list[Any], seed_text: str) -> list[Any]:
    seed = int(hashlib.sha256(seed_text.encode("utf-8", errors="ignore")).hexdigest()[:12], 16)
    rng = random.Random(seed)
    items = list(items)
    rng.shuffle(items)
    return items


def _make_question_from_card(card: dict[str, Any], index: int) -> str:
    definition = _shorten(card["definition"], 165)
    templates = [
        f"Which term does the PDF define as: {definition}?",
        f"In the PDF, which concept is described as: {definition}?",
        f"Which PDF concept matches this description: {definition}?",
    ]
    return templates[index % len(templates)]


def _choose_distractors(card: dict[str, Any], all_cards: list[dict[str, Any]]) -> list[str]:
    correct = card["term"]
    correct_key = _normalize_for_match(correct)

    candidates = []
    for other in all_cards:
        term = other.get("term", "")
        term_key = _normalize_for_match(term)
        if not term or term_key == correct_key:
            continue
        if other.get("origin") not in {"title", "starter", "llm_card"}:
            continue
        if not _is_good_term(str(term)):
            continue
        if term_key in {"introduction", "challenges", "conclusion", "use case relationship"}:
            continue
        # Avoid almost identical terms.
        if _overlap(correct, term) > 0.70:
            continue
        candidates.append(term)

    # Prefer distractors with similar length/type, but all are terms from the PDF.
    correct_len = len(correct.split())
    candidates.sort(key=lambda t: (abs(len(str(t).split()) - correct_len), str(t).lower()))
    picked = []
    seen = set()
    for term in _stable_shuffle(candidates[:12], correct):
        key = _normalize_for_match(term)
        if key and key not in seen:
            seen.add(key)
            picked.append(term)
        if len(picked) == 3:
            break

    if len(picked) < 3:
        for term in candidates:
            key = _normalize_for_match(term)
            if key and key not in seen:
                seen.add(key)
                picked.append(term)
            if len(picked) == 3:
                break

    return picked[:3]


def _build_mcq_items(cards: list[dict[str, Any]], needed: int = 5) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    used_terms: set[str] = set()

    # Prefer cards with clear definitions and enough alternate terms for distractors.
    sorted_cards = sorted(
        cards,
        key=lambda c: (
            4 if c.get("origin") == "starter" else 3 if c.get("origin") == "title" else 2 if c.get("origin") == "regex" else 1,
            len(_tokenize(c.get("definition", ""))),
            -int(c.get("page") or 9999),
        ),
        reverse=True,
    )

    for card in sorted_cards:
        if len(questions) >= needed:
            break

        term_key = _normalize_for_match(card.get("term", ""))
        if not term_key or term_key in used_terms:
            continue

        distractors = _choose_distractors(card, cards)
        if len(distractors) < 3:
            continue

        option_terms = distractors + [card["term"]]
        option_terms = _stable_shuffle(option_terms, card["term"] + card["definition"])
        letters = ["A", "B", "C", "D"]
        options = {letter: option_terms[i] for i, letter in enumerate(letters)}
        correct_letter = next(letter for letter, value in options.items() if value == card["term"])

        question_text = _make_question_from_card(card, len(questions))
        if _looks_like_bad_question(question_text):
            continue

        source_text = _shorten(card.get("source") or card.get("definition") or "", 230)
        page = card.get("page") or "?"

        questions.append(
            {
                "question": question_text,
                "difficulty": "hard" if len(questions) < 3 else "medium",
                "options": options,
                "correct_answer": correct_letter,
                "source": f"Page {page}: {source_text}",
                "explanation": f"Page {page} supports this answer: {source_text}",
                "validation": {
                    "accepted": True,
                    "method": "deterministic_source_card_mcq_v3",
                    "answer_key_source": "correct answer is the card term; distractors are other PDF terms",
                },
            }
        )
        used_terms.add(term_key)

    return questions[:needed]


# ============================================================
# PUBLIC GENERATION FUNCTION
# ============================================================

def _generate_mcq_from_pdf(raw_bytes: bytes, title: str | None = None, question: str | None = None) -> dict:
    pages = _extract_pdf_pages(raw_bytes)

    if not pages or len(_full_text_from_pages(pages).strip()) < 20:
        raise HTTPException(status_code=422, detail="Could not extract enough readable text from this PDF.")

    cards = _extract_cards(pages)

    if len(cards) < 8:
        llm_cards = _extract_cards_with_llm(pages, title or "Uploaded PDF")
        cards = _dedupe_cards(cards + llm_cards)

    questions = _build_mcq_items(cards, needed=5)

    if len(questions) < 5:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Could not build 5 safe MCQs from source cards.",
                "cards_found": len(cards),
                "sample_cards": cards[:8],
            },
        )

    return {
        "success": True,
        "type": "multiple_choice",
        "difficulty": "mixed",
        "questions": questions,
        "total_questions": 5,
        "topic": title or "Uploaded PDF",
        "quality": {
            "validator": "deterministic_source_card_mcq_v3",
            "cards_found": len(cards),
            "accepted": len(questions),
            "important_note": "No LLM answer-key repair is used. Correct answers are assigned deterministically from verified PDF cards.",
        },
    }


# ============================================================
# ENDPOINTS
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
    return _generate_mcq_from_pdf(raw_bytes, title=title or Path(document.filename).stem, question=question)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "pdf-rag-mcq-only-card-v3",
        "model": OLLAMA_MODEL,
        "mode": "deterministic_source_cards",
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8015, reload=True)
