import os
import re
import uuid
import requests
from typing import Dict, List, Optional, Any

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from pypdf import PdfReader
except Exception:
    try:
        from PyPDF2 import PdfReader
    except Exception:
        PdfReader = None


app = FastAPI(title="StudyFlow AskPDF Local Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("ASKPDF_MODEL", os.getenv("OLLAMA_MODEL", "llama3.2:3b"))

DOCS: Dict[str, Dict[str, Any]] = {}


class GenerateRequest(BaseModel):
    docId: Optional[str] = None
    doc_id: Optional[str] = None
    document_id: Optional[str] = None

    question: Optional[str] = None
    query: Optional[str] = None
    prompt: Optional[str] = None
    message: Optional[str] = None
    history: Optional[List[Dict[str, str]]] = None


class ChunksRequest(BaseModel):
    docId: Optional[str] = None
    doc_id: Optional[str] = None
    document_id: Optional[str] = None


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pdf_text(raw_bytes: bytes) -> str:
    if PdfReader is None:
        raise HTTPException(
            status_code=500,
            detail="PDF reader is not installed. Run: pip install pypdf PyPDF2",
        )

    import io

    reader = PdfReader(io.BytesIO(raw_bytes))
    pages = []

    for i, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        if page_text.strip():
            pages.append(f"\n[Page {i}]\n{page_text}")

    return clean_text("\n".join(pages))


def extract_uploaded_text(uploaded_file: UploadFile, raw_bytes: bytes) -> str:
    filename = (uploaded_file.filename or "").lower()

    if filename.endswith(".pdf"):
        return extract_pdf_text(raw_bytes)

    return clean_text(raw_bytes.decode("utf-8", errors="ignore"))


def chunk_text(text: str, max_chars: int = 1200) -> List[str]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

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
        chunks = [text[i : i + max_chars] for i in range(0, len(text), max_chars)]

    return chunks[:80]


def tokenize(text: str) -> set:
    words = re.findall(r"[A-Za-z\u0600-\u06FF0-9]{3,}", text.lower())
    stop = {
        "the", "and", "for", "are", "you", "that", "this", "with", "from",
        "what", "how", "why", "when", "where", "who", "which", "into",
        "about", "does", "did", "can", "could", "would", "should",
    }
    return {w for w in words if w not in stop}


def normalize_question(question: str) -> str:
    return (question or "").strip()


def is_greeting_question(lower_question: str) -> bool:
    return lower_question in {"hi", "hello", "hey", "good morning", "good evening"}


def is_overview_question(lower_question: str) -> bool:
    patterns = [
        "tell me about this note",
        "what is this pdf about",
        "what this pdf is about",
        "summarize this note",
        "give me an overview",
        "explain this pdf",
        "overview of this note",
        "overview of this pdf",
    ]

    return any(pattern in lower_question for pattern in patterns)


def first_meaningful_chunks(chunks: List[str], top_k: int = 3) -> List[str]:
    selected = []

    for chunk in chunks:
        cleaned = chunk.strip()

        if len(cleaned) < 40:
            continue

        selected.append(cleaned)

        if len(selected) >= top_k:
            break

    if not selected:
        selected = [chunk.strip() for chunk in chunks[:top_k] if chunk.strip()]

    return selected


def rewrite_query(question: str, history: Optional[List[Dict[str, str]]]) -> str:
    if not history:
        return question

    # Simple logic for short follow-ups
    short_followups = ["talk", "explain more", "what about it", "tell me more", "elaborate", "give more", "explain", "more", "tell me"]
    is_short = question.lower().strip() in short_followups or len(question.split()) <= 3
    
    if is_short:
        # Find last user message to provide context
        for msg in reversed(history):
            if msg.get("role") == "user":
                last_user_msg = msg.get("content", "")
                if last_user_msg:
                    return f"{last_user_msg} {question}"
    return question


def calculate_relevance(chunk: str, q_words: set, q_lower: str, exact_phrases: List[str]) -> float:
    c_lower = chunk.lower()
    score = 0.0
    
    # 1. Exact Phrase Matching (Highest priority)
    for phrase in exact_phrases:
        p_lower = phrase.lower()
        if p_lower in c_lower:
            score += 100.0
            # Higher boost if it looks like a title (near start or in brackets)
            if p_lower in c_lower[:100]:
                score += 50.0
    
    # 2. Key Term Overlap
    c_words = tokenize(chunk)
    overlap = len(q_words.intersection(c_words))
    score += overlap * 2.0
    
    # 3. Concept Isolation / Pitfall Guard
    # If the question is about Composite/Elementary, the chunk should NOT be 
    # dominated by Diverging/Converging terms UNLESS it also has the target terms.
    is_target_concept = any(p.lower() in c_lower for p in exact_phrases if len(p) > 5)
    pitfalls = ["diverging", "converging", "split", "merge", "merger"]
    
    has_pitfall = any(pitfall in c_lower for pitfall in pitfalls)
    if has_pitfall and not is_target_concept:
        score -= 40.0 # Heavy penalty for unrelated concept pages
        
    return score


def retrieve_chunks(question: str, chunks: List[str], top_k: int = 5) -> List[str]:
    q_words = tokenize(question)
    exact_phrases = []

    if len(q_words) > 1:
        clean_q = " ".join(
            [
                w
                for w in re.findall(r"[A-Za-z\u0600-\u06FF0-9]+", question)
                if w.lower() not in {"explain", "what", "is", "the", "and", "about", "using"}
            ]
        ).strip()

        if len(clean_q) > 5:
            exact_phrases.append(clean_q)

    scored = []
    for chunk in chunks:
        score = calculate_relevance(chunk, q_words, question.lower(), exact_phrases)
        scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)

    selected = [chunk for score, chunk in scored[:top_k] if score > 5]

    return selected


def call_ollama(question: str, context: str) -> str:
    prompt = f"""
You are StudyFlow AskPDF Expert, a friendly academic assistant.

STRICT SOURCE GROUNDING RULES:
1. Use only the uploaded PDF/note context below.
2. Do not invent facts that are not supported by the material.
3. If the PDF gives a direct written definition, answer with that definition.
4. If the PDF does not give a direct written definition but a diagram clearly shows the idea, say: "The PDF does not give a direct written definition, but based on the diagram..."
5. If the material does not support an answer, say so politely instead of guessing.
6. Keep the answer helpful and grounded in the provided content.

PDF CONTEXT:
{context}

USER QUESTION:
{question}

ANSWER:
""".strip()

    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.1,
                    "num_predict": 650,
                },
            },
            timeout=600,
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach Ollama at {OLLAMA_HOST}: {str(e)}",
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama error: {response.text}",
        )

    data = response.json()
    answer = (data.get("response") or "").strip()

    if not answer:
        raise HTTPException(status_code=502, detail="Ollama returned empty answer.")

    return answer


def greeting_answer() -> str:
    return "Hi! Ask me anything about this PDF/note and I’ll answer using its content."


def no_content_answer() -> str:
    return "The PDF/note was not processed or has no readable content."


def get_doc_id(payload: Any) -> Optional[str]:
    if payload is None:
        return None

    return (
        getattr(payload, "docId", None)
        or getattr(payload, "doc_id", None)
        or getattr(payload, "document_id", None)
    )


@app.get("/")
def root():
    return {
        "success": True,
        "message": "StudyFlow AskPDF backend is running.",
        "model": OLLAMA_MODEL,
        "docs_loaded": len(DOCS),
    }


@app.get("/health")
def health():
    try:
        tags = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=10)
        return {
            "success": True,
            "message": "AskPDF backend is running.",
            "ollama_reachable": tags.status_code == 200,
            "ollama_status": tags.status_code,
            "model": OLLAMA_MODEL,
            "docs_loaded": len(DOCS),
        }
    except Exception as e:
        return {
            "success": False,
            "message": "AskPDF backend is running, but Ollama is not reachable.",
            "error": str(e),
            "model": OLLAMA_MODEL,
        }


@app.post("/process")
async def process(file: Optional[UploadFile] = File(None), uploaded_file: Optional[UploadFile] = File(None)):
    selected_file = file or uploaded_file

    if selected_file is None:
        raise HTTPException(status_code=422, detail="No file uploaded. Use field name 'file' or 'uploaded_file'.")

    raw_bytes = await selected_file.read()
    text = extract_uploaded_text(selected_file, raw_bytes)

    if len(text.strip()) < 20:
        raise HTTPException(status_code=422, detail="Could not extract enough text from this file.")

    doc_id = str(uuid.uuid4())
    chunks = chunk_text(text)

    DOCS[doc_id] = {
        "filename": selected_file.filename,
        "text": text,
        "chunks": chunks,
    }

    return {
        "success": True,
        "message": "PDF processed successfully.",
        "docId": doc_id,
        "doc_id": doc_id,
        "document_id": doc_id,
        "filename": selected_file.filename,
        "chunks_count": len(chunks),
        "embeddings_created": False,
    }


@app.get("/get_chunks")
def get_chunks_get(docId: Optional[str] = Query(None), doc_id: Optional[str] = Query(None)):
    final_doc_id = docId or doc_id

    if not final_doc_id or final_doc_id not in DOCS:
        raise HTTPException(status_code=404, detail="Document not found.")

    doc = DOCS[final_doc_id]

    return {
        "success": True,
        "docId": final_doc_id,
        "filename": doc["filename"],
        "chunks": doc["chunks"],
        "chunks_count": len(doc["chunks"]),
    }


@app.post("/get_chunks")
def get_chunks_post(payload: ChunksRequest):
    final_doc_id = get_doc_id(payload)

    if not final_doc_id or final_doc_id not in DOCS:
        raise HTTPException(status_code=404, detail="Document not found.")

    doc = DOCS[final_doc_id]

    return {
        "success": True,
        "docId": final_doc_id,
        "filename": doc["filename"],
        "chunks": doc["chunks"],
        "chunks_count": len(doc["chunks"]),
    }


@app.post("/generate")
def generate(payload: GenerateRequest):
    final_doc_id = get_doc_id(payload)

    original_question = normalize_question(
        payload.question
        or payload.query
        or payload.prompt
        or payload.message
        or ""
    )

    if not original_question:
        raise HTTPException(status_code=422, detail="Please write a question first.")

    lower_question = original_question.lower()

    if is_greeting_question(lower_question):
        reply = greeting_answer()
        return {
            "success": True,
            "answer": reply,
            "response": reply,
            "output": reply,
            "sources": [],
            "used_chunks": 0,
        }

    if not final_doc_id:
        if len(DOCS) == 1:
            final_doc_id = next(iter(DOCS.keys()))
        else:
            raise HTTPException(status_code=422, detail="docId is required.")

    if final_doc_id not in DOCS:
        raise HTTPException(status_code=404, detail="Document not found. Upload/process the PDF first.")

    doc = DOCS[final_doc_id]

    if not doc.get("chunks"):
        reply = no_content_answer()
        return {
            "success": True,
            "answer": reply,
            "response": reply,
            "output": reply,
            "docId": final_doc_id,
            "sources": [],
            "used_chunks": 0,
        }

    # Query Rewriting
    rewritten_question = rewrite_query(original_question, payload.history)

    overview_intent = is_overview_question(lower_question)

    # Retrieval
    selected_chunks = retrieve_chunks(rewritten_question, doc["chunks"], top_k=5)

    if overview_intent and not selected_chunks:
        selected_chunks = first_meaningful_chunks(doc["chunks"], top_k=4)

    if not selected_chunks:
        fallback = "I couldn\'t find this information in the uploaded PDF/note. Could you ask about something shown in the material?"

        return {
            "success": True,
            "answer": fallback,
            "response": fallback,
            "output": fallback,
            "docId": final_doc_id,
            "sources": [],
            "used_chunks": 0,
            "rewritten_question": rewritten_question if rewritten_question != original_question else None,
        }

    context = "\n\n---\n\n".join(selected_chunks)

    # Logging for debugging
    print(f"--- AskPDF Debug ---")
    print(f"Original Question: {original_question}")
    if rewritten_question != original_question:
        print(f"Rewritten Question: {rewritten_question}")
    print(f"Retrieved Chunks Count: {len(selected_chunks)}")
    for i, chunk in enumerate(selected_chunks):
        print(f"Chunk {i+1} Preview: {chunk[:100]}...")
    
    # Generate Answer
    if overview_intent:
        overview_question = f"Give me a short overview of this PDF/note. User request: {original_question}"
        answer = call_ollama(overview_question, context)
    else:
        answer = call_ollama(rewritten_question, context)

    print(f"Final Answer Preview: {answer[:100]}...")
    print(f"--------------------")

    return {
        "success": True,
        "answer": answer,
        "response": answer,
        "output": answer,
        "docId": final_doc_id,
        "sources": selected_chunks,
        "used_chunks": len(selected_chunks),
        "rewritten_question": rewritten_question if rewritten_question != original_question else None,
    }


@app.post("/api/v1/query")
def api_v1_query(payload: GenerateRequest):
    return generate(payload)