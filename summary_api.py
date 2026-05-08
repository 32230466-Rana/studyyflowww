from fastapi import FastAPI, Request, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
import time
import os
import re

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


class ConversationInput(BaseModel):
    human_input: str


@app.post("/conversation")
async def conversation(input_data: ConversationInput):
    """
    Compatibility endpoint for direct text summarization.
    """
    text = clean_text(input_data.human_input)
    summary = summarize_with_ollama(text)

    return {
        "output": summary,
        "status": "success"
    }


@app.post("/file/upload")
async def file_upload(pdf_file: UploadFile = File(...)):
    """
    Compatibility endpoint for file uploads.
    """
    filename = pdf_file.filename
    file_bytes = await pdf_file.read()

    if filename and filename.lower().endswith(".pdf"):
        text = extract_text_from_pdf_bytes(file_bytes)
    else:
        try:
            text = file_bytes.decode("utf-8", errors="ignore")
        except Exception:
            text = ""

    text = clean_text(text)
    summary = summarize_with_ollama(text)

    return {
        "summary": summary,
        "filename": filename,
        "status": "success"
    }


def clean_text(text: str) -> str:
    text = text or ""
    text = text.replace("\x00", " ")
    # Remove excessive symbols and repetitive markers common in PDFs
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\xff]', '', text)
    text = re.sub(r'\s+', ' ', text)
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
        print("--- DEBUG: EMPTY TEXT RECEIVED ---")
        return "Could not extract or find text to summarize."

    # Optimization: Reduce text size to 5000 chars and increase timeout
    text = text[:5000]

    prompt = f"""
Summarize the following study material briefly.
Focus on key concepts and main ideas.

STUDY MATERIAL:
{text}

SUMMARY:
""".strip()

    print(f"--- DEBUG: SENDING TO OLLAMA ---")
    print(f"URL: {OLLAMA_URL}")
    print(f"Model: {OLLAMA_MODEL}")
    print(f"Text Length: {len(text)}")

    try:
        response = requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                # Removed options that might force 'thinking' or length issues
            },
            timeout=240
        )
    except requests.exceptions.Timeout:
        print("--- DEBUG: OLLAMA TIMEOUT ---")
        return "The summary service timed out. The document might be too complex for the current model. Please try a shorter selection."
    except Exception as e:
        print(f"--- DEBUG: OLLAMA ERROR: {str(e)} ---")
        return f"An error occurred: {str(e)}"

    print(f"--- DEBUG: OLLAMA STATUS: {response.status_code} ---")

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama failed: {response.text}"
        )

    data = response.json()
    
    # Logic to handle both 'response' and 'thinking' if available
    raw_response = data.get("response", "")
    thinking = data.get("thinking", "")
    
    if not raw_response.strip() and thinking.strip():
        print("--- DEBUG: MODEL RETURNED THINKING BUT NO RESPONSE ---")
        # Use thinking as fallback if response is empty
        summary = clean_text(thinking)
    else:
        summary = clean_text(raw_response)

    print(f"--- DEBUG: OLLAMA REQUEST ---")
    print(f"Model: {OLLAMA_MODEL}")
    print(f"Prompt Length: {len(prompt)}")
    print(f"--- DEBUG: OLLAMA RESPONSE ---")
    print(f"Summary Length: {len(summary)}")

    if not summary:
        return f"Summary service returned an empty result. Data keys: {list(data.keys())}"

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