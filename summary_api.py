from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import requests
import time
import os

app = FastAPI(title="StudyFlow Fast Summary API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:1.7b")


def clean_text(text: str) -> str:
    text = text or ""
    text = text.replace("\x00", " ")
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    return "\n".join(lines).strip()


def extract_text_from_pdf_bytes(file_bytes: bytes) -> str:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="PyMuPDF is not installed. Run: pip install pymupdf"
        )

    text_parts = []

    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        for page in doc:
            page_text = page.get_text("text")
            if page_text:
                text_parts.append(page_text)

    return clean_text("\n\n".join(text_parts))


def summarize_with_ollama(text: str) -> str:
    text = clean_text(text)

    if not text:
        return "Could not extract or find text to summarize."

    text = text[:12000]

    prompt = f"""
You are an academic study assistant.

Summarize the following study material clearly and naturally.

Rules:
- Do not copy long sentences from the source.
- Do not invent information.
- Focus on the main ideas.
- Write in a student-friendly academic style.
- Keep the summary concise but useful.

STUDY MATERIAL:
{text}

SUMMARY:
""".strip()

    response = requests.post(
        OLLAMA_URL,
        json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
                "num_predict": 350
            }
        },
        timeout=180
    )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama failed: {response.text}"
        )

    data = response.json()
    summary = clean_text(data.get("response", ""))

    if not summary:
        return "Summary service returned an empty result."

    return summary


@app.post("/summarize")
async def summarize(request: Request):
    start_time = time.time()

    text = ""
    filename = None

    content_type = request.headers.get("content-type", "")

    # Case 1: JSON request from test or Laravel text note
    if "application/json" in content_type:
        data = await request.json()
        text = (
            data.get("text")
            or data.get("human_input")
            or data.get("content")
            or ""
        )

    # Case 2: File upload from Laravel PDF note
    elif "multipart/form-data" in content_type:
        form = await request.form()
        uploaded_file = form.get("file")

        if uploaded_file:
            filename = uploaded_file.filename
            file_bytes = await uploaded_file.read()

            if filename and filename.lower().endswith(".pdf"):
                text = extract_text_from_pdf_bytes(file_bytes)
            else:
                try:
                    text = file_bytes.decode("utf-8", errors="ignore")
                except Exception:
                    text = ""

        if not text:
            text = form.get("text") or form.get("human_input") or ""

    # Case 3: Raw body fallback
    else:
        body = await request.body()
        text = body.decode("utf-8", errors="ignore")

    text = clean_text(text)
    summary = summarize_with_ollama(text)

    processing_time = round(time.time() - start_time, 2)

    return {
        "summary": summary,
        "filename": filename,
        "processing_time_seconds": processing_time,
        "processing_time_minutes": round(processing_time / 60, 2)
    }


@app.get("/")
def root():
    return {
        "status": "ok",
        "service": "StudyFlow Summary API",
        "endpoint": "/summarize"
    }