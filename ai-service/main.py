from __future__ import annotations

import asyncio
import math
import re
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="StudyFlow Hybrid Summary API")

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
DEFAULT_MODEL = "qwen3:1.7b"

REQUEST_TIMEOUT = 35.0
MODEL_HARD_DEADLINE = 18.0

MAX_INPUT_CHARS = 22000
MIN_INPUT_CHARS = 160
MIN_SUMMARY_WORDS = 70
MAX_SUMMARY_WORDS = 115
LOW_CONTEXT_MIN_WORDS = 45

MAX_EVIDENCE_SENTENCES = 8
MAX_REWRITE_EVIDENCE = 6
MAX_SOURCE_CHARS = 1400

OVERLAP_THRESHOLD = 0.20
REPETITION_THRESHOLD = 0.28

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "for", "from",
    "has", "have", "had", "he", "her", "his", "how", "i", "if", "in", "into", "is",
    "it", "its", "of", "on", "or", "that", "the", "their", "them", "there", "these",
    "they", "this", "to", "was", "were", "will", "with", "would", "can", "could",
    "should", "may", "might", "not", "no", "yes", "you", "your", "we", "our", "us",
    "do", "does", "did", "done", "than", "then", "such", "also", "very", "more",
    "most", "some", "any", "all", "each", "other", "another", "one", "two", "three",
    "about", "after", "before", "between", "while", "where", "when", "which", "what",
    "who", "whom", "why", "so", "because", "therefore", "thus", "using", "use",
    "used", "within", "without", "over", "under", "up", "down", "out", "off",
}

NOISE_WORDS = {
    "slide", "slides", "lecture", "week", "chapter", "download", "summary", "generated",
    "university", "faculty", "department", "student", "students", "semester", "page",
    "copyright", "www", "http", "https", "com", "edu",
}

BANNED_OPENINGS = (
    "the text", "this text", "the passage", "this passage", "the document", "this document",
    "in this", "the slides", "these slides", "this chapter", "the chapter", "overall",
)

VERB_HINTS = {
    "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "can", "could",
    "may", "might", "must", "should", "will", "would", "use", "uses", "used", "using",
    "explain", "explains", "describe", "describes", "show", "shows", "improve", "improves",
    "provide", "provides", "support", "supports", "rank", "ranks", "retrieve", "retrieves",
    "match", "matches", "measure", "measures", "identify", "identifies", "estimate", "estimates",
    "reduce", "reduces", "compare", "compares", "form", "forms", "focus", "focuses",
}

TRANSITIONS = [
    "", "Additionally", "Moreover", "In practice", "At the same time", "As a result", "Importantly",
]

DISCOURSE_MARKERS = {
    "additionally", "moreover", "however", "therefore", "thus", "finally", "meanwhile",
    "contrary", "importantly", "overall", "consequently", "instead",
}

DANGLING_TAIL_WORDS = {"and", "or", "but", "nor", "yet", "so", "with", "to", "by", "from"}

http_client: httpx.AsyncClient | None = None


class SummaryRequest(BaseModel):
    text: str = Field(..., min_length=1)
    model: str = DEFAULT_MODEL
    max_words: int = MAX_SUMMARY_WORDS
    fast_mode: bool = True
    document_style: str = "slides"


class SummaryResponse(BaseModel):
    summary: str
    duration_sec: float
    mode: str
    selected_sentences: int
    model: str


@dataclass
class EvidenceSentence:
    text: str
    index: int
    score: float


@app.on_event("startup")
async def startup_event() -> None:
    global http_client
    http_client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)


@app.on_event("shutdown")
async def shutdown_event() -> None:
    global http_client
    if http_client is not None:
        await http_client.aclose()


def normalize_unicode(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\ufeff", "")
    text = text.replace("ﬁ", "fi").replace("ﬂ", "fl")
    return text


def normalize_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\t", " ")
    text = re.sub(r"[ \u00A0]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(
        r"(?<=[a-z0-9])\s+(?=(Clearly|However|Therefore|Thus|Moreover|Additionally|Importantly|Consequently|Meanwhile|Instead|Overall)\b)",
        ". ",
        text,
    )
    return text.strip()


def strip_page_noise(line: str) -> str:
    line = line.strip(" -–—•▪◦➢*\t")
    line = re.sub(r"\s+", " ", line).strip()
    line = re.sub(r"\bPage\s+\d+(\s+of\s+\d+)?\b", "", line, flags=re.I)
    line = re.sub(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", "", line)
    return re.sub(r"\s+", " ", line).strip()


def tokenize(text: str) -> List[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9\-]*", text.lower())
    return [t for t in tokens if len(t) >= 3 and t not in STOPWORDS and t not in NOISE_WORDS]


def split_lines(text: str) -> List[str]:
    return [strip_page_noise(line) for line in text.split("\n") if strip_page_noise(line)]


def alpha_ratio(text: str) -> float:
    if not text:
        return 0.0
    alpha = sum(ch.isalpha() for ch in text)
    return alpha / max(1, len(text))


def digit_ratio(text: str) -> float:
    if not text:
        return 0.0
    digits = sum(ch.isdigit() for ch in text)
    return digits / max(1, len(text))


def weird_symbol_ratio(text: str) -> float:
    if not text:
        return 0.0
    weird = sum(1 for ch in text if not (ch.isalnum() or ch.isspace() or ch in ",.;:?!()/%-+"))
    return weird / max(1, len(text))


def looks_like_heading(line: str) -> bool:
    low = line.lower().strip()
    if not low:
        return True
    if re.fullmatch(r"\d+", low):
        return True
    if re.match(r"^(week|chapter|lecture|slide)\s+\d+", low):
        return True
    if re.match(r"^(table of contents|references|bibliography)$", low):
        return True
    if re.match(r"^(summary|download summary|generated in)", low):
        return True
    words = low.split()
    if len(words) <= 4 and not re.search(r"[.!?]$", low):
        return True
    if low.isupper() and len(words) <= 10:
        return True
    return False


def has_adjacent_repeat(text: str) -> bool:
    return bool(re.search(r"\b([A-Za-z][A-Za-z\-]{2,})\s+\1\b", text, re.I))


def has_verb(text: str) -> bool:
    words = set(re.findall(r"[A-Za-z][A-Za-z\-]*", text.lower()))
    if words & VERB_HINTS:
        return True
    return bool(re.search(r"\b\w+(ed|ing|es)\b", text.lower()))


def bad_line_filter(lines: Sequence[str]) -> List[str]:
    filtered: List[str] = []

    for line in lines:
        if len(line) < 20:
            continue
        if len(line.split()) < 5:
            continue
        if looks_like_heading(line):
            continue
        if alpha_ratio(line) < 0.45:
            continue
        if digit_ratio(line) > 0.35:
            continue
        if weird_symbol_ratio(line) > 0.08:
            continue
        if has_adjacent_repeat(line):
            continue
        if re.search(r"\b(?:https?://|www\.)", line, flags=re.I):
            continue
        if re.search(r"\b(?:copyright|all rights reserved)\b", line, flags=re.I):
            continue
        filtered.append(line)

    if filtered:
        return filtered

    return [line for line in lines if len(line.split()) >= 6]


def merge_fragmented_lines(lines: Sequence[str]) -> List[str]:
    merged: List[str] = []
    buffer = ""

    for line in lines:
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue

        if not buffer:
            buffer = line
            continue

        buffer_ends = bool(re.search(r"[.!?:;]$", buffer))
        line_starts_lower = bool(re.match(r"^[a-z]", line))
        short_line = len(line.split()) <= 9

        if not buffer_ends or line_starts_lower or short_line:
            if not buffer_ends and re.match(r"^[A-Z]", line) and len(buffer.split()) >= 8 and has_verb(buffer):
                buffer = f"{buffer}. {line}"
                continue

            if buffer.endswith("-"):
                buffer = buffer[:-1] + line
            else:
                buffer = f"{buffer} {line}"
        else:
            merged.append(buffer.strip())
            buffer = line

    if buffer:
        merged.append(buffer.strip())

    return merged


def sentence_split(paragraph: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Za-z0-9])", paragraph)
    return [p.strip() for p in parts if p.strip()]


def sanitize_sentence(sentence: str) -> str:
    sentence = re.sub(r"\([^)]{0,120}\)", "", sentence)
    sentence = re.sub(r"\[[^\]]{0,80}\]", "", sentence)
    sentence = re.sub(r"\b(additionally|moreover|however|therefore|thus|finally|meanwhile),\s+(finally|additionally|moreover|however|therefore|thus|meanwhile)\b", r"\2", sentence, flags=re.I)
    sentence = re.sub(r"\b(and|or|but),\s+contrary\s+to\b", "contrary to", sentence, flags=re.I)
    sentence = re.sub(r"\s+", " ", sentence).strip(" ,;:-")
    sentence = re.sub(r"\s+([,.;:!?])", r"\1", sentence)
    sentence = re.sub(r"\b(and|or|but|nor|yet|so|to|with|by|from)\s*[.]+$", "", sentence, flags=re.I)
    sentence = sentence.strip(" ,;:-")
    if sentence and re.match(r"^[a-z]", sentence):
        sentence = sentence[0].upper() + sentence[1:]
    if sentence and not re.search(r"[.!?]$", sentence):
        sentence += "."
    return sentence


def sentence_validation(sentence: str) -> bool:
    if len(sentence.split()) < 8:
        return False
    if alpha_ratio(sentence) < 0.6:
        return False
    if weird_symbol_ratio(sentence) > 0.05:
        return False
    if has_adjacent_repeat(sentence):
        return False
    if not has_verb(sentence):
        return False
    if re.match(r"^[,;:.\-]", sentence):
        return False
    if re.search(r"\b(for example|e\.g\.|i\.e\.)\b", sentence, flags=re.I):
        return False
    tail = re.sub(r"[.!?]+$", "", sentence).strip().split()
    if tail and tail[-1].lower() in DANGLING_TAIL_WORDS:
        return False
    return True


def collect_candidate_sentences(text: str) -> List[str]:
    text = normalize_unicode(text)
    text = normalize_whitespace(text)
    if len(text) > MAX_INPUT_CHARS:
        text = text[:MAX_INPUT_CHARS]

    lines = split_lines(text)
    clean_lines = bad_line_filter(lines)
    merged = merge_fragmented_lines(clean_lines)

    candidates: List[str] = []
    for block in merged:
        for sentence in sentence_split(block):
            sentence = sanitize_sentence(sentence)
            if sentence_validation(sentence):
                candidates.append(sentence)

    deduped: List[str] = []
    seen = set()
    for s in candidates:
        key = re.sub(r"\W+", "", s.lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(s)

    return deduped


def corpus_frequencies(sentences: Sequence[str]) -> Tuple[Counter, Counter]:
    tf = Counter()
    df = Counter()

    for sentence in sentences:
        toks = tokenize(sentence)
        tf.update(toks)
        for t in set(toks):
            df[t] += 1

    return tf, df


def idf(term: str, doc_count: int, df_counter: Counter) -> float:
    return math.log((doc_count + 1) / (1 + df_counter.get(term, 0))) + 1.0


def sentence_score(sentence: str, idx: int, total: int, tf: Counter, df: Counter) -> float:
    toks = tokenize(sentence)
    if not toks:
        return 0.0

    salience = 0.0
    for t in toks:
        salience += (1.0 + math.log(1 + tf[t])) * idf(t, total, df)
    salience = salience / (len(toks) ** 0.45)

    length = len(toks)
    length_prior = 0.0
    if 12 <= length <= 28:
        length_prior += 0.6
    elif length > 40:
        length_prior -= 0.4

    structure = 0.0
    if re.search(r"\d", sentence):
        structure += 0.15
    if re.search(r"\b(therefore|thus|because|results?|improves?|reduces?|increases?)\b", sentence, flags=re.I):
        structure += 0.2

    position = 0.0
    if total > 1:
        ratio = idx / (total - 1)
        if 0.05 <= ratio <= 0.95:
            position += 0.1

    noise_penalty = 0.0
    low = sentence.lower()
    if re.search(r"\b(example|for instance|e\.g\.)\b", low):
        noise_penalty += 0.8
    if re.search(r"\b(week|chapter|slide)\b", low):
        noise_penalty += 0.5

    return salience + length_prior + structure + position - noise_penalty


def jaccard_tokens(a: Sequence[str], b: Sequence[str]) -> float:
    sa = set(a)
    sb = set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(1, len(sa | sb))


def select_evidence(sentences: Sequence[str], k: int = MAX_EVIDENCE_SENTENCES) -> List[EvidenceSentence]:
    tf, df = corpus_frequencies(sentences)

    scored: List[EvidenceSentence] = []
    for idx, s in enumerate(sentences):
        score = sentence_score(s, idx, len(sentences), tf, df)
        scored.append(EvidenceSentence(text=s, index=idx, score=score))

    scored.sort(key=lambda e: e.score, reverse=True)
    if not scored:
        return []

    selected: List[EvidenceSentence] = []
    selected_tokens: List[List[str]] = []

    for candidate in scored:
        c_tokens = tokenize(candidate.text)
        redundancy = 0.0
        if selected_tokens:
            redundancy = max(jaccard_tokens(c_tokens, s_tokens) for s_tokens in selected_tokens)

        mmr = candidate.score - 1.2 * redundancy
        if mmr < 0.25 and selected:
            continue

        selected.append(candidate)
        selected_tokens.append(c_tokens)

        if len(selected) >= k:
            break

    selected.sort(key=lambda e: e.index)

    compact: List[EvidenceSentence] = []
    used_chars = 0
    for e in selected:
        if used_chars + len(e.text) > MAX_SOURCE_CHARS:
            continue
        compact.append(e)
        used_chars += len(e.text) + 1

    return compact[:k]


def to_proposition(sentence: str) -> str:
    s = sentence.strip()
    s = re.sub(r"^(additionally|moreover|however|therefore|thus|finally|meanwhile|overall|importantly|consequently|instead)\s*,?\s*", "", s, flags=re.I)
    s = re.sub(r"\b(for example|for instance|such as)\b.*", "", s, flags=re.I)
    s = re.sub(r"^(in conclusion|overall|to summarize|in summary)\s*,?\s*", "", s, flags=re.I)
    s = re.sub(r"\b(TF)\b", "term frequency", s)
    s = re.sub(r"\b(DF)\b", "document frequency", s)
    s = re.sub(r"\b(IDF)\b", "inverse document frequency", s)
    s = re.sub(r"\b(Doc\.?\s*Length)\b", "document length", s, flags=re.I)
    s = re.sub(r"\b(and|or|but|nor|yet|so|to|with|by|from)\s*[.]+$", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" ,;:-")

    if s and not re.search(r"[.!?]$", s):
        s += "."

    words = s.split()
    if len(words) > 32:
        s = " ".join(words[:32]).rstrip(" ,;:-") + "."

    return s


def evidence_to_bullets(evidence: Sequence[EvidenceSentence], max_items: int = MAX_REWRITE_EVIDENCE) -> List[str]:
    bullets: List[str] = []
    seen = set()

    ranked = sorted(evidence, key=lambda x: x.score, reverse=True)
    for item in ranked:
        prop = to_proposition(item.text)
        key = re.sub(r"\W+", "", prop.lower())
        if key in seen:
            continue
        if len(prop.split()) < 7:
            continue
        seen.add(key)
        bullets.append(prop)
        if len(bullets) >= max_items:
            break

    return bullets


def sentence_safe_start(text: str) -> bool:
    return bool(re.match(r"^[A-Z0-9]", text))


def clean_model_output(text: str) -> str:
    text = text.strip()
    text = re.sub(r"```[a-zA-Z]*", "", text)
    text = text.replace("```", "")
    text = re.sub(r"(?im)^summary\s*:\s*", "", text)
    text = text.replace("\n", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    if text and not re.search(r"[.!?]$", text):
        text += "."
    return text


def normalize_for_overlap(text: str) -> List[str]:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s\-]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return [w for w in text.split() if w]


def ngrams(tokens: Sequence[str], n: int) -> set[str]:
    if len(tokens) < n:
        return set()
    return {" ".join(tokens[i:i + n]) for i in range(len(tokens) - n + 1)}


def overlap_ratio(summary: str, source: str, n: int = 5) -> float:
    s_tokens = normalize_for_overlap(summary)
    src_tokens = normalize_for_overlap(source)
    s_ngrams = ngrams(s_tokens, n)
    src_ngrams = ngrams(src_tokens, n)
    if not s_ngrams or not src_ngrams:
        return 0.0
    return len(s_ngrams & src_ngrams) / max(1, len(s_ngrams))


def repetition_ratio(text: str) -> float:
    words = [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9\-]*", text)]
    if not words:
        return 1.0
    counts = Counter(words)
    repeated = sum(v for v in counts.values() if v > 1)
    return repeated / max(1, len(words))


def remove_repetition(text: str) -> str:
    text = re.sub(r"\b(\w+)(\s+\1\b)+", r"\1", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def trim_to_word_limit(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text.strip()

    clipped = " ".join(words[:max_words]).strip()
    cut = max(clipped.rfind("."), clipped.rfind("!"), clipped.rfind("?"))
    if cut > 20:
        clipped = clipped[:cut + 1].strip()
    elif clipped and not re.search(r"[.!?]$", clipped):
        clipped += "."

    return clipped


def is_generic_opening(text: str) -> bool:
    low = text.lower().strip()
    return any(low.startswith(prefix) for prefix in BANNED_OPENINGS)


def looks_abrupt(text: str) -> bool:
    if not text:
        return True
    if not re.search(r"[.!?]$", text):
        return True
    tail = text.split()[-1]
    if re.match(r"^[,;:-]", tail):
        return True
    return False


def validate_summary(summary: str, source_for_overlap: str, min_words: int, max_words: int) -> bool:
    if not summary:
        return False

    words = summary.split()
    if len(words) < min_words or len(words) > max_words:
        return False
    if not sentence_safe_start(summary):
        return False
    if looks_abrupt(summary):
        return False
    if is_generic_opening(summary):
        return False
    if has_adjacent_repeat(summary):
        return False
    if repetition_ratio(summary) > REPETITION_THRESHOLD:
        return False
    if overlap_ratio(summary, source_for_overlap, n=5) > OVERLAP_THRESHOLD:
        return False
    if weird_symbol_ratio(summary) > 0.04:
        return False

    return True


def infer_word_bounds(source_text: str, requested_max: int) -> Tuple[int, int]:
    source_words = len(source_text.split())

    if source_words < 85:
        min_words = LOW_CONTEXT_MIN_WORDS
        max_words = min(requested_max, 85)
    elif source_words < 150:
        min_words = 55
        max_words = min(requested_max, 100)
    else:
        min_words = MIN_SUMMARY_WORDS
        max_words = min(requested_max, MAX_SUMMARY_WORDS)

    min_words = max(LOW_CONTEXT_MIN_WORDS, min_words)
    max_words = max(min_words, max_words)

    return min_words, max_words


def deterministic_rewrite(bullets: Sequence[str], min_words: int, max_words: int) -> str:
    if not bullets:
        return ""

    usable = [b.strip() for b in bullets if len(b.split()) >= 7]
    if not usable:
        return ""

    built_sentences: List[str] = []

    for idx, proposition in enumerate(usable):
        proposition = proposition.rstrip(".")
        proposition = re.sub(r"^(additionally|moreover|however|therefore|thus|finally|meanwhile|overall|importantly|consequently|instead)\s*,?\s*", "", proposition, flags=re.I)
        proposition = proposition.strip()
        if not proposition:
            continue
        transition = TRANSITIONS[idx] if idx < len(TRANSITIONS) else ""

        if idx == 0:
            sentence = proposition + "."
        else:
            if transition:
                sentence = f"{transition}, {proposition[0].lower() + proposition[1:]}."
            else:
                sentence = proposition + "."

        sentence = re.sub(r"\s+", " ", sentence).strip()
        built_sentences.append(sentence)

    summary = " ".join(built_sentences)
    summary = clean_model_output(summary)
    summary = remove_repetition(summary)
    summary = trim_to_word_limit(summary, max_words)

    if len(summary.split()) < min_words and len(usable) >= 2:
        padded = " ".join(usable[: min(len(usable), 6)])
        padded = clean_model_output(padded)
        summary = trim_to_word_limit(padded, max_words)

    return summary


def build_system_prompt() -> str:
    return (
        "You are an academic summarization engine. "
        "Rewrite evidence into one coherent paragraph with clear logical flow. "
        "Avoid copying phrases from evidence and avoid template-like openings."
    )


def build_user_prompt(bullets: Sequence[str], min_words: int, max_words: int) -> str:
    lines = "\n".join(f"{i + 1}. {b}" for i, b in enumerate(bullets))

    return (
        "Write one paragraph in polished academic English from the evidence below.\n"
        f"Word range: {min_words}-{max_words}.\n"
        "Constraints:\n"
        "- No direct copying of long phrases from evidence\n"
        "- No opening like 'The text' or 'This passage'\n"
        "- No bullet points or numbering\n"
        "- No mention of slides, chapter, or document\n"
        "- Ensure the paragraph starts naturally and ends with a full sentence\n"
        "Evidence:\n"
        f"{lines}"
    )


async def generate_with_model(model: str, bullets: Sequence[str], min_words: int, max_words: int) -> str:
    if http_client is None:
        raise HTTPException(status_code=500, detail="HTTP client not initialized")

    min_words = max(LOW_CONTEXT_MIN_WORDS, min_words)
    max_words = max(min_words, min(max_words, MAX_SUMMARY_WORDS))

    response = await http_client.post(
        OLLAMA_URL,
        json={
            "model": model,
            "stream": False,
            "system": build_system_prompt(),
            "prompt": build_user_prompt(bullets, min_words, max_words),
            "keep_alive": "10m",
            "options": {
                "temperature": 0.12,
                "top_p": 0.75,
                "repeat_penalty": 1.35,
                "num_predict": 180,
                "num_ctx": 1300,
                "num_thread": 4,
            },
        },
    )
    response.raise_for_status()

    return clean_model_output(str(response.json().get("response", "")))


def safe_fallback(evidence: Sequence[EvidenceSentence], min_words: int, max_words: int) -> str:
    bullets = evidence_to_bullets(evidence, max_items=6)
    return deterministic_rewrite(bullets, min_words, max_words)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.post("/summarize-fast", response_model=SummaryResponse)
async def summarize_fast(payload: SummaryRequest) -> SummaryResponse:
    started = time.perf_counter()

    if not payload.text or not payload.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    model = (payload.model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    requested_max_words = max(LOW_CONTEXT_MIN_WORDS, min(int(payload.max_words or MAX_SUMMARY_WORDS), MAX_SUMMARY_WORDS))

    candidates = collect_candidate_sentences(payload.text)
    if not candidates:
        raise HTTPException(status_code=400, detail="could not extract valid sentences")

    source_chars = "\n".join(candidates)
    if len(source_chars) < MIN_INPUT_CHARS:
        raise HTTPException(status_code=400, detail="text is too short after cleaning")

    evidence = select_evidence(candidates, k=MAX_EVIDENCE_SENTENCES)
    if not evidence:
        raise HTTPException(status_code=400, detail="could not select evidence")

    bullets = evidence_to_bullets(evidence, max_items=MAX_REWRITE_EVIDENCE)
    if not bullets:
        raise HTTPException(status_code=400, detail="could not build evidence propositions")

    source_for_overlap = "\n".join(item.text for item in evidence)
    min_words, max_words = infer_word_bounds(source_for_overlap, requested_max_words)

    if len(evidence) < 3:
        summary = deterministic_rewrite(bullets, min_words, max_words)
        if not validate_summary(summary, source_for_overlap, min_words, max_words):
            summary = safe_fallback(evidence, min_words, max_words)
        if not summary:
            raise HTTPException(status_code=502, detail="summary generation failed")

        duration = round(time.perf_counter() - started, 2)
        return SummaryResponse(
            summary=summary,
            duration_sec=duration,
            mode="deterministic_low_context",
            selected_sentences=len(evidence),
            model=model,
        )

    mode = "hybrid_model"
    summary = ""

    try:
        summary = await asyncio.wait_for(
            generate_with_model(model, bullets, min_words, max_words),
            timeout=MODEL_HARD_DEADLINE,
        )

        summary = remove_repetition(summary)
        summary = trim_to_word_limit(summary, max_words)

        if not validate_summary(summary, source_for_overlap, min_words, max_words):
            summary = deterministic_rewrite(bullets, min_words, max_words)
            mode = "fallback_guardrail"

    except asyncio.TimeoutError:
        summary = deterministic_rewrite(bullets, min_words, max_words)
        mode = "fallback_timeout"
    except httpx.HTTPError:
        summary = deterministic_rewrite(bullets, min_words, max_words)
        mode = "fallback_model_error"

    if not validate_summary(summary, source_for_overlap, min_words, max_words):
        summary = safe_fallback(evidence, min_words, max_words)
        mode = "fallback_safe"

    if not summary:
        raise HTTPException(status_code=502, detail="summary generation failed")

    duration = round(time.perf_counter() - started, 2)

    return SummaryResponse(
        summary=summary,
        duration_sec=duration,
        mode=mode,
        selected_sentences=len(evidence),
        model=model,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=True)
