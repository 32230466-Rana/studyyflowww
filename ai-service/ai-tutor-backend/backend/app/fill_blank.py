import json
import math
import os
import re
import requests
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

BLANK = "________"
CODE_VERSION = "RANA_FILL_BLANK_021_SPACY_EMBEDDING_OLLAMA_NATURAL_ANY_PDF"

# =========================
# Environment settings
# =========================

USE_OLLAMA_FILL_BLANK = os.environ.get("FIB_USE_OLLAMA", "true").strip().lower() in {"true", "1", "yes"}
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("FIB_OLLAMA_MODEL", os.environ.get("OLLAMA_MODEL", "llama3.2:3b"))
OLLAMA_TIMEOUT = int(os.environ.get("FIB_OLLAMA_TIMEOUT", "420"))

# Optional semantic validation using a local Ollama embedding model.
# This is generic and works across subjects.
USE_SEMANTIC_VALIDATION = os.environ.get("FIB_USE_SEMANTIC_VALIDATION", "true").strip().lower() in {"true", "1", "yes"}
EMBEDDING_MODEL = os.environ.get("FIB_EMBEDDING_MODEL", "nomic-embed-text")
EMBEDDING_TIMEOUT = int(os.environ.get("FIB_EMBEDDING_TIMEOUT", "60"))
SEMANTIC_THRESHOLD = float(os.environ.get("FIB_SEMANTIC_THRESHOLD", "0.62"))
SEMANTIC_STRICT_THRESHOLD = float(os.environ.get("FIB_SEMANTIC_STRICT_THRESHOLD", "0.70"))
SEMANTIC_FAIL_OPEN = os.environ.get("FIB_SEMANTIC_FAIL_OPEN", "true").strip().lower() in {"true", "1", "yes"}

# Optional spaCy answer-candidate validation.
# This is grammar-based and generic for any PDF/lecture.
USE_SPACY_CANDIDATES = os.environ.get("FIB_USE_SPACY_CANDIDATES", "true").strip().lower() in {"true", "1", "yes"}
SPACY_MODEL = os.environ.get("FIB_SPACY_MODEL", "en_core_web_sm")
SPACY_FAIL_OPEN = os.environ.get("FIB_SPACY_FAIL_OPEN", "true").strip().lower() in {"true", "1", "yes"}
MAX_ANSWER_CANDIDATES_PER_FACT = int(os.environ.get("FIB_MAX_ANSWER_CANDIDATES_PER_FACT", "10"))

# Keep backend templates as fallback only. Ollama wording is preferred.
ALLOW_BACKEND_FALLBACK = os.environ.get("FIB_ALLOW_BACKEND_FALLBACK", "true").strip().lower() in {"true", "1", "yes"}
OLLAMA_RETRY_IF_SHORT = os.environ.get("FIB_OLLAMA_RETRY_IF_SHORT", "true").strip().lower() in {"true", "1", "yes"}

TARGET_TOTAL = int(os.environ.get("FIB_TARGET_TOTAL", "5"))
MAX_SOURCE_CHARS = int(os.environ.get("FIB_MAX_SOURCE_CHARS", "14000"))
MAX_FACTS = int(os.environ.get("FIB_MAX_FACTS", "50"))
MAX_OLLAMA_ITEMS = int(os.environ.get("FIB_MAX_OLLAMA_ITEMS", "20"))

# Strict mode: do not create cloze questions by deleting random words from broken extraction lines.
ALLOW_RAW_CLOZE = os.environ.get("FIB_ALLOW_RAW_CLOZE", "false").strip().lower() in {"true", "1", "yes"}

# =========================
# Generic language filters
# No lecture/topic-specific answers here.
# =========================

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with", "by", "from",
    "that", "which", "who", "whom", "whose", "when", "where", "why", "how", "as", "at", "is",
    "are", "was", "were", "be", "being", "been", "this", "these", "those", "it", "they", "them",
    "its", "their", "into", "than", "then", "also", "must", "can", "may", "will", "would",
    "should", "could", "not", "no", "do", "does", "did", "using", "used", "use", "uses",
    "other", "another", "each", "every", "some", "any"
}

BAD_ANSWER_WORDS = STOPWORDS | {
    "true", "false", "pdf", "slide", "page", "chapter", "figure", "example", "following",
    "above", "below", "etc", "information", "thing", "things", "question", "answer"
}

# Generic weak single-word answers. These are not course/topic answers.
WEAK_SINGLE_WORD_ANSWERS = {
    "process", "method", "way", "type", "kind", "form", "part", "purpose",
    "step", "steps", "item", "items", "section", "area", "aspect", "element",
    "object", "objects", "concept", "concepts", "information", "description",
    "sequence", "relationship", "connection", "interaction", "function", "operation",
    "task", "event", "activity", "procedure", "category", "classification"
}

# Generic weak heads when a blank is followed by a connector.
# Example shape rejected: "Short label is a ________ of ...".
WEAK_CONNECTOR_HEADS = WEAK_SINGLE_WORD_ANSWERS | {
    "definition", "explanation", "representation", "depiction", "model", "structure",
    "group", "set", "collection", "series", "list", "portion", "piece", "component"
}

BAD_START_WORDS = {
    "of", "for", "to", "from", "by", "with", "as", "and", "or", "but", "because", "which",
    "that", "who", "whose", "whom", "when", "where", "while", "whereas", "generally",
    "usually", "also", "then", "therefore", "however"
}

NOISE_PATTERNS = [
    r"\bcopyright\b", r"\ball rights reserved\b", r"\bchapter\s+\d+\b",
    r"\bpage\s+\d+\b", r"\bslide\s+\d+\b", r"\btable of contents\b",
    r"\breferences\b", r"\bbibliography\b", r"\bappendix\b", r"\blearning objectives\b",
    r"\bmcgraw\b", r"\birwin\b",
]

LINKING_VERBS = (
    r"is|are|means|mean|refers to|refer to|represent|represents|describe|describes|define|defines|"
    r"specify|specifies|indicate|indicates|show|shows|required|requires|include|includes|"
    r"allow|allows|provide|provides|contain|contains|consist of|consists of|involve|involves"
)
DEFINITION_VERBS = r"is|are|means|mean|refers to|refer to|represent|represents|describe|describes|define|defines"
ACTION_VERBS = (
    r"specify|specifies|indicate|indicates|show|shows|required|requires|include|includes|"
    r"allow|allows|provide|provides|describe|describes|represent|represents|contain|contains|involve|involves"
)

ALLOWED_CLEAN_FACT_INSERTIONS = {
    "called", "known", "term", "concept", "phrase", "defined", "definition"
}


# =========================
# Basic text utilities
# =========================

def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def normalize_sentence(sentence: str) -> str:
    s = clean_text(sentence).strip(" -•\t\n\r")
    if s and not s.endswith((".", "!", "?")):
        s += "."
    return s


def normalize_key(text: str) -> str:
    return re.sub(r"\W+", " ", (text or "").lower()).strip()


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9]+", text or ""))


def tokenize(text: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def strip_quotes(text: str) -> str:
    return clean_text(text).strip(" ,.;:()[]{}\"'")


def title_case_ratio(text: str) -> float:
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", text or "")
    if not words:
        return 0.0
    return len([w for w in words if len(w) > 2 and w[0].isupper()]) / len(words)


def deglue_extraction_words(text: str) -> str:
    """
    Generic cleanup for text extracted from documents.
    Splits common connector words that sometimes get glued to previous words.
    """
    s = clean_text(text)
    joiners = [
        "between", "before", "after", "within", "without", "because", "however", "therefore",
        "which", "where", "when", "while", "whereas", "that", "with", "from", "into", "onto",
        "under", "over", "through", "for", "to", "of", "by", "as", "and"
    ]
    for j in joiners:
        s = re.sub(rf"([a-z])({j})\b", rf"\1 \2", s, flags=re.IGNORECASE)
    return clean_text(s)


def content_tokens(text: str) -> List[str]:
    extra = {"called", "term", "refers", "refer", "blank", "answer", "clean", "fact"} | ALLOWED_CLEAN_FACT_INSERTIONS
    return [t for t in tokenize(text) if t not in STOPWORDS and t not in extra]


def content_overlap(a: str, b: str) -> float:
    sa, sb = set(content_tokens(a)), set(content_tokens(b))
    return len(sa & sb) / len(sa | sb) if sa and sb else 0.0


def seq_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize_key(a), normalize_key(b)).ratio()


_EMBED_CACHE: Dict[str, Optional[List[float]]] = {}


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0

    dot = sum(a * b for a, b in zip(vec1, vec2))
    norm1 = math.sqrt(sum(a * a for a in vec1))
    norm2 = math.sqrt(sum(b * b for b in vec2))

    if norm1 == 0 or norm2 == 0:
        return 0.0

    return dot / (norm1 * norm2)


def ollama_embed(text: str) -> Optional[List[float]]:
    """
    Returns a local embedding vector for semantic similarity.
    The embedding model is generic and is not prompted for one lecture.
    """
    text = clean_text(text)
    if not text:
        return None

    cache_key = f"{EMBEDDING_MODEL}::{text}"
    if cache_key in _EMBED_CACHE:
        return _EMBED_CACHE[cache_key]

    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/embed",
            json={"model": EMBEDDING_MODEL, "input": text},
            timeout=EMBEDDING_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()
        embeddings = data.get("embeddings")
        if isinstance(embeddings, list) and embeddings and isinstance(embeddings[0], list):
            vector = embeddings[0]
            _EMBED_CACHE[cache_key] = vector
            return vector
    except Exception:
        pass

    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/embeddings",
            json={"model": EMBEDDING_MODEL, "prompt": text},
            timeout=EMBEDDING_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()
        vector = data.get("embedding")
        if isinstance(vector, list):
            _EMBED_CACHE[cache_key] = vector
            return vector
    except Exception:
        pass

    _EMBED_CACHE[cache_key] = None
    return None


def semantic_similarity(a: str, b: str) -> float:
    if not USE_SEMANTIC_VALIDATION:
        return 1.0

    va = ollama_embed(a)
    vb = ollama_embed(b)

    if va is None or vb is None:
        return 1.0 if SEMANTIC_FAIL_OPEN else 0.0

    return cosine_similarity(va, vb)


_SPACY_NLP = None
_SPACY_LOAD_FAILED = False
_SPACY_CANDIDATE_CACHE: Dict[str, List[str]] = {}


def load_spacy_model():
    """
    Loads spaCy only when available.
    The quiz still works without spaCy if SPACY_FAIL_OPEN=true.
    """
    global _SPACY_NLP, _SPACY_LOAD_FAILED

    if not USE_SPACY_CANDIDATES:
        return None

    if _SPACY_NLP is not None:
        return _SPACY_NLP

    if _SPACY_LOAD_FAILED:
        return None

    try:
        import spacy  # type: ignore
        _SPACY_NLP = spacy.load(SPACY_MODEL)
        return _SPACY_NLP
    except Exception:
        _SPACY_LOAD_FAILED = True
        return None


def candidate_key(text: str) -> str:
    key = normalize_key(text)
    key = re.sub(r"^(a|an|the|this|that|these|those)\s+", "", key)
    return key.strip()


def candidate_is_reasonable(text: str) -> bool:
    t = strip_quotes(repair_common_extraction_spacing(text))
    if phrase_is_bad_answer(t):
        return False

    wc = word_count(t)
    if wc < 1 or wc > 7:
        return False

    # Avoid mostly numeric or mostly punctuation candidates.
    if not re.search(r"[A-Za-z]", t):
        return False

    return True


def extract_regex_phrase_candidates(sentence: str) -> List[str]:
    """
    Generic phrase backup for noun-preposition-noun terms.
    This is not topic-specific; it captures grammar shapes like "sequence of steps".
    """
    s = normalize_sentence(repair_common_extraction_spacing(sentence)).rstrip(".")
    candidates: List[str] = []

    pattern = (
        r"\b([A-Za-z][A-Za-z'/-]*(?:\s+[A-Za-z][A-Za-z'/-]*){0,3}"
        r"\s+(?:of|for|between|with|from|to)\s+"
        r"[A-Za-z][A-Za-z'/-]*(?:\s+[A-Za-z][A-Za-z'/-]*){0,3})\b"
    )
    for match in re.finditer(pattern, s):
        cand = strip_quotes(match.group(1))
        if candidate_is_reasonable(cand):
            candidates.append(cand)

    return candidates


def extract_answer_candidates(sentence: str) -> List[str]:
    """
    Extracts possible answer phrases from a fact using generic NLP signals:
    noun chunks, named entities, and noun-preposition-noun phrases.
    No lecture/PDF-specific words are used.
    """
    s = normalize_sentence(repair_common_extraction_spacing(sentence))
    cache_key = normalize_key(s)
    if cache_key in _SPACY_CANDIDATE_CACHE:
        return _SPACY_CANDIDATE_CACHE[cache_key]

    candidates: List[str] = []

    nlp = load_spacy_model()
    if nlp is not None:
        try:
            doc = nlp(s)

            for ent in doc.ents:
                cand = strip_quotes(ent.text)
                if candidate_is_reasonable(cand):
                    candidates.append(cand)

            for chunk in doc.noun_chunks:
                cand = strip_quotes(chunk.text)
                cand = re.sub(r"^(a|an|the|this|that|these|those)\s+", "", cand, flags=re.IGNORECASE).strip()
                if candidate_is_reasonable(cand):
                    candidates.append(cand)

                # Also consider the root term when the full chunk is too broad.
                root = strip_quotes(getattr(chunk.root, "text", ""))
                if candidate_is_reasonable(root):
                    candidates.append(root)
        except Exception:
            pass

    candidates.extend(extract_regex_phrase_candidates(s))

    # Preserve order while deduplicating. Prefer more specific multi-word candidates first.
    unique: Dict[str, str] = {}
    for cand in candidates:
        ck = candidate_key(cand)
        if ck and ck not in unique:
            unique[ck] = strip_quotes(cand)

    ranked = sorted(
        unique.values(),
        key=lambda x: (word_count(x) >= 2, min(word_count(x), 6), len(content_tokens(x))),
        reverse=True,
    )
    ranked = ranked[:MAX_ANSWER_CANDIDATES_PER_FACT]
    _SPACY_CANDIDATE_CACHE[cache_key] = ranked
    return ranked


def answer_supported_by_candidates(answer: str, source: str) -> bool:
    """
    Generic validation that the answer looks like a real phrase from the source.
    If spaCy is unavailable and SPACY_FAIL_OPEN is true, do not block generation.
    """
    if not USE_SPACY_CANDIDATES:
        return True

    nlp = load_spacy_model()
    candidates = extract_answer_candidates(source)

    if not candidates:
        return SPACY_FAIL_OPEN or nlp is None

    ak = candidate_key(answer)
    if not ak:
        return False

    for cand in candidates:
        ck = candidate_key(cand)
        if ak == ck:
            return True

        # Allow close multi-word phrase containment, but not one-word vague matches.
        if word_count(answer) >= 2 and (ak in ck or ck in ak):
            if content_overlap(answer, cand) >= 0.50:
                return True

    # Generic allowance for a leading term in definition/action facts.
    # Example shape only: "Term is/means/refers to ..." for any subject.
    escaped = re.escape(strip_quotes(answer))
    if word_count(answer) <= 4 and re.match(rf"^{escaped}\s+(?:{LINKING_VERBS})\b", source, flags=re.IGNORECASE):
        return True

    return False


def starts_badly(text: str) -> bool:
    s = clean_text(text)
    m = re.match(r"[A-Za-z]+", s)
    if not m:
        return True
    if m.group(0).lower() in BAD_START_WORDS:
        return True
    if s and s[0].islower():
        return True
    return False


def collapse_repeated_leading_words(text: str) -> str:
    """
    Generic cleanup for duplicated headings and repeated leading spans.
    """
    words = clean_text(text).split()
    if len(words) < 4:
        return clean_text(text)

    lowers = [re.sub(r"\W+", "", w.lower()) for w in words]

    for n in range(1, min(8, len(words) // 2) + 1):
        if lowers[:n] == lowers[n:2 * n]:
            return clean_text(" ".join(words[n:]))

    for n in range(2, min(6, len(words) // 2) + 1):
        first_span = lowers[:n]
        for start in range(n, min(len(words) - n + 1, 12)):
            if first_span[-min(n, 3):] == lowers[start:start + min(n, 3)]:
                left = " ".join(words[:start])
                if title_case_ratio(left) >= 0.45:
                    return clean_text(" ".join(words[start:]))

    return clean_text(text)


def repair_common_extraction_spacing(text: str) -> str:
    s = deglue_extraction_words(text)

    split_word_repairs = {
        r"\bw\s+as\b": "was",
        r"\bh\s+as\b": "has",
        r"\bc\s+an\b": "can",
        r"\ba\s+re\b": "are",
        r"\bi\s+s\b": "is",
        r"\bin\s+to\b": "into",
    }
    for pattern, replacement in split_word_repairs.items():
        s = re.sub(pattern, replacement, s, flags=re.IGNORECASE)

    s = collapse_repeated_leading_words(s)
    return clean_text(s)


# =========================
# Quality checks
# =========================

def source_noise(text: str) -> bool:
    s = clean_text(text)
    low = s.lower()

    if word_count(s) < 6:
        return True

    if any(re.search(p, low, flags=re.IGNORECASE) for p in NOISE_PATTERNS):
        return True

    if re.search(r"[a-z][A-Z]", s):
        return True

    if starts_badly(s):
        return True

    starts = len(re.findall(
        r"\b(A|An|The)\s+[A-Za-z][A-Za-z'/-]*(?:\s+[A-Za-z][A-Za-z'/-]*){0,5}\s+"
        r"(?:is|are|means|represents|describes|defines|indicates)\b",
        s,
        flags=re.IGNORECASE,
    ))
    if starts >= 2:
        return True

    if word_count(s) <= 10 and title_case_ratio(s) >= 0.75 and not re.search(rf"\b(?:{LINKING_VERBS})\b", low):
        return True

    return False


def phrase_is_bad_answer(phrase: str) -> bool:
    p = strip_quotes(repair_common_extraction_spacing(phrase))
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'/-]*", p)
    if not words:
        return True

    lw = [w.lower() for w in words]

    if len(words) == 1 and lw[0] in WEAK_SINGLE_WORD_ANSWERS:
        return True

    if len(words) > 7 or len(p) < 3 or len(p) > 80:
        return True

    if lw[0] in BAD_ANSWER_WORDS or lw[-1] in BAD_ANSWER_WORDS:
        return True

    if not any(w not in STOPWORDS for w in lw):
        return True

    if len(words) == 1 and (len(words[0]) < 4 or lw[0] in BAD_ANSWER_WORDS):
        return True

    if sum(1 for w in words if w.isdigit()) >= 2:
        return True

    meaningful = [w for w in lw if w not in STOPWORDS]
    if len(meaningful) == 0:
        return True

    return False


def answer_looks_generic_connector_head(answer: str) -> bool:
    words = [w.lower() for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9'/-]*", answer or "")]
    if not words:
        return True

    meaningful = [w for w in words if w not in STOPWORDS]
    if not meaningful:
        return True

    # Single-word weak heads are too vague.
    if len(meaningful) == 1 and meaningful[0] in WEAK_CONNECTOR_HEADS:
        return True

    # Short phrases ending with a weak abstract head are often vague in "a ___ of" questions.
    if len(meaningful) <= 3 and meaningful[-1] in WEAK_CONNECTOR_HEADS:
        return True

    return False


def short_label_before_linking_verb(question: str) -> bool:
    # Captures generic label-style starts: "Short Label is/are ...".
    m = re.match(r"^([A-Za-z][A-Za-z0-9'/-]*(?:\s+[A-Za-z][A-Za-z0-9'/-]*){0,4})\s+(?:is|are|means|refers to)\b", question)
    if not m:
        return False

    label = clean_text(m.group(1))
    wc = word_count(label)
    if wc == 0 or wc > 5:
        return False

    # A short label followed by a connector cloze is usually less useful than an end-blank definition.
    return True



def looks_like_procedural_called_question(question: str) -> bool:
    """
    Generic quality filter.
    Rejects questions that turn an instruction/purpose phrase into a definition, such as:
    "A report to summarize results is called ________."
    This is not topic-specific; it only checks grammar shape.
    """
    q = normalize_sentence(repair_common_extraction_spacing(question)).rstrip(".")
    low = q.lower()

    if not re.search(r"\bis called\s+" + re.escape(BLANK.lower()) + r"\s*$", low):
        return False

    before_called = re.split(r"\bis called\b", q, flags=re.IGNORECASE)[0]

    # A/An/The + noun phrase + to + base verb ... is called ____
    # Often comes from procedural slide bullets like "Draw X to establish Y".
    if re.search(r"^(a|an|the)\s+.{2,80}\s+to\s+[a-z]{3,}\b", before_called, flags=re.IGNORECASE):
        return True

    return False


def looks_like_robotic_backend_writing(question: str) -> bool:
    """
    Generic style filter for unnatural template wording.
    Prefer natural Ollama wording over backend template wording.
    """
    q = normalize_sentence(repair_common_extraction_spacing(question)).lower()
    if q.startswith("the fact that "):
        return True
    if q.startswith("the statement that "):
        return True
    return False

def question_is_bad(question: str, answer: str = "") -> bool:
    q = normalize_sentence(repair_common_extraction_spacing(question))
    low = q.lower()

    if looks_like_robotic_backend_writing(q):
        return True

    if looks_like_procedural_called_question(q):
        return True

    if q.count(BLANK) != 1:
        return True

    if q.strip().startswith(BLANK):
        return True

    if word_count(q) < 7 or word_count(q) > 46:
        return True

    if starts_badly(q.replace(BLANK, "answer")):
        return True

    if re.search(r"\b(for|of|to|from|by|with|as)\s+(is|are|was|were)\b", low):
        return True

    if re.search(r"\b(is|are|was|were)\s+" + re.escape(BLANK) + r"\s+(a|an|the)\b", low):
        return True

    if re.search(re.escape(BLANK) + r"\s+([a-z]+ed|[a-z]+ing)\b", low):
        return True

    if re.search(r"\b(who|what|where|when|why|how)\b.*\bis called\s+" + re.escape(BLANK), low):
        return True

    if answer and normalize_key(answer) in normalize_key(q.replace(BLANK, "")):
        return True

    if re.search(r"\b(w\s+as|h\s+as|c\s+an|a\s+re|i\s+s)\b", q, flags=re.IGNORECASE):
        return True

    if answer and word_count(answer) == 1 and answer.lower() in WEAK_SINGLE_WORD_ANSWERS:
        return True

    # Generic cloze-quality filter:
    # Reject vague connector blanks like "X is the ________ of ...".
    connector_blank = re.search(
        r"\b(is|are|means|refers to)\s+(a|an|the)\s+" + re.escape(BLANK) + r"\s+(of|for|to|in|by|with|between|from)\b",
        low,
    )
    if connector_blank and answer_looks_generic_connector_head(answer):
        return True

    # Even when the answer is not on the weak list, this shape is usually bad if the subject is a short label.
    if connector_blank and short_label_before_linking_verb(q) and word_count(answer) <= 3:
        return True

    # Avoid one-word blanks followed by connectors.
    if answer and word_count(answer) == 1:
        connector_after_blank = re.search(
            re.escape(BLANK) + r"\s+(of|for|to|in|by|with|between|from)\b",
            low,
        )
        article_blank_connector = re.search(
            r"\b(a|an|the)\s+" + re.escape(BLANK) + r"\s+(of|for|to|in|by|with|between|from)\b",
            low,
        )
        if connector_after_blank or article_blank_connector:
            return True

    # Avoid heading-glue questions.
    prefix = clean_text(q.split(BLANK)[0])
    if word_count(prefix) >= 5 and title_case_ratio(prefix) > 0.55:
        has_clause_word = re.search(
            r"\b(a|an|the|that|which|who|where|when|is|are|was|were|means|refers|called|known|"
            r"specifies|indicates|requires|includes|describes)\b",
            prefix.lower(),
        )
        if not has_clause_word:
            return True

    return False


def clean_fact_is_grounded(clean_fact: str, original_fact: str) -> bool:
    clean_tokens = set(content_tokens(clean_fact))
    original_tokens = set(content_tokens(original_fact))

    if not clean_tokens or not original_tokens:
        return False

    overlap = len(clean_tokens & original_tokens) / max(1, len(clean_tokens))
    return overlap >= 0.78


def validate_item(question: str, answer: str, source: str) -> Optional[Dict[str, str]]:
    q = normalize_sentence(repair_common_extraction_spacing(question))
    a = strip_quotes(repair_common_extraction_spacing(answer))
    s = normalize_sentence(repair_common_extraction_spacing(source))

    if source_noise(s) or phrase_is_bad_answer(a) or question_is_bad(q, a):
        return None

    if normalize_key(a) not in normalize_key(s):
        return None

    # The answer should look like a real noun phrase / entity / key phrase from the source.
    # This is generic and not tied to any lecture topic.
    if not answer_supported_by_candidates(a, s):
        return None

    reconstructed = q.replace(BLANK, a)
    lexical_ok = content_overlap(reconstructed, s) >= 0.18 or seq_similarity(reconstructed, s) >= 0.34
    semantic_score = semantic_similarity(reconstructed, s)

    if semantic_score < SEMANTIC_THRESHOLD:
        return None

    if not lexical_ok and semantic_score < SEMANTIC_STRICT_THRESHOLD:
        return None

    return {
        "question": q,
        "answer": a,
        "source_sentence": s,
    }


# =========================
# Fact extraction / backend templates
# =========================

def compact_term(term: str) -> str:
    t = strip_quotes(repair_common_extraction_spacing(term))
    t = re.sub(r"^(the|a|an)\s+", "", t, flags=re.IGNORECASE)
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'/-]*", t)
    if not words:
        return ""

    lowers = [w.lower() for w in words]

    for i, w in enumerate(lowers):
        if w in lowers[i + 1:]:
            j = lowers.index(w, i + 1)
            if 1 <= j - i <= 4:
                words = words[i:j]
                break

    if len(words) >= 3 and words[0].lower() == words[-1].lower():
        words = words[:-1]

    # Keep the core term before a descriptive modifier.
    for prep in {"with", "between", "from", "for", "of", "by", "in"}:
        lower_words = [w.lower() for w in words]
        if prep in lower_words:
            idx = lower_words.index(prep)
            if 1 <= idx <= 3:
                core = words[:idx]
                core_text = strip_quotes(" ".join(core))
                if core_text and not phrase_is_bad_answer(core_text):
                    return core_text

    if len(words) > 6:
        words = words[-4:]

    return strip_quotes(" ".join(words))


def compact_missing_copula_term(prefix: str) -> str:
    p = strip_quotes(repair_common_extraction_spacing(prefix))
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'/-]*", p)
    if not words:
        return ""

    if len(words) >= 4 and title_case_ratio(p) >= 0.35:
        p = " ".join(words[-3:])
    elif len(words) > 6:
        p = " ".join(words[-4:])

    return compact_term(p)


def clean_definition_text(definition: str) -> str:
    d = clean_text(definition).rstrip(".")
    d = re.sub(r"\s*\([^)]{1,45}\)", "", d)
    d = re.sub(r"\bfor the purpose of\b", "for", d, flags=re.IGNORECASE)
    d = re.sub(r"\s+", " ", d).strip()
    return d


def fact_score(fact: str) -> int:
    low = fact.lower()
    score = 0

    if re.search(rf"\b(?:{LINKING_VERBS})\b", low):
        score += 8

    if re.search(r"\b(a|an|the)\s+[A-Za-z][A-Za-z'/-]+", fact, flags=re.IGNORECASE):
        score += 3

    if re.search(r"\b(that|which|who|where|when|because|before|after)\b", low):
        score += 2

    wc = word_count(fact)
    if 8 <= wc <= 30:
        score += 7
    elif 31 <= wc <= 38:
        score += 2
    elif wc > 38:
        score -= 8

    if source_noise(fact):
        score -= 30

    return score


def add_fact(facts: List[str], seen: set, text: str) -> None:
    f = normalize_sentence(repair_common_extraction_spacing(text))

    m = re.match(
        r"^(?P<prefix>.{2,110}?)\s+(?P<article>a|an|the)\s+"
        r"(?P<definition>[A-Za-z][^.!?]{24,220})$",
        f.rstrip("."),
        flags=re.IGNORECASE,
    )
    if m and not re.search(rf"\b(?:{LINKING_VERBS}|called)\b", m.group("prefix"), flags=re.IGNORECASE):
        raw_prefix = clean_text(m.group("prefix"))
        prefix_ends_with_prep = bool(re.search(r"\b(with|between|from|for|of|by|in|on|to)\s*$", raw_prefix, flags=re.IGNORECASE))
        if not prefix_ends_with_prep:
            term = compact_missing_copula_term(raw_prefix)
            definition = clean_text(m.group("definition"))
            if term and word_count(term) <= 6 and not phrase_is_bad_answer(term) and word_count(definition) >= 5:
                f = normalize_sentence(f"{term} is {m.group('article')} {definition}")

    if len(f) < 35 or len(f) > 280 or source_noise(f):
        return

    key = normalize_key(f)
    if key and key not in seen:
        seen.add(key)
        facts.append(f)


def extract_fact_segments(source_text: str) -> List[str]:
    text = repair_common_extraction_spacing(source_text[:MAX_SOURCE_CHARS])

    text = re.sub(
        rf"([a-z0-9\)])\s+([A-Z][A-Za-z0-9'/-]+(?:\s+[A-Za-z0-9'/-]+){{0,6}}\s+"
        rf"(?:{LINKING_VERBS})\b)",
        r"\1. \2",
        text,
    )

    text = re.sub(
        r"([a-z0-9\)])\s+([A-Z][A-Za-z0-9'/-]+(?:\s+[A-Za-z0-9'/-]+){0,6}\s+"
        r"(?:a|an|the)\s+[A-Za-z])",
        r"\1. \2",
        text,
    )

    text = re.sub(r"\s+(?=\d+(?:[-.]\d+)+\s+[A-Z])", ". ", text)
    text = re.sub(r"\s+(?=\d+\.\s*[A-Z])", ". ", text)

    chunks = re.split(r"(?<=[.!?])\s+", text)
    facts: List[str] = []
    seen = set()

    for chunk in chunks:
        c = clean_text(chunk)
        if not c:
            continue

        add_fact(facts, seen, c)

        patterns = [
            rf"([A-Z][A-Za-z0-9'/-]*(?:\s+[A-Za-z0-9'/-]+){{0,7}}\s+"
            rf"(?:{LINKING_VERBS})\s+[^.!?]{{20,210}})",
            r"([A-Z][A-Za-z0-9'/-]*(?:\s+[A-Za-z0-9'/-]+){0,7}\s+"
            r"(?:a|an|the)\s+[^.!?]{25,210})",
        ]

        for pat in patterns:
            for match in re.finditer(pat, c, flags=re.IGNORECASE):
                add_fact(facts, seen, match.group(1))

    facts.sort(key=fact_score, reverse=True)
    return facts[:MAX_FACTS]


def accepted_answer_variants(answer: str) -> List[str]:
    a = strip_quotes(answer)
    variants = {a, a.lower()}

    no_article = re.sub(r"^(a|an|the)\s+", "", a, flags=re.IGNORECASE).strip()
    if no_article:
        variants.add(no_article)

    if a.lower().endswith("s") and not a.lower().endswith("ss") and len(a) > 4:
        variants.add(a[:-1])

    return [v for v in variants if v]


def difficulty_for(source: str, answer: str) -> str:
    if word_count(answer) >= 2:
        return "Hard"
    if word_count(source) >= 16:
        return "Hard"
    return "Medium"


def make_item(question: str, answer: str, source: str, method: str, bonus: int = 0) -> Optional[Dict[str, Any]]:
    valid = validate_item(question, answer, source)
    if not valid:
        return None

    return {
        "type": "fill_blank",
        "difficulty": difficulty_for(valid["source_sentence"], valid["answer"]),
        "question": valid["question"],
        "answer": valid["answer"],
        "accepted_answers": accepted_answer_variants(valid["answer"]),
        "explanation": f'The answer is directly supported by the source sentence: "{valid["source_sentence"]}"',
        "generation_method": method,
        "source_sentence": valid["source_sentence"],
        "quality_score": fact_score(valid["source_sentence"]) + bonus,
    }


def templates_from_fact(fact: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    s = normalize_sentence(repair_common_extraction_spacing(fact)).rstrip(".")

    m = re.match(
        rf"^(?P<term>[A-Za-z][A-Za-z0-9'/-]*(?:\s+[A-Za-z][A-Za-z0-9'/-]*){{0,7}})\s+"
        rf"(?P<verb>{DEFINITION_VERBS})\s+(?P<definition>.+)$",
        s,
        flags=re.IGNORECASE,
    )
    if m:
        term = compact_term(m.group("term"))
        definition = clean_definition_text(m.group("definition"))

        if term and not phrase_is_bad_answer(term) and 5 <= word_count(definition) <= 34:
            item = make_item(
                f"{definition[:1].upper() + definition[1:]} is called {BLANK}.",
                term,
                s,
                "backend_definition_end",
                10,
            )
            if item:
                out.append(item)

        m2 = re.match(
            r"^(a|an|the)\s+"
            r"(?P<phrase>[A-Za-z][A-Za-z0-9'/-]*(?:\s+[A-Za-z][A-Za-z0-9'/-]*){0,2})\s+"
            r"(?P<tail>(?:that|which|to|in|by|between|with|performed|triggered|"
            r"initiated|used|created|represented|completed|containing|consisting)\b.+)$",
            definition,
            flags=re.IGNORECASE,
        )
        if m2:
            article = m2.group(1)
            phrase = strip_quotes(m2.group("phrase"))
            tail = clean_text(m2.group("tail")).rstrip(".")
            if not phrase_is_bad_answer(phrase):
                item = make_item(
                    f"{term} is {article} {BLANK} {tail}.",
                    phrase,
                    s,
                    "backend_definition_middle",
                    8,
                )
                if item:
                    out.append(item)

    m = re.match(
        rf"^(?P<term>[A-Za-z][A-Za-z0-9'/-]*(?:\s+[A-Za-z][A-Za-z0-9'/-]*){{0,8}})\s+"
        rf"(?P<verb>{ACTION_VERBS})\s+(?P<rest>.+)$",
        s,
        flags=re.IGNORECASE,
    )
    if m:
        term = compact_term(m.group("term"))
        verb = m.group("verb").lower()
        rest = clean_text(m.group("rest")).rstrip(".")

        if term and not phrase_is_bad_answer(term) and 5 <= word_count(rest) <= 34:
            rest_core = re.sub(r"^that\s+", "", rest, flags=re.IGNORECASE).strip()
            rest_core = rest_core[:1].upper() + rest_core[1:] if rest_core else rest

            past_map = {
                "indicate": "indicated", "indicates": "indicated",
                "show": "shown", "shows": "shown",
                "represent": "represented", "represents": "represented",
                "describe": "described", "describes": "described",
                "specify": "specified", "specifies": "specified",
                "include": "included", "includes": "included",
                "contain": "contained", "contains": "contained",
                "require": "required", "requires": "required",
                "allow": "allowed", "allows": "allowed",
                "provide": "provided", "provides": "provided",
                "involve": "involved", "involves": "involved",
            }
            past = past_map.get(verb, verb + "d")
            rest_for_question = rest_core[:1].lower() + rest_core[1:] if rest_core else rest_core
            item = make_item(
                f"The fact that {rest_for_question} is {past} by {BLANK}.",
                term,
                s,
                "backend_action_end",
                10,
            )
            if item:
                out.append(item)

    return out


def build_backend_candidates(facts: List[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for f in facts:
        out.extend(templates_from_fact(f))
    return out


# =========================
# Ollama generation
# =========================

def clean_ollama_json(raw: str) -> str:
    raw = re.sub(r"<think>.*?</think>", "", raw or "", flags=re.DOTALL)
    raw = re.sub(r"```(?:json)?", "", raw.strip(), flags=re.IGNORECASE).replace("```", "")
    return raw.strip()


def extract_json(raw: str):
    raw = clean_ollama_json(raw)

    try:
        return json.loads(raw)
    except Exception:
        pass

    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    try:
        return json.loads(raw[start:end + 1])
    except Exception:
        return None


def ollama_generate_json(prompt: str, timeout: int = OLLAMA_TIMEOUT, num_predict: int = 1300):
    schema = {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "source_id": {"type": "integer"},
                        "clean_fact": {"type": "string"},
                        "question": {"type": "string"},
                        "answer_phrase": {"type": "string"},
                    },
                    "required": ["source_id", "clean_fact", "question", "answer_phrase"],
                },
            }
        },
        "required": ["items"],
    }

    base_payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt + "\n\nReturn JSON only. Match this schema exactly:\n" + json.dumps(schema, ensure_ascii=False),
        "stream": False,
        "options": {
            "temperature": 0.03,
            "top_p": 0.75,
            "repeat_penalty": 1.12,
            "num_ctx": 4096,
            "num_predict": num_predict,
        },
    }

    payload = dict(base_payload)
    payload["format"] = schema
    payload["think"] = False

    try:
        response = requests.post(f"{OLLAMA_HOST}/api/generate", json=payload, timeout=timeout)
        response.raise_for_status()
        data = extract_json(response.json().get("response", ""))
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    payload = dict(base_payload)
    payload["format"] = "json"

    response = requests.post(f"{OLLAMA_HOST}/api/generate", json=payload, timeout=timeout)
    response.raise_for_status()
    return extract_json(response.json().get("response", ""))


def ollama_candidates(facts: List[str], already_answers: Optional[List[str]] = None) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    if not USE_OLLAMA_FILL_BLANK or not facts:
        return [], None

    already_answers = already_answers or []
    fact_items = [
        {
            "id": i,
            "fact": f,
            "answer_candidates": extract_answer_candidates(f),
        }
        for i, f in enumerate(facts[:MAX_FACTS])
    ]

    prompt = f"""
You are generating Fill-in-the-Blank exam questions from extracted lecture facts.

Main goal:
Create clean, grammatical, exam-style Fill-in-the-Blank questions that can work for any subject.

Rules:
- Use ONLY the provided facts.
- Do NOT add outside knowledge.
- Do NOT use memorized subject answers.
- You may lightly repair a broken extracted fact into clean_fact, but clean_fact must keep the same meaning and use the same content words.
- If a fact looks like a title glued to a sentence, make clean_fact a normal sentence.
- answer_phrase must appear exactly inside clean_fact.
- If answer_candidates are provided for a fact, choose answer_phrase from answer_candidates whenever possible.
- Prefer noun phrases, named entities, and key terms over single generic words.
- Do NOT put the blank at the beginning.
- Use exactly one blank: {BLANK}
- Prefer natural end-blank definition questions, such as: "A clear definition is called {BLANK}."
- Avoid robotic wording like: "The fact that ... is indicated by {BLANK}."
- Avoid turning procedural/purpose statements into definitions, such as: "A tool to do something is called {BLANK}."
- Avoid vague connector blanks, such as: "X is the {BLANK} of Y."
- Prefer important terms or short phrases as answer_phrase.
- Do NOT use weak generic answers such as process, method, way, type, kind, form, part, purpose, step, item, description, sequence.
- Avoid answers that are only grammar words.
- Repair obvious split words in clean_fact and question.
- Avoid these answers: {json.dumps(already_answers, ensure_ascii=False)}
- Make questions answerable without seeing the original full paragraph.
- Return at most {MAX_OLLAMA_ITEMS} items.
- Return JSON only.

JSON format:
{{
  "items": [
    {{
      "source_id": 0,
      "clean_fact": "Clean sentence based only on the source fact.",
      "question": "Clean sentence with exactly one {BLANK}.",
      "answer_phrase": "exact phrase from clean_fact"
    }}
  ]
}}

Facts:
{json.dumps(fact_items, ensure_ascii=False, indent=2)}
"""

    try:
        data = ollama_generate_json(prompt, timeout=OLLAMA_TIMEOUT, num_predict=1300)
    except Exception as exc:
        return [], str(exc)

    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return [], "Ollama did not return a valid JSON object with items."

    by_id = {i: f for i, f in enumerate(facts[:MAX_FACTS])}
    out: List[Dict[str, Any]] = []

    for raw_item in data.get("items", []):
        if not isinstance(raw_item, dict):
            continue

        try:
            sid = int(raw_item.get("source_id", -1))
        except Exception:
            sid = -1

        original_fact = by_id.get(sid, "")
        clean_fact = normalize_sentence(repair_common_extraction_spacing(str(raw_item.get("clean_fact", ""))))
        question = str(raw_item.get("question", ""))
        answer = str(raw_item.get("answer_phrase", ""))

        if not original_fact or not clean_fact_is_grounded(clean_fact, original_fact):
            continue

        made = make_item(
            question=question,
            answer=answer,
            source=clean_fact,
            method="ollama_first_validated",
            bonus=18,
        )

        if made:
            made["original_source_sentence"] = original_fact
            out.append(made)

    return out, None


# =========================
# Deduplication and final selection
# =========================

def too_similar(a: str, b: str) -> bool:
    ak, bk = normalize_key(a), normalize_key(b)
    if not ak or not bk:
        return False

    if ak == bk:
        return True

    seq = SequenceMatcher(None, ak, bk).ratio()
    sa, sb = set(content_tokens(a)), set(content_tokens(b))
    overlap = len(sa & sb) / max(1, len(sa | sb)) if sa and sb else 0.0

    return seq >= 0.78 and overlap >= 0.35


def answer_family(answer: str) -> str:
    a = normalize_key(answer)
    a = re.sub(r"^(a|an|the)\s+", "", a)

    if a.endswith("s") and len(a) > 4:
        a = a[:-1]

    return a


def dedupe_candidates(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen_q, seen_a = set(), set()

    for c in sorted(candidates, key=lambda x: x.get("quality_score", 0), reverse=True):
        valid = validate_item(c.get("question", ""), c.get("answer", ""), c.get("source_sentence", ""))
        if not valid:
            continue

        q_key = normalize_key(valid["question"])
        a_key = answer_family(valid["answer"])

        if not q_key or not a_key or q_key in seen_q or a_key in seen_a:
            continue

        if any(too_similar(valid["question"], old["question"]) for old in out):
            continue

        c["question"] = valid["question"]
        c["answer"] = valid["answer"]
        c["source_sentence"] = valid["source_sentence"]
        c["accepted_answers"] = accepted_answer_variants(valid["answer"])
        c["explanation"] = f'The answer is directly supported by the source sentence: "{valid["source_sentence"]}"'

        seen_q.add(q_key)
        seen_a.add(a_key)
        out.append(c)

    return out


def blank_position(question: str) -> str:
    i = question.find(BLANK)
    if i < 0:
        return "none"
    return "end" if i / max(1, len(question)) >= 0.70 else "middle"


def select_final(candidates: List[Dict[str, Any]], target: int = TARGET_TOTAL) -> List[Dict[str, Any]]:
    pool = dedupe_candidates(candidates)
    final: List[Dict[str, Any]] = []

    desired_positions = ["end", "middle", "end", "middle", "end", "middle"]

    for pos in desired_positions:
        for c in pool:
            if c not in final and blank_position(c["question"]) == pos:
                final.append(c)
                break
        if len(final) >= target:
            break

    if len(final) < target:
        for c in pool:
            if c not in final:
                final.append(c)
                if len(final) >= target:
                    break

    return final[:target]


def strip_internal(questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned = []
    for q in questions:
        item = dict(q)
        item.pop("source_sentence", None)
        item.pop("original_source_sentence", None)
        item.pop("quality_score", None)
        cleaned.append(item)
    return cleaned


# =========================
# Public API
# =========================

def generate_fill_blank_quiz(source_text: str, total_questions: int = TARGET_TOTAL) -> Dict[str, Any]:
    source_text = clean_text(source_text)

    if len(source_text) < 80:
        return {
            "questions": [],
            "error": "Not enough source text.",
            "code_version": CODE_VERSION,
        }

    facts = extract_fact_segments(source_text)
    backend = build_backend_candidates(facts)

    ollama: List[Dict[str, Any]] = []
    ollama_error: Optional[str] = None

    if USE_OLLAMA_FILL_BLANK:
        ollama, ollama_error = ollama_candidates(
            facts,
            already_answers=[],
        )

    # Prefer Ollama wording because it is more natural.
    # If not enough clean Ollama questions pass validation, retry Ollama once before using backend templates.
    final = select_final(ollama, total_questions)

    retry_used = False
    if USE_OLLAMA_FILL_BLANK and OLLAMA_RETRY_IF_SHORT and len(final) < total_questions:
        retry_used = True
        already = [q.get("answer", "") for q in final]
        more_ollama, retry_error = ollama_candidates(facts, already_answers=already)
        if retry_error and not ollama_error:
            ollama_error = retry_error
        ollama = dedupe_candidates(ollama + more_ollama)
        final = select_final(ollama, total_questions)

    used_backend_fallback = False
    if len(final) < total_questions and ALLOW_BACKEND_FALLBACK:
        final = select_final(ollama + backend, total_questions)
        used_backend_fallback = True

    for q in final:
        q["polish_safety"] = "backend_validated_source_grounded"
        q["ollama_model"] = OLLAMA_MODEL if str(q.get("generation_method", "")).startswith("ollama") else None

    response = {
        "questions": strip_internal(final),
        "code_version": CODE_VERSION,
        "model": "ollama_natural_first_spacy_embedding_validated" if USE_OLLAMA_FILL_BLANK else "backend_spacy_embedding_validated_only",
        "ollama_model": OLLAMA_MODEL if USE_OLLAMA_FILL_BLANK else None,
        "quiz_mode": "fill_blank_any_pdf_spacy_embedding_natural_no_topic_hardcode",
        "debug_plan": {
            "used_content_chars": min(len(source_text), MAX_SOURCE_CHARS),
            "fact_count": len(facts),
            "backend_candidate_count": len(backend),
            "ollama_candidate_count": len(ollama),
            "target": total_questions,
            "returned": len(final),
            "strategy": "generic fact extraction; spaCy answer candidates; Ollama proposes; source grounding; semantic validation; generic cloze-shape filters",
            "no_topic_specific_hardcoding": True,
            "topic_word_scoring": False,
            "memorized_answers": False,
            "ollama_error": ollama_error,
            "semantic_validation": USE_SEMANTIC_VALIDATION,
            "embedding_model": EMBEDDING_MODEL if USE_SEMANTIC_VALIDATION else None,
            "spacy_candidates": USE_SPACY_CANDIDATES,
            "spacy_model": SPACY_MODEL if USE_SPACY_CANDIDATES else None,
            "spacy_fail_open": SPACY_FAIL_OPEN,
            "backend_fallback_allowed": ALLOW_BACKEND_FALLBACK,
            "backend_fallback_used": used_backend_fallback,
            "ollama_retry_if_short": OLLAMA_RETRY_IF_SHORT,
            "ollama_retry_used": retry_used,
            "semantic_threshold": SEMANTIC_THRESHOLD,
            "semantic_strict_threshold": SEMANTIC_STRICT_THRESHOLD,
            "semantic_fail_open": SEMANTIC_FAIL_OPEN,
            "code_version": CODE_VERSION,
        },
    }

    if len(final) < total_questions:
        response["error"] = f"Only generated {len(final)} clean questions. Refused broken, vague, or duplicate questions."

    return response


def generate_fill_blank(source_text: str):
    return generate_fill_blank_quiz(source_text)


def generate_fill_in_blank_quiz(source_text: str):
    return generate_fill_blank_quiz(source_text)


if __name__ == "__main__":
    import sys
    print(json.dumps(generate_fill_blank_quiz(sys.stdin.read()), indent=2, ensure_ascii=False))
