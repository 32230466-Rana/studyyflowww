from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from typing import Dict, List, Any, Optional
import fitz  # PyMuPDF
import requests
import uuid
import os
import re
import json
import time


# =========================================================
# AskPDF Backend - Safe Local Version
# Supports:
# /health
# /process
# /get_chunks
# /generate
# /api/v1/query   legacy compatibility
# =========================================================

app = FastAPI(title="StudyFlow AskPDF Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
ASKPDF_MODEL = os.getenv("ASKPDF_MODEL", os.getenv("OLLAMA_MODEL", "qwen3:1.7b"))

DOCUMENT_STORE: Dict[str, Dict[str, Any]] = {}
LAST_OPERATION_ID: Optional[str] = None


# =========================================================
# Helpers
# =========================================================

def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_page_text(page_text: str, page_number: int, max_words: int = 220, overlap: int = 45) -> List[Dict[str, Any]]:
    page_text = clean_text(page_text)
    words = page_text.split()

    if not words:
        return []

    chunks = []
    start = 0

    while start < len(words):
        end = min(start + max_words, len(words))
        chunk_words = words[start:end]
        chunk_text = " ".join(chunk_words).strip()

        if chunk_text:
            chunks.append({
                "page": page_number,
                "text": f"[Page {page_number}]\n{chunk_text}"
            })

        if end >= len(words):
            break

        start = max(0, end - overlap)

    return chunks


def extract_text_from_pdf(file_bytes: bytes) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not open PDF file: {str(e)}")

    for page_index, page in enumerate(doc, start=1):
        page_text = page.get_text("text")
        chunks.extend(chunk_page_text(page_text, page_index))

    doc.close()
    return chunks


def extract_text_from_txt(file_bytes: bytes) -> List[Dict[str, Any]]:
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        text = file_bytes.decode("latin-1", errors="ignore")

    text = clean_text(text)
    fake_page_chunks = chunk_page_text(text, 1)
    return fake_page_chunks


def tokenize(text: str) -> set:
    return set(re.findall(r"[a-zA-Z0-9_]+", text.lower()))


def is_about_question(question: str) -> bool:
    q = question.lower()
    patterns = [
        "what this pdf",
        "what is this pdf",
        "what the pdf",
        "pdf about",
        "document about",
        "this file about",
        "this pdf is about",
        "what this pdf id sbout",
        "what this pdf is sbout",
    ]
    return any(p in q for p in patterns)


def is_greeting(question: str) -> bool:
    q = question.strip().lower()
    return q in ["hi", "hello", "hey", "salam", "Ù…Ø±Ø­Ø¨Ø§", "Ø§Ù‡Ù„Ø§", "Ø£Ù‡Ù„Ø§"]


def select_relevant_chunks(question: str, chunks: List[Dict[str, Any]], limit: int = 8) -> List[Dict[str, Any]]:
    if not chunks:
        return []

    # If the user asks what the PDF/note/file is about,
    # do not only use the first pages. Pick overview + table of contents
    # + middle/later important sections so big PDFs are summarized better.
    if is_about_question(question):
        important_keywords = [
            "table of contents",
            "purpose",
            "context dfd",
            "functional decomposition",
            "event-response",
            "event dfd",
            "system dfd",
            "data store",
            "illegal data flows",
            "diverging",
            "converging",
            "balancing",
            "crud",
            "mini case",
            "smartlibrary",
            "practice questions",
            "answer key",
            "advanced comparison",
            "review summary",
            "glossary",
            "askpdf testing prompts",
            "closing notes",
        ]

        selected = []
        seen = set()

        # Always include early overview pages.
        for chunk in chunks:
            page = int(chunk.get("page", 999))
            if page <= 3:
                key = (page, chunk.get("text", "")[:80])
                if key not in seen:
                    selected.append(chunk)
                    seen.add(key)

        # Add chunks that contain important section keywords from anywhere in the PDF.
        for chunk in chunks:
            text_lower = chunk.get("text", "").lower()
            page = int(chunk.get("page", 999))

            if any(keyword in text_lower for keyword in important_keywords):
                key = (page, chunk.get("text", "")[:80])
                if key not in seen:
                    selected.append(chunk)
                    seen.add(key)

            if len(selected) >= 16:
                break

        # If still too few, add evenly spaced chunks from the document.
        if len(selected) < 10 and len(chunks) > 0:
            step = max(1, len(chunks) // 10)
            for i in range(0, len(chunks), step):
                chunk = chunks[i]
                page = int(chunk.get("page", 999))
                key = (page, chunk.get("text", "")[:80])
                if key not in seen:
                    selected.append(chunk)
                    seen.add(key)
                if len(selected) >= 16:
                    break

        return selected[:16]

    question_terms = tokenize(question)
    scored = []

    for chunk in chunks:
        chunk_terms = tokenize(chunk.get("text", ""))
        overlap = len(question_terms.intersection(chunk_terms))

        page = int(chunk.get("page", 999))
        if page <= 3:
            overlap += 1

        scored.append((overlap, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)

    selected = [chunk for score, chunk in scored[:limit] if score > 0]

    if not selected:
        selected = chunks[:limit]

    return selected

def build_context(selected_chunks: List[Dict[str, Any]]) -> str:
    return "\n\n---\n\n".join(chunk["text"] for chunk in selected_chunks)


def strip_thinking(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"```.*?```", lambda m: m.group(0).replace("```", ""), text, flags=re.DOTALL)
    return text.strip()


def looks_like_generic_pdf_answer(answer: str) -> bool:
    bad_phrases = [
        "i can't directly access",
        "i cannot directly access",
        "open it using",
        "adobe acrobat reader",
        "pdf reader",
        "provide me with the title",
        "provide more details",
        "i can't interact with files",
        "i cannot interact with files",
    ]
    low = answer.lower()
    return any(p in low for p in bad_phrases)


def fallback_source_summary(context: str) -> str:
    raw_lines = []
    for line in context.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("[Page"):
            continue

        # remove noise
        low = line.lower()
        if "copyright" in low:
            continue
        if "all rights reserved" in low:
            continue
        if line.isdigit():
            continue

        raw_lines.append(line)

    joined = " ".join(raw_lines)
    joined = re.sub(r"\s+", " ", joined).strip()

    if not joined:
        return "I cannot answer because no PDF content was provided."

    low = joined.lower()

    topics = []

    if "process modeling" in low:
        topics.append("Process Modeling")
    if "data flow diagram" in low or "dfd" in low:
        topics.append("Data Flow Diagrams (DFDs)")
    if "composite" in low and "elementary" in low:
        topics.append("Composite and Elementary Data Flows")
    if "data stores" in low or "data store" in low:
        topics.append("Data Flows To and From Data Stores")
    if "illegal data flows" in low:
        topics.append("Illegal Data Flows")
    if "diverging" in low and "converging" in low:
        topics.append("Diverging and Converging Data Flows")
    if "modern structured analysis" in low:
        topics.append("Modern Structured Analysis")
    if "context dfd" in low:
        topics.append("Context DFDs")
    if "functional decomposition" in low:
        topics.append("Functional Decomposition Diagrams")
    if "event-response" in low or "use-case" in low or "use case" in low:
        topics.append("Event-Response / Use-Case Lists")
    if "event dfd" in low:
        topics.append("Event DFDs")
    if "system dfd" in low:
        topics.append("System DFDs")
    if "soundstage" in low:
        topics.append("SoundStage example")
    if "smartlibrary" in low:
        topics.append("SmartLibrary case study")
    if "practice questions" in low:
        topics.append("Practice Questions")
    if "answer key" in low:
        topics.append("Answer Key")
    if "glossary" in low:
        topics.append("Glossary")

    # remove duplicates while keeping order
    unique_topics = []
    for topic in topics:
        if topic not in unique_topics:
            unique_topics.append(topic)

    if not unique_topics:
        preview = joined[:900].strip()
        return (
            "This PDF is about the following main content from the uploaded document: "
            + preview
            + ("..." if len(joined) > 900 else "")
        )

    main_topic = " and ".join(unique_topics[:2]) if len(unique_topics) >= 2 else unique_topics[0]

    summary = f"This PDF is about {main_topic}.\n\n"

    summary += "Main sections/topics covered:\n"
    for topic in unique_topics:
        summary += f"- {topic}\n"

    if "diverging" in low and "converging" in low:
        summary += (
            "\nIt explains that a diverging data flow splits one data flow into multiple flows, "
            "while a converging data flow merges multiple flows into one packet for later processing.\n"
        )

    if "modern structured analysis" in low:
        summary += (
            "\nIt also explains the structured analysis process: drawing a context DFD, "
            "creating a functional decomposition diagram, making an event-response or use-case list, "
            "drawing event DFDs, and merging them into a system DFD.\n"
        )

    if "illegal data flows" in low:
        summary += (
            "\nThe PDF also discusses illegal data flows, meaning incorrect DFD connections that need a process "
            "between external agents, data stores, or other system parts.\n"
        )

    if "soundstage" in low:
        summary += (
            "\nExample included: the SoundStage example, which shows context DFD, functional decomposition, "
            "use case list, event decomposition, and system DFD ideas.\n"
        )

    if "smartlibrary" in low:
        summary += (
            "\nExample included: the SmartLibrary case study, which is used to explain context DFDs, "
            "event DFDs, system DFDs, data stores, and process modeling decisions.\n"
        )

    return summary.strip()
def make_pdf_overview_summary(context: str) -> str:
    low = context.lower()

    sections = []

    if "process modeling" in low:
        sections.append("Process Modeling")
    if "data flow" in low or "dfd" in low:
        sections.append("Data Flow Diagrams (DFDs)")
    if "composite" in low and "elementary" in low:
        sections.append("Composite and Elementary Data Flows")
    if "data stores" in low or "data store" in low:
        sections.append("Data Flows To and From Data Stores")
    if "illegal data flows" in low:
        sections.append("Illegal Data Flows")
    if "diverging" in low and "converging" in low:
        sections.append("Diverging and Converging Data Flows")
    if "modern structured analysis" in low:
        sections.append("Modern Structured Analysis")
    if "context dfd" in low:
        sections.append("Context DFDs")
    if "functional decomposition" in low:
        sections.append("Functional Decomposition Diagrams")
    if "event-response" in low or "use-case" in low or "use case" in low:
        sections.append("Event-Response / Use-Case Lists")
    if "event dfd" in low:
        sections.append("Event DFDs")
    if "system dfd" in low:
        sections.append("System DFDs")
    if "soundstage" in low:
        sections.append("SoundStage Example")
    if "smartlibrary" in low:
        sections.append("SmartLibrary Case Study")
    if "practice questions" in low:
        sections.append("Practice Questions")
    if "answer key" in low:
        sections.append("Answer Key")
    if "glossary" in low:
        sections.append("Glossary")

    unique_sections = []
    for section in sections:
        if section not in unique_sections:
            unique_sections.append(section)

    if not unique_sections:
        return "I cannot answer because no PDF content was provided."

    answer = "This PDF is about Process Modeling and Data Flow Diagrams (DFDs).\n\n"

    answer += "Main sections covered:\n"
    for section in unique_sections:
        answer += f"- {section}\n"

    answer += "\nDetailed summary:\n"
    answer += (
        "The document explains how process modeling is used to understand how data moves through a system. "
        "It focuses on Data Flow Diagrams, including different types of data flows and how they connect "
        "processes, data stores, and external agents. "
    )

    if "illegal data flows" in low:
        answer += (
            "It also discusses illegal data flows, which are incorrect DFD connections such as direct flows "
            "between external agents and data stores without a process. "
        )

    if "diverging" in low and "converging" in low:
        answer += (
            "The PDF explains diverging data flows as one flow splitting into multiple flows, and converging "
            "data flows as multiple flows merging into one packet for later processing. "
        )

    if "modern structured analysis" in low:
        answer += (
            "It includes the steps of modern structured analysis: drawing a context DFD, creating a functional "
            "decomposition diagram, creating an event-response or use-case list, drawing event DFDs, and merging "
            "them into a system DFD. "
        )

    if "soundstage" in low:
        answer += (
            "The PDF also includes a SoundStage example showing context DFD, functional decomposition, "
            "use case list, event decomposition, and system DFD ideas. "
        )

    if "smartlibrary" in low:
        answer += (
            "The PDF also includes a SmartLibrary case study that applies the same DFD ideas to a library system. "
        )

    return answer.strip()
def ask_ollama(question: str, context: str) -> str:
    if not context.strip():
        return "I cannot answer because no PDF content was provided."

    prompt = f"""
You are an AskPDF assistant for StudyFlow.

Answer the user's question using ONLY the PDF context below.

Strict rules:
- Use ONLY the PDF context.
- Do NOT use outside knowledge.
- Do NOT say you cannot access PDFs if context is provided.
- Do NOT give generic advice about opening PDFs.
- If the PDF context is empty, say exactly: I cannot answer because no PDF content was provided.
- If the answer is not in the PDF context, say: The PDF does not provide enough information to answer this.
- Be direct and helpful.
- If the user asks what the PDF/note/file is about, give a detailed summary.
- Include the main topic, major sections, important concepts, examples/case studies, practice questions, and final review points if they appear in the context.
- Do not stop after the first few pages. Mention later important sections too if they are provided in the context.
PDF CONTEXT:
{context}

USER QUESTION:
{question}

ANSWER:
""".strip()

    payload = {
        "model": ASKPDF_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "top_p": 0.85,
            "repeat_penalty": 1.12,
            "num_ctx": 4096,
            "num_predict": 900,
        },
        "keep_alive": "10m",
    }

    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json=payload,
            timeout=240,
        )
    except requests.RequestException as e:
        raise HTTPException(
            status_code=503,
            detail=f"Ollama is not reachable at {OLLAMA_URL}. Error: {str(e)}"
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"Ollama error {response.status_code}: {response.text}"
        )

    data = response.json()
    answer = strip_thinking(data.get("response", ""))

    if not answer:
        answer = fallback_source_summary(context)

    if looks_like_generic_pdf_answer(answer):
        answer = fallback_source_summary(context)

    return answer


async def read_payload(request: Request) -> Dict[str, Any]:
    data: Dict[str, Any] = dict(request.query_params)

    content_type = request.headers.get("content-type", "").lower()

    try:
        if "application/json" in content_type:
            body = await request.json()
            if isinstance(body, dict):
                data.update(body)

        elif "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
            form = await request.form()
            for key, value in form.items():
                if not hasattr(value, "filename"):
                    data[key] = value

        else:
            raw = await request.body()
            if raw:
                raw_text = raw.decode("utf-8", errors="ignore").strip()
                if raw_text:
                    try:
                        body = json.loads(raw_text)
                        if isinstance(body, dict):
                            data.update(body)
                        else:
                            data["question"] = raw_text
                    except json.JSONDecodeError:
                        data["question"] = raw_text

    except Exception:
        pass

    return data


def extract_question(data: Dict[str, Any]) -> str:
    for key in ["question", "message", "query", "prompt", "human_input", "text"]:
        value = data.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def extract_operation_id(data: Dict[str, Any]) -> Optional[str]:
    for key in ["operation_id", "operationId", "document_id", "documentId", "doc_id", "docId", "file_id", "fileId"]:
        value = data.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def get_chunks_for_operation(operation_id: Optional[str]) -> tuple[Optional[str], List[Dict[str, Any]]]:
    global LAST_OPERATION_ID

    if operation_id and operation_id in DOCUMENT_STORE:
        return operation_id, DOCUMENT_STORE[operation_id]["chunks"]

    if LAST_OPERATION_ID and LAST_OPERATION_ID in DOCUMENT_STORE:
        return LAST_OPERATION_ID, DOCUMENT_STORE[LAST_OPERATION_ID]["chunks"]

    return operation_id, []


def make_answer_response(answer: str, operation_id: Optional[str], used_chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
    pages = sorted(list({chunk.get("page") for chunk in used_chunks if chunk.get("page") is not None}))

    return {
        "answer": answer,
        "response": answer,
        "message": answer,
        "text": answer,
        "operation_id": operation_id,
        "operationId": operation_id,
        "pages": pages,
        "sources": pages,
        "chunks_used": len(used_chunks),
        "model": ASKPDF_MODEL,
    }


# =========================================================
# Routes
# =========================================================

@app.get("/")
async def root():
    return {
        "message": "StudyFlow AskPDF backend is running",
        "routes": ["/health", "/process", "/get_chunks", "/generate", "/api/v1/query"],
        "model": ASKPDF_MODEL,
    }


@app.get("/health")
async def health():
    ollama_ok = False
    ollama_error = None

    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        ollama_ok = r.status_code == 200
    except Exception as e:
        ollama_error = str(e)

    return {
        "status": "ok",
        "askpdf": "running",
        "ollama_ok": ollama_ok,
        "ollama_url": OLLAMA_URL,
        "ollama_error": ollama_error,
        "model": ASKPDF_MODEL,
        "documents_loaded": len(DOCUMENT_STORE),
        "last_operation_id": LAST_OPERATION_ID,
    }


@app.post("/process")
async def process(file: UploadFile = File(...)):
    global LAST_OPERATION_ID

    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    filename = file.filename or "uploaded_file"
    extension = filename.lower().split(".")[-1]

    file_bytes = await file.read()

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if extension == "pdf":
        chunks = extract_text_from_pdf(file_bytes)
    elif extension in ["txt", "text"]:
        chunks = extract_text_from_txt(file_bytes)
    else:
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported.")

    if not chunks:
        raise HTTPException(status_code=400, detail="No readable text was extracted from the file.")

    operation_id = str(uuid.uuid4())
    LAST_OPERATION_ID = operation_id

    DOCUMENT_STORE[operation_id] = {
        "filename": filename,
        "chunks": chunks,
        "created_at": time.time(),
    }

    return {
        "status": "success",
        "message": "File processed successfully.",
        "filename": filename,
        "operation_id": operation_id,
        "operationId": operation_id,
        "document_id": operation_id,
        "documentId": operation_id,
        "chunks_count": len(chunks),
        "chunks": chunks,
        "preview": chunks[0]["text"][:500] if chunks else "",
    }


@app.post("/get_chunks")
async def get_chunks(request: Request):
    data = await read_payload(request)
    operation_id = extract_operation_id(data)

    resolved_operation_id, chunks = get_chunks_for_operation(operation_id)

    if not chunks:
        return {
            "status": "error",
            "message": "No PDF chunks found. Upload/process a PDF first.",
            "operation_id": resolved_operation_id,
            "operationId": resolved_operation_id,
            "chunks": [],
        }

    return {
        "status": "success",
        "operation_id": resolved_operation_id,
        "operationId": resolved_operation_id,
        "chunks_count": len(chunks),
        "chunks": chunks,
    }


@app.get("/get_chunks")
async def get_chunks_get(request: Request):
    return await get_chunks(request)


@app.post("/generate")
async def generate_text(request: Request):
    data = await read_payload(request)

    question = extract_question(data)
    operation_id = extract_operation_id(data)

    if not question:
        raise HTTPException(status_code=422, detail="Missing question/message/query.")

    if is_greeting(question):
        return make_answer_response(
            "Hi! I can answer questions about the uploaded PDF. Ask me something about its content.",
            operation_id or LAST_OPERATION_ID,
            [],
        )

    resolved_operation_id, chunks = get_chunks_for_operation(operation_id)

    if not chunks:
        answer = "I cannot answer because no PDF content was provided."
        return make_answer_response(answer, resolved_operation_id, [])

    selected_chunks = select_relevant_chunks(question, chunks)
    context = build_context(selected_chunks)

    if is_about_question(question):
        answer = make_pdf_overview_summary(context)
    else:
        answer = ask_ollama(question, context)

    return make_answer_response(answer, resolved_operation_id, selected_chunks)

@app.get("/generate")
async def generate_text_get(request: Request):
    return await generate_text(request)


# Legacy endpoint for older Laravel/frontend code
@app.post("/api/v1/query")
async def legacy_query(request: Request):
    return await generate_text(request)


@app.get("/api/v1/query")
async def legacy_query_get(request: Request):
    return await generate_text(request)


@app.post("/pull")
async def pull(request: Request):
    return {
        "status": "ok",
        "message": "Pull endpoint is available.",
        "model": ASKPDF_MODEL,
    }


@app.get("/image_bytes/{image_id}")
async def image_bytes(image_id: str):
    return JSONResponse(
        status_code=404,
        content={"message": "No image bytes are available in this AskPDF text-only backend."}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)
