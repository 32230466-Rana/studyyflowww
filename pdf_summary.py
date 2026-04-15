from __future__ import annotations

import math
import re
import time
from collections import Counter
from typing import List

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="StudyFlow Fast Summary API")


OLLAMA_URL = "http://127.0.0.1:11434/api/generate"

# quality default
DEFAULT_MODEL = "qwen3:1.7b"
# إذا بدك أسرع شوي استبدليها بـ:
# DEFAULT_MODEL = "phi3:mini"

REQUEST_TIMEOUT = 48.0
MAX_CONTEXT_CHARS = 1250
MIN_SUMMARY_WORDS = 95
MAX_SUMMARY_WORDS = 145


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
    "too", "just", "only", "same", "both", "many", "much", "few"
}


http_client: httpx.AsyncClient | None = None


class SummaryRequest(BaseModel):
    text: str = Field(..., min_length=1)
    model: str = DEFAULT_MODEL
    max_words: int = MAX_SUMMARY_WORDS


class SummaryResponse(BaseModel):
    summary: str
    duration_sec: float
    mode: str
    selected_sentences: int
    model: str


@app.on_event("startup")
async def startup_event() -> None:
    global http_client
    http_client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)


@app.on_event("shutdown")
async def shutdown_event() -> None:
    global http_client
    if http_client is not None:
        await http_client.aclose()


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # remove UI noise
    ui_patterns = [
        r"(?im)^summary of .*$",
        r"(?im)^download summary.*$",
        r"(?im)^⏱️?\s*generated in.*$",
        r"(?im)^generated in.*seconds.*$",
    ]
    for pattern in ui_patterns:
        text = re.sub(pattern, " ", text)

    # normalize bullets / symbols
    text = (
        text.replace("➢", ". ")
        .replace("•", ". ")
        .replace("▪", ". ")
        .replace("◦", ". ")
        .replace("…", ". ")
    )

    # fix glued words like "as well asWeb"
    text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)

    # normalize labels
    text = re.sub(r"\bTF\s*;", "TF: ", text, flags=re.I)
    text = re.sub(r"\bDF\s*;", "DF: ", text, flags=re.I)
    text = re.sub(r"\bIDF\s*;", "IDF: ", text, flags=re.I)

    # collapse whitespace line by line first
    raw_lines = [re.sub(r"\s+", " ", line).strip() for line in text.split("\n")]
    raw_lines = [line for line in raw_lines if line]

    merged_lines: List[str] = []
    buffer = ""

    for line in raw_lines:
        if len(line) < 2:
            continue

        if not buffer:
            buffer = line
            continue

        prev_done = bool(re.search(r"[.!?:]$", buffer))
        current_is_continuation = (
            line[:1].islower()
            or line[:1].isdigit()
            or len(line.split()) <= 4
            or not prev_done
        )

        if current_is_continuation:
            buffer += " " + line
        else:
            merged_lines.append(buffer.strip())
            buffer = line

    if buffer:
        merged_lines.append(buffer.strip())

    text = " ".join(merged_lines)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"([.?!])([A-Z])", r"\1 \2", text)
    text = re.sub(r"\s+", " ", text).strip()

    return text


def split_sentences(text: str) -> List[str]:
    # first split by sentence punctuation
    parts = re.split(r"(?<=[.!?])\s+", text)

    sentences: List[str] = []
    for part in parts:
        part = part.strip(" -–—")
        if not part:
            continue

        # break huge clauses a bit
        subparts = re.split(r"(?<=:)\s+", part)
        for s in subparts:
            s = s.strip()
            if len(s) >= 28:
                sentences.append(s)

    # deduplicate
    unique: List[str] = []
    seen = set()
    for s in sentences:
        key = re.sub(r"\W+", "", s.lower())
        if key not in seen:
            seen.add(key)
            unique.append(s)

    return unique


def tokenize(text: str) -> List[str]:
    words = re.findall(r"[A-Za-z0-9\-]+", text.lower())
    return [w for w in words if len(w) > 2 and w not in STOPWORDS]


def jaccard_similarity(a: str, b: str) -> float:
    ta = set(tokenize(a))
    tb = set(tokenize(b))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(1, len(ta | tb))


def sentence_score(sentence: str, idx: int, freq: Counter) -> float:
    tokens = tokenize(sentence)
    if not tokens:
        return 0.0

    base = sum(freq[t] for t in tokens) / math.sqrt(len(tokens) + 1)

    # beginning of text often matters
    if idx == 0:
        base *= 1.16
    elif idx < 3:
        base *= 1.08

    bonus = 0.0

    # reward IR-relevant concepts
    if re.search(
        r"\b(information retrieval|retrieval|ir|query|queries|document|documents|index|indexing|weighting|term frequency|document frequency|tf|df|idf|ambiguity|polysemy|synonymy)\b",
        sentence,
        re.I,
    ):
        bonus += 2.0

    if re.search(r"\b(bse|ibm-360|sql)\b", sentence, re.I):
        bonus += 1.0

    if any(ch.isdigit() for ch in sentence):
        bonus += 0.35

    # prefer medium-length dense sentences
    if 9 <= len(tokens) <= 30:
        bonus += 0.6
    elif len(tokens) > 40:
        base *= 0.9

    return base + bonus


def select_key_sentences(sentences: List[str], max_chars: int = MAX_CONTEXT_CHARS) -> List[str]:
    if not sentences:
        return []

    freq = Counter()
    for s in sentences:
        freq.update(tokenize(s))

    scored = [(sentence_score(s, i, freq), i, s) for i, s in enumerate(sentences)]
    scored.sort(key=lambda x: x[0], reverse=True)

    selected: List[str] = []
    used_chars = 0

    for _, _, sentence in scored:
        if used_chars + len(sentence) > max_chars:
            continue

        if any(jaccard_similarity(sentence, prev) > 0.62 for prev in selected):
            continue

        selected.append(sentence)
        used_chars += len(sentence) + 1

        if len(selected) >= 6:
            break

    # keep reading order
    selected.sort(key=lambda s: sentences.index(s))
    return selected


def build_system_prompt() -> str:
    return (
        "You are a careful academic summarizer. "
        "Produce one clean, coherent paragraph in formal but simple English."
    )


def build_user_prompt(context: str, max_words: int) -> str:
    max_words = max(MIN_SUMMARY_WORDS, min(max_words, MAX_SUMMARY_WORDS))
    return f"""
Summarize the following noisy extracted text.

Rules:
- Use only the provided content.
- Remove repeated lines, OCR noise, UI text, and broken formatting.
- Keep only the main ideas.
- Explain TF and DF briefly if they appear.
- Do not use bullet points.
- Do not add a title.
- Write one paragraph only.
- Keep it between {MIN_SUMMARY_WORDS} and {max_words} words.
- Make the summary read naturally, not like copied fragments.

Text:
{context}
""".strip()


def clean_model_output(text: str) -> str:
    text = text.strip()

    # remove common wrappers
    text = re.sub(r"(?im)^summary\s*:\s*", "", text)
    text = re.sub(r"(?im)^final summary\s*:\s*", "", text)
    text = re.sub(r"(?im)^here is the summary\s*:\s*", "", text)
    text = re.sub(r"(?im)^clean summary\s*:\s*", "", text)

    # flatten lists
    text = text.replace("\n- ", " ")
    text = text.replace("\n• ", " ")
    text = text.replace("\n", " ")

    # remove markdown emphasis
    text = text.replace("**", "")
    text = text.replace("__", "")

    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)

    # dedupe repeated sentences
    parts = re.split(r"(?<=[.!?])\s+", text)
    unique_parts = []
    seen = set()
    for part in parts:
        key = re.sub(r"\W+", "", part.lower())
        if key and key not in seen:
            seen.add(key)
            unique_parts.append(part)

    return " ".join(unique_parts).strip()


def looks_bad_summary(summary: str) -> bool:
    if not summary:
        return True
    if len(summary.split()) < 55:
        return True
    if re.search(r"\bquestion\s*:", summary, re.I):
        return True
    if re.search(r"\banswer\s*:", summary, re.I):
        return True
    if re.search(r"\b[a-d]\)\s", summary, re.I):
        return True
    return False


def extractive_fallback(sentences: List[str], max_words: int) -> str:
    if not sentences:
        return (
            "Information retrieval handles different kinds of information items and must "
            "deal with ambiguous and incomplete user queries. The text also describes "
            "weighting concepts such as term frequency and document frequency for representing "
            "document importance."
        )

    text = " ".join(sentences[:4]).strip()
    words = text.split()

    if len(words) > max_words:
        text = " ".join(words[:max_words]).strip()

    if not text.endswith("."):
        text += "."

    return text


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/summarize-fast", response_model=SummaryResponse)
async def summarize_fast(payload: SummaryRequest):
    started = time.perf_counter()

    if http_client is None:
        raise HTTPException(status_code=500, detail="HTTP client not initialized")

    raw_text = payload.text.strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="text is required")

    cleaned = normalize_text(raw_text)
    if len(cleaned) < 60:
        raise HTTPException(status_code=400, detail="text is too short after cleaning")

    sentences = split_sentences(cleaned)
    if not sentences:
        raise HTTPException(status_code=400, detail="could not extract valid sentences")

    selected = select_key_sentences(sentences, max_chars=MAX_CONTEXT_CHARS)
    if not selected:
        selected = sentences[:5]

    context = " ".join(selected)

    system_prompt = build_system_prompt()
    user_prompt = build_user_prompt(context, payload.max_words)

    try:
        response = await http_client.post(
            OLLAMA_URL,
            json={
                "model": payload.model or DEFAULT_MODEL,
                "system": system_prompt,
                "prompt": user_prompt,
                "stream": False,
                "keep_alive": "10m",
                "options": {
                    "temperature": 0.15,
                    "top_p": 0.85,
                    "num_predict": 150,
                    "num_ctx": 1024,
                    "repeat_penalty": 1.12,
                },
            },
        )
        response.raise_for_status()
        data = response.json()
        summary = clean_model_output(data.get("response", ""))

        if looks_bad_summary(summary):
            summary = extractive_fallback(selected, payload.max_words)
            mode = "extractive_fallback"
        else:
            words = summary.split()
            if len(words) > payload.max_words:
                summary = " ".join(words[:payload.max_words]).strip()
                if not summary.endswith("."):
                    summary += "."
            mode = "model"

    except httpx.TimeoutException:
        summary = extractive_fallback(selected, payload.max_words)
        mode = "timeout_fallback"

    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Ollama error: {str(e)}")

    duration = round(time.perf_counter() - started, 2)

    return SummaryResponse(
        summary=summary,
        duration_sec=duration,
        mode=mode,
        selected_sentences=len(selected),
        model=payload.model or DEFAULT_MODEL,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=True)
