from __future__ import annotations

import os
import re
import math
import requests
from typing import Any, Dict, List, Optional, Tuple


OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "120"))


STOPWORDS = {
    "what", "which", "when", "where", "why", "how",
    "the", "is", "are", "was", "were", "a", "an",
    "of", "to", "in", "on", "for", "and", "or", "with",
    "about", "between", "from", "into", "by", "as", "at",
    "this", "that", "these", "those", "it", "its",
    "does", "do", "did", "be", "been", "being",
    "concept", "topic", "area", "question", "answer",
    "student", "wrong", "correct", "option",
}


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def key_terms(text: str) -> set:
    text = normalize_text(text)
    words = re.findall(r"[a-zA-Z][a-zA-Z\-]{2,}", text)
    return {w for w in words if w not in STOPWORDS}


def keyword_overlap_score(query: str, evidence: str) -> float:
    query_terms = key_terms(query)
    evidence_terms = key_terms(evidence)

    if not query_terms:
        return 0.0

    matched = query_terms.intersection(evidence_terms)
    return len(matched) / len(query_terms)


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b:
        return 0.0

    size = min(len(a), len(b))
    a = a[:size]
    b = b[:size]

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return dot / (norm_a * norm_b)


def safe_ollama_embed(text: str) -> List[float]:
    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/embeddings",
            json={
                "model": EMBED_MODEL,
                "prompt": (text or "")[:3000],
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json().get("embedding", [])
    except Exception:
        return []


def call_ollama(prompt: str) -> str:
    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.1,
                },
            },
            timeout=OLLAMA_TIMEOUT,
        )
        response.raise_for_status()
        return response.json().get("response", "").strip()
    except Exception:
        return ""


def chunk_to_dict(chunk: Any) -> Dict[str, Any]:
    if isinstance(chunk, str):
        return {
            "text": chunk,
            "section": "Unknown",
            "page": None,
        }

    if isinstance(chunk, dict):
        return {
            "text": chunk.get("text") or chunk.get("content") or chunk.get("chunk") or "",
            "section": chunk.get("section") or chunk.get("title") or chunk.get("heading") or "Unknown",
            "page": chunk.get("page"),
            "embedding": chunk.get("embedding"),
        }

    return {
        "text": "",
        "section": "Unknown",
        "page": None,
    }


def split_comparison_topic(topic: str) -> List[str]:
    """
    لو الموضوع فيه comparison مثل:
    Sentiment analysis vs text understanding

    لازم نفس evidence يدعم الطرفين.
    إذا evidence يدعم طرف واحد فقط، نرفض الكرت.
    """
    t = normalize_text(topic)

    patterns = [
        r"\s+vs\.?\s+",
        r"\s+versus\s+",
        r"\s+compared\s+with\s+",
    ]

    for pattern in patterns:
        parts = re.split(pattern, t)
        parts = [p.strip() for p in parts if p.strip()]
        if len(parts) >= 2:
            return parts

    m = re.search(r"difference between (.+?) and (.+)", t)
    if m:
        return [m.group(1).strip(), m.group(2).strip()]

    return []


def comparison_supported_by_evidence(topic: str, evidence: str) -> bool:
    sides = split_comparison_topic(topic)

    if not sides:
        return True

    evidence_l = normalize_text(evidence)

    for side in sides:
        terms = key_terms(side)

        if not terms:
            continue

        overlap = keyword_overlap_score(side, evidence_l)

        # For comparison topics, each side must be clearly present.
        if overlap < 0.50:
            return False

    return True


def evidence_alignment_score(
    topic: str,
    wrong_focus: str,
    raw_chunk: Any,
) -> Tuple[float, Dict[str, Any]]:
    chunk = chunk_to_dict(raw_chunk)

    text = chunk.get("text", "")
    section = chunk.get("section", "Unknown")
    page = chunk.get("page")

    if not text.strip():
        return 0.0, {
            "reason": "empty_chunk",
            "section": section,
            "page": page,
        }

    query = f"{topic}. {wrong_focus}".strip()
    evidence = f"{section}\n{text}"

    if not comparison_supported_by_evidence(topic, evidence):
        return 0.0, {
            "reason": "comparison_not_supported_by_same_chunk",
            "section": section,
            "page": page,
        }

    keyword_score = keyword_overlap_score(query, evidence)
    section_score = keyword_overlap_score(topic, section)

    query_embedding = safe_ollama_embed(query)
    evidence_embedding = chunk.get("embedding") or safe_ollama_embed(evidence)

    semantic_score = 0.0

    if query_embedding and evidence_embedding:
        semantic_score = cosine_similarity(query_embedding, evidence_embedding)
        final_score = (semantic_score * 0.65) + (keyword_score * 0.25) + (section_score * 0.10)
    else:
        # Fallback if embedding model is not available.
        final_score = (keyword_score * 0.85) + (section_score * 0.15)

    debug = {
        "semantic_score": round(semantic_score, 3),
        "keyword_score": round(keyword_score, 3),
        "section_score": round(section_score, 3),
        "final_score": round(final_score, 3),
        "section": section,
        "page": page,
    }

    return final_score, debug


def pick_best_evidence(
    topic: str,
    wrong_focus: str,
    chunks: List[Any],
    min_score: float = 0.50,
) -> Optional[Dict[str, Any]]:
    best_chunk = None
    best_score = 0.0
    best_debug = None

    for raw_chunk in chunks or []:
        score, debug = evidence_alignment_score(topic, wrong_focus, raw_chunk)

        if score > best_score:
            best_score = score
            best_chunk = chunk_to_dict(raw_chunk)
            best_debug = debug

    if not best_chunk or best_score < min_score:
        return None

    return {
        "chunk": best_chunk,
        "score": best_score,
        "debug": best_debug,
    }


def best_source_sentence(topic: str, evidence_text: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", evidence_text or "")
    sentences = [s.strip() for s in sentences if len(s.strip()) > 25]

    if not sentences:
        return ""

    best = max(sentences, key=lambda s: keyword_overlap_score(topic, s))
    best = re.sub(r"\s+", " ", best).strip()

    if len(best) > 280:
        best = best[:280].rsplit(" ", 1)[0] + "..."

    return best


def fallback_why_from_source(topic: str, wrong_focus: str, evidence_text: str) -> str:
    sentence = best_source_sentence(topic, evidence_text)

    if not sentence:
        return ""

    return f"Review this area because the source explains this point directly: {sentence}"


def generate_why_from_only_this_chunk(
    topic: str,
    wrong_focus: str,
    evidence_text: str,
) -> str:
    prompt = f"""
You are generating a weak-area explanation for a student.

Rules:
- Use ONLY the evidence below.
- Do not use outside knowledge.
- Do not mix sections.
- If the evidence does not support the topic, return exactly: UNSUPPORTED.
- Write only 1-2 short sentences.

Topic:
{topic}

Student wrong-answer focus:
{wrong_focus}

Evidence:
{evidence_text}

Weak-area explanation:
"""

    answer = call_ollama(prompt)

    if not answer or "UNSUPPORTED" in answer.upper():
        return fallback_why_from_source(topic, wrong_focus, evidence_text)

    return answer.strip()


def validate_why_against_evidence(topic: str, why: str, evidence_text: str) -> bool:
    if not why.strip():
        return False

    if "UNSUPPORTED" in why.upper():
        return False

    query = f"{topic}. {why}"
    evidence = evidence_text or ""

    if not comparison_supported_by_evidence(topic, evidence):
        return False

    keyword_score = keyword_overlap_score(query, evidence)

    query_embedding = safe_ollama_embed(query)
    evidence_embedding = safe_ollama_embed(evidence)

    if query_embedding and evidence_embedding:
        semantic_score = cosine_similarity(query_embedding, evidence_embedding)
        return semantic_score >= 0.40 or keyword_score >= 0.25

    return keyword_score >= 0.20


def build_weak_area_card(
    topic: str,
    wrong_focus: str,
    all_chunks: List[Any],
    min_score: float = 0.50,
) -> Optional[Dict[str, Any]]:
    aligned = pick_best_evidence(
        topic=topic,
        wrong_focus=wrong_focus,
        chunks=all_chunks,
        min_score=min_score,
    )

    if not aligned:
        return None

    chunk = aligned["chunk"]

    why = generate_why_from_only_this_chunk(
        topic=topic,
        wrong_focus=wrong_focus,
        evidence_text=chunk["text"],
    )

    if not validate_why_against_evidence(topic, why, chunk["text"]):
        return None

    return {
        "topic": topic,
        "wrong_focus": wrong_focus,
        "source": {
            "note": "Same note",
            "page": chunk.get("page"),
            "section": chunk.get("section"),
        },
        "why": why,
        "alignment_debug": aligned["debug"],
    }


def looks_like_heading(line: str) -> bool:
    line = re.sub(r"\s+", " ", (line or "").strip())

    if len(line) < 4 or len(line) > 90:
        return False

    if line.startswith(("•", "-", "➢", "❑")):
        return False

    if line.endswith((".", ",", ";", ":")):
        return False

    words = re.findall(r"[A-Za-z]+", line)

    if len(words) < 1 or len(words) > 10:
        return False

    # Avoid footer-like lines such as names + page numbers.
    if re.search(r"\d+\s*$", line) and len(words) <= 3:
        return False

    return True


def build_chunks_from_text(
    full_text: str,
    max_chars: int = 1400,
    overlap: int = 180,
) -> List[Dict[str, Any]]:
    """
    Use this only if your backend does not already have RAG chunks.

    If your backend already has chunks from PDF processing, prefer those chunks.
    """
    if not full_text or not full_text.strip():
        return []

    pages = re.split(r"\f+", full_text)
    chunks: List[Dict[str, Any]] = []
    current_section = "Unknown"

    for page_index, page_text in enumerate(pages, start=1):
        lines = [line.strip() for line in page_text.splitlines() if line.strip()]

        for line in lines[:10]:
            if looks_like_heading(line):
                current_section = line
                break

        clean_page_text = re.sub(r"\s+", " ", " ".join(lines)).strip()

        if not clean_page_text:
            continue

        start = 0

        while start < len(clean_page_text):
            end = start + max_chars
            piece = clean_page_text[start:end].strip()

            if piece:
                chunks.append({
                    "text": piece,
                    "section": current_section,
                    "page": page_index,
                })

            if end >= len(clean_page_text):
                break

            start = max(0, end - overlap)

    return chunks