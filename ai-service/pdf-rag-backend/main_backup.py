from __future__ import annotations

import json
import hashlib
import logging
import os
import re
import uuid
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import pdfplumber
import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


APP_NAME = "StudyFlow PDF RAG Backend"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "420"))

CHUNK_SIZE = int(os.getenv("PDF_RAG_CHUNK_SIZE", "900"))
CHUNK_OVERLAP = int(os.getenv("PDF_RAG_CHUNK_OVERLAP", "160"))
TOP_K = int(os.getenv("PDF_RAG_TOP_K", "5"))

DATA_DIR = Path(__file__).resolve().parent / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title=APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DOCS: Dict[str, Dict[str, Any]] = {}
LATEST_DOC_ID: Optional[str] = None
DOCS_BY_HASH: Dict[str, str] = {}


class AskRequest(BaseModel):
    doc_id: Optional[str] = None
    question: Optional[str] = None
    query: Optional[str] = None
    prompt: Optional[str] = None
    message: Optional[str] = None


class GenerateRequest(BaseModel):
    doc_id: Optional[str] = None
    question: Optional[str] = None
    query: Optional[str] = None
    prompt: Optional[str] = None
    message: Optional[str] = None


class McqRequest(BaseModel):
    doc_id: Optional[str] = None
    questions_count: int = 5


def clean_text(text: str) -> str:
    text = str(text or "").replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def file_hash(raw_bytes: bytes) -> str:
    return hashlib.sha256(raw_bytes).hexdigest()


def extract_pdf_text(path: Path) -> str:
    pages: List[str] = []

    with pdfplumber.open(str(path)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text() or ""
            page_text = clean_text(page_text)

            if page_text:
                pages.append(f"[Page {i}]\n{page_text}")

    return clean_text("\n\n".join(pages))


def count_pdf_pages(path: Path) -> int:
    try:
        with pdfplumber.open(str(path)) as pdf:
            return len(pdf.pages)
    except Exception:
        return 0


def split_chunks(text: str) -> List[Dict[str, Any]]:
    text = clean_text(text)

    if not text:
        return []

    words = text.split()
    chunks: List[Dict[str, Any]] = []

    step = max(1, CHUNK_SIZE - CHUNK_OVERLAP)

    for start in range(0, len(words), step):
        part = words[start : start + CHUNK_SIZE]
        if not part:
            continue

        chunk_text = " ".join(part).strip()

        if len(chunk_text) < 80:
            continue

        chunks.append(
            {
                "id": len(chunks) + 1,
                "text": chunk_text,
            }
        )

    return chunks


def tokenize(text: str) -> List[str]:
    text = str(text or "").lower()
    return re.findall(r"[a-zA-Z0-9_]+", text)


def retrieve_chunks(doc_id: str, question: str, top_k: int = TOP_K) -> List[Dict[str, Any]]:
    doc = DOCS.get(doc_id)

    if not doc:
        return []

    chunks = doc.get("chunks", [])
    q_tokens = set(tokenize(question))

    if not q_tokens:
        return []

    logger.info(
        "Quiz retrieval start doc_id=%s top_k=%s question_chars=%s",
        doc_id,
        top_k,
        len(question or ""),
    )

    retrieval_start = time.perf_counter()

    scored = []

    for chunk in chunks:
        c_tokens = tokenize(chunk.get("text", ""))
        if not c_tokens:
            continue

        c_set = set(c_tokens)
        overlap = len(q_tokens & c_set)
        soft_score = 0

        q_lower = question.lower()
        c_lower = chunk.get("text", "").lower()

        for token in q_tokens:
            if len(token) >= 4 and token in c_lower:
                soft_score += 1

        score = overlap + soft_score

        if score > 0:
            scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)

    elapsed_ms = round((time.perf_counter() - retrieval_start) * 1000, 2)
    logger.info(
        "Quiz retrieval done doc_id=%s candidate_chunks=%s returned=%s elapsed_ms=%s",
        doc_id,
        len(scored),
        min(top_k, len(scored)),
        elapsed_ms,
    )

    return [chunk for _, chunk in scored[:top_k]]


def first_meaningful_chunks(doc_id: str, limit: int = TOP_K) -> List[Dict[str, Any]]:
    doc = DOCS.get(doc_id)

    if not doc:
        return []

    chunks = doc.get("chunks", [])

    return chunks[:limit]


def build_context(chunks: List[Dict[str, Any]]) -> str:
    parts = []

    for chunk in chunks:
        parts.append(f"[Chunk {chunk.get('id')}]\n{chunk.get('text', '')}")

    return "\n\n".join(parts).strip()


def ollama_generate(prompt: str, temperature: float = 0.1, num_predict: int = 1200) -> str:
    llm_start = time.perf_counter()
    url = f"{OLLAMA_HOST}/api/generate"

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": num_predict,
        },
    }

    response = requests.post(url, json=payload, timeout=OLLAMA_TIMEOUT)
    response.raise_for_status()

    data = response.json()
    answer = str(data.get("response", "")).strip()

    logger.info(
        "Ollama generation done model=%s prompt_chars=%s answer_chars=%s elapsed_ms=%s",
        OLLAMA_MODEL,
        len(prompt or ""),
        len(answer),
        round((time.perf_counter() - llm_start) * 1000, 2),
    )

    return answer


def get_question_from_request(req: Any) -> str:
    return clean_text(
        getattr(req, "question", None)
        or getattr(req, "query", None)
        or getattr(req, "prompt", None)
        or getattr(req, "message", None)
        or ""
    )


def get_doc_id_or_latest(doc_id: Optional[str]) -> Optional[str]:
    if doc_id and doc_id in DOCS:
        return doc_id

    return LATEST_DOC_ID


def is_greeting(q_lower: str) -> bool:
    greetings = {
        "hi",
        "hello",
        "hey",
        "good morning",
        "good evening",
        "good afternoon",
        "salam",
        "مرحبا",
        "اهلا",
        "أهلا",
    }

    return q_lower.strip() in greetings


def is_overview_question(q_lower: str) -> bool:
    overview_phrases = [
        "tell me about this note",
        "tell me about this pdf",
        "what is this pdf about",
        "what this pdf is about",
        "what is this note about",
        "what this note is about",
        "summarize this note",
        "summarize this pdf",
        "give me an overview",
        "explain this pdf",
        "explain this note",
        "overview",
        "summary of this pdf",
        "summary of this note",
    ]

    return any(phrase in q_lower for phrase in overview_phrases)


def grounded_answer(doc_id: str, question: str) -> Dict[str, Any]:
    total_start = time.perf_counter()
    q = clean_text(question)
    q_lower = q.lower()

    if not q:
        return {
            "answer": "Please write a question first.",
            "reply": "Please write a question first.",
            "chunks": [],
        }

    if is_greeting(q_lower):
        greeting = "Hi! Ask me anything about this PDF/note and I’ll answer using its content."
        return {
            "answer": greeting,
            "reply": greeting,
            "chunks": [],
        }

    overview = is_overview_question(q_lower)

    if overview:
        chunks = first_meaningful_chunks(doc_id, TOP_K)
    else:
        chunks = retrieve_chunks(doc_id, q, TOP_K)

    if not chunks and overview:
        chunks = first_meaningful_chunks(doc_id, TOP_K)

    if not chunks:
        fallback = "I couldn’t find this information in the uploaded PDF/note. Could you ask about something shown in the material?"
        return {
            "answer": fallback,
            "reply": fallback,
            "chunks": [],
        }

    context = build_context(chunks)

    logger.info(
        "Quiz answer context doc_id=%s overview=%s chunks=%s context_chars=%s",
        doc_id,
        overview,
        len(chunks),
        len(context),
    )

    if overview:
        task = """
Give a short friendly overview of what this PDF/note is about.
Use only the provided context.
Mention the main topics clearly.
Do not invent information.
"""
    else:
        task = """
Answer the user's question using only the provided PDF/note context.
If the context gives a direct answer, answer clearly.
If the context does not give a direct written definition but a diagram or example suggests the idea, say:
"The PDF does not give a direct written definition, but based on the diagram/example..."
If the context is not enough, say politely that the information could not be found in the uploaded PDF/note.
Do not invent information.
"""

    prompt = f"""
You are StudyFlow's friendly PDF assistant.

Rules:
- Use ONLY the PDF/note context below.
- Do not use outside knowledge.
- Be clear and helpful.
- Keep the answer concise unless the user asks for details.

PDF/NODE CONTEXT:
{context}

USER QUESTION:
{q}

TASK:
{task}

ANSWER:
""".strip()

    answer = ollama_generate(prompt, temperature=0.1, num_predict=900)

    if not answer:
        answer = "I couldn’t generate an answer right now. Please try again."

    return {
        "answer": answer,
        "reply": answer,
        "chunks": chunks,
        "total_time_ms": round((time.perf_counter() - total_start) * 1000, 2),
    }


def mcq_prompt(context: str, count: int = 5) -> str:
    return f"""
Generate exactly {count} MCQs from the uploaded PDF content.

STRICT REQUIREMENTS:
- Use ONLY the PDF context below.
- Do NOT use outside knowledge.
- Do NOT invent terms that are not supported by the PDF.
- Generate exactly 5 questions:
  - Q1, Q2, Q3 must be Hard.
  - Q4, Q5 must be Medium.
- Each question must have exactly A, B, C, D.
- Correct answer must be one letter only.
- No "All of the above".
- No "None of the above".
- No copied long sentences from the PDF.
- Keep options short and clear.
- Add a short explanation based only on the PDF.
- Do not start with phrases like "Here are 5 MCQs".
- Output only the MCQs.

DIFFICULTY RULES:
- Medium questions can test direct understanding of one concept or one step.
- Hard questions must require comparison, ordering, distinction, sequencing, or applying two related facts from the PDF.
- Do NOT label simple definition questions as Hard.
- Hard questions should not be answerable by reading one obvious sentence only.
- Avoid asking only "What is..." for Hard questions unless it compares two concepts.

SOURCE-SAFETY RULES:
- If the PDF says a step does something, keep that meaning exact.
- Do not confuse different steps or concepts.
- If the context says one step creates an event-response/use-case list and another step draws an event DFD, do not mix their purposes.
- Distractors should be plausible but must use concepts or wording supported by the PDF context.
- Avoid fake concepts unless the PDF mentions them.
- Explanations must mention the supporting idea from the PDF context.

PDF CONTEXT:
{context}

FORMAT EXACTLY:

Q1 (Hard): ...
A. ...
B. ...
C. ...
D. ...
Correct answer: ...
Explanation: ...

Q2 (Hard): ...
A. ...
B. ...
C. ...
D. ...
Correct answer: ...
Explanation: ...

Q3 (Hard): ...
A. ...
B. ...
C. ...
D. ...
Correct answer: ...
Explanation: ...

Q4 (Medium): ...
A. ...
B. ...
C. ...
D. ...
Correct answer: ...
Explanation: ...

Q5 (Medium): ...
A. ...
B. ...
C. ...
D. ...
Correct answer: ...
Explanation: ...
""".strip()

def generate_mcq_from_doc(doc_id: str, count: int = 5) -> Dict[str, Any]:
    total_start = time.perf_counter()
    chunks = first_meaningful_chunks(doc_id, limit=10)

    if not chunks:
        raise HTTPException(status_code=400, detail="No readable PDF/note content found.")

    context = build_context(chunks)
    logger.info(
        "Quiz MCQ context doc_id=%s chunks=%s context_chars=%s",
        doc_id,
        len(chunks),
        len(context),
    )
    prompt = mcq_prompt(context, count=count)

    output = ollama_generate(prompt, temperature=0.15, num_predict=1800)

    return {
        "quiz": output,
        "questions_text": output,
        "questions": output,
        "chunks": chunks,
        "total_time_ms": round((time.perf_counter() - total_start) * 1000, 2),
    }


@app.get("/")
def root():
    return {
        "name": APP_NAME,
        "status": "running",
        "model": OLLAMA_MODEL,
    }


@app.get("/health")
def health():
    ollama_ok = False

    try:
        response = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5)
        ollama_ok = response.ok
    except Exception:
        ollama_ok = False

    return {
        "status": "ok",
        "service": "pdf-rag-backend",
        "ollama_host": OLLAMA_HOST,
        "ollama_model": OLLAMA_MODEL,
        "ollama_ok": ollama_ok,
        "documents_loaded": len(DOCS),
    }


@app.post("/process")
async def process(
    file: UploadFile = File(...),
):
    global LATEST_DOC_ID

    filename = file.filename or "uploaded.pdf"
    ext = Path(filename).suffix.lower()

    if ext != ".pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are supported right now.")

    content = await file.read()

    content_hash = file_hash(content)

    if content_hash in DOCS_BY_HASH and DOCS_BY_HASH[content_hash] in DOCS:
        cached_doc_id = DOCS_BY_HASH[content_hash]
        cached_doc = DOCS[cached_doc_id]

        LATEST_DOC_ID = cached_doc_id

        logger.info(
            "PDF cache hit filename=%s doc_id=%s pages=%s chunks=%s bytes=%s",
            filename,
            cached_doc_id,
            cached_doc.get("page_count", 0),
            len(cached_doc.get("chunks", [])),
            len(content),
        )

        return {
            "message": "PDF already processed.",
            "doc_id": cached_doc_id,
            "filename": cached_doc.get("filename", filename),
            "chunks_count": len(cached_doc.get("chunks", [])),
            "embeddings_created": False,
            "cached": True,
        }

    doc_id = str(uuid.uuid4())
    saved_path = UPLOAD_DIR / f"{doc_id}_{filename}"

    saved_path.write_bytes(content)

    process_start = time.perf_counter()

    text = extract_pdf_text(saved_path)
    page_count = count_pdf_pages(saved_path)
    chunks = split_chunks(text)

    if not chunks:
        raise HTTPException(status_code=400, detail="No readable text found in this PDF.")

    DOCS[doc_id] = {
        "doc_id": doc_id,
        "filename": filename,
        "path": str(saved_path),
        "text": text,
        "chunks": chunks,
        "file_hash": content_hash,
        "page_count": page_count,
    }

    DOCS_BY_HASH[content_hash] = doc_id

    LATEST_DOC_ID = doc_id

    logger.info(
        "PDF processed filename=%s doc_id=%s bytes=%s pages=%s chunks=%s elapsed_ms=%s",
        filename,
        doc_id,
        len(content),
        page_count,
        len(chunks),
        round((time.perf_counter() - process_start) * 1000, 2),
    )

    return {
        "message": "PDF processed successfully.",
        "doc_id": doc_id,
        "filename": filename,
        "chunks_count": len(chunks),
        "page_count": page_count,
        "embeddings_created": True,
        "cached": False,
    }


@app.post("/ask")
async def ask(req: AskRequest):
    q = get_question_from_request(req)
    doc_id = get_doc_id_or_latest(req.doc_id)

    if not doc_id:
        raise HTTPException(status_code=400, detail="No PDF/note has been processed yet.")

    result = grounded_answer(doc_id, q)

    return {
        "message": "Answer generated.",
        "doc_id": doc_id,
        "answer": result["answer"],
        "reply": result["reply"],
        "chunks": result["chunks"],
    }


@app.post("/generate")
async def generate(req: GenerateRequest):
    q = get_question_from_request(req)
    doc_id = get_doc_id_or_latest(req.doc_id)

    if not doc_id:
        raise HTTPException(status_code=400, detail="No PDF/note has been processed yet.")

    result = grounded_answer(doc_id, q)

    return {
        "message": "Answer generated.",
        "doc_id": doc_id,
        "answer": result["answer"],
        "reply": result["reply"],
        "output": result["answer"],
        "response": result["answer"],
        "chunks": result["chunks"],
    }


@app.post("/generate-mcq")
async def generate_mcq_json(req: McqRequest):
    doc_id = get_doc_id_or_latest(req.doc_id)

    if not doc_id:
        raise HTTPException(status_code=400, detail="No PDF/note has been processed yet.")

    result = generate_mcq_from_doc(doc_id, count=req.questions_count or 5)

    return {
        "message": "MCQ quiz generated.",
        "doc_id": doc_id,
        **result,
    }


@app.post("/generate-mcq-file")
async def generate_mcq_file(
    file: UploadFile = File(...),
    questions_count: int = Form(5),
):
    processed = await process(file)
    doc_id = processed["doc_id"]
    result = generate_mcq_from_doc(doc_id, count=questions_count or 5)

    return {
        "message": "MCQ quiz generated.",
        "doc_id": doc_id,
        **result,
    }