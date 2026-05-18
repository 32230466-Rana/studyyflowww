import json
import re
import tempfile
from pathlib import Path

import requests
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Depends
from app.file_utils import process_file
from pydantic import BaseModel
from app.tf_quiz_from_prompt import generate_true_false_quiz
from app.fill_blank import generate_fill_blank_quiz
from app.llm_utils import generate_quiz
from app.crud import save_document_and_chapters
import os
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from app.db import get_db
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from app.models import Document, Chapter

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


def _clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_pdf_text(raw_bytes: bytes) -> str:
    if PdfReader is None:
        raise HTTPException(status_code=500, detail="PDF reader is not installed. Run: pip install pypdf PyPDF2")

    import io

    reader = PdfReader(io.BytesIO(raw_bytes))
    pages = []

    for index, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        if page_text.strip():
            pages.append(f"\n[Page {index}]\n{page_text}")

    return _clean_text("\n".join(pages))


def _chunk_text(text: str, max_chars: int = 1200) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n", text) if paragraph.strip()]

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


def _tokenize(text: str) -> set:
    words = re.findall(r"[A-Za-z\u0600-\u06FF0-9]{3,}", text.lower())
    stop = {
        "the", "and", "for", "are", "you", "that", "this", "with", "from",
        "what", "how", "why", "when", "where", "who", "which", "into",
        "about", "does", "did", "can", "could", "would", "should",
    }
    return {word for word in words if word not in stop}


def _select_context_chunks(question: str, chunks: list[str], top_k: int = 5) -> list[str]:
    question_terms = _tokenize(question)
    scored = []

    for chunk in chunks:
        chunk_terms = _tokenize(chunk)
        overlap = len(question_terms.intersection(chunk_terms))
        score = overlap * 3 + (1 if len(chunk.strip()) > 80 else 0)

        scored.append((score, chunk))

    scored.sort(key=lambda item: item[0], reverse=True)

    selected = [chunk for score, chunk in scored[:top_k] if score > 0]

    if not selected:
        selected = [chunk for chunk in chunks[:top_k] if chunk.strip()]

    return selected


def _call_ollama(prompt: str, temperature: float = 0.2, num_predict: int = 1200) -> str:
    response = requests.post(
        f"{OLLAMA_HOST}/api/generate",
        json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": num_predict,
            },
        },
        timeout=600,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Ollama error: {response.text}")

    data = response.json()
    answer = (data.get("response") or "").strip()

    if not answer:
        raise HTTPException(status_code=502, detail="Ollama returned empty answer.")

    return answer


def _extract_json_object(text: str) -> dict | None:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)

    start = text.find("{")
    end = text.rfind("}")

    if start < 0 or end < 0 or end <= start:
        return None

    try:
        payload = json.loads(text[start : end + 1])
    except Exception:
        return None

    return payload if isinstance(payload, dict) else None


def _normalize_mcq_questions(payload: dict | None, count: int) -> list[dict]:
    if not isinstance(payload, dict):
        return []

    questions = payload.get("questions")
    if not isinstance(questions, list):
        return []

    normalized = []

    for index, item in enumerate(questions):
        if not isinstance(item, dict):
            continue

        question_text = str(item.get("question") or "").strip()
        explanation = str(item.get("explanation") or "").strip()
        difficulty = str(item.get("difficulty") or "").strip().lower() or ("hard" if index < 3 else "medium")
        options = item.get("options") or {}

        if isinstance(options, list):
            letters = ["A", "B", "C", "D"]
            options = {letters[i]: str(value).strip() for i, value in enumerate(options[:4])}

        if not isinstance(options, dict):
            continue

        normalized_options = {
            "A": str(options.get("A") or options.get("a") or "").strip(),
            "B": str(options.get("B") or options.get("b") or "").strip(),
            "C": str(options.get("C") or options.get("c") or "").strip(),
            "D": str(options.get("D") or options.get("d") or "").strip(),
        }

        if any(not value for value in normalized_options.values()):
            continue

        correct_answer = str(item.get("correct_answer") or item.get("answer") or "").strip().upper()
        if correct_answer not in {"A", "B", "C", "D"}:
            continue

        if not question_text or not explanation:
            continue

        normalized.append(
            {
                "question": question_text,
                "difficulty": difficulty if difficulty in {"hard", "medium", "easy"} else ("hard" if index < 3 else "medium"),
                "options": normalized_options,
                "correct_answer": correct_answer,
                "explanation": explanation,
            }
        )

        if len(normalized) >= count:
            break

    return normalized


def _build_mcq_prompt(context: str, title: str, requested_question: str | None = None) -> str:
    focus_line = f"User request: {requested_question.strip()}\n" if requested_question and requested_question.strip() else ""

    return f"""
You are a strict local study assistant creating multiple-choice questions from PDF content only.

Rules:
- Use ONLY the source context below.
- Do not add outside knowledge.
- Generate exactly 5 MCQ questions.
- Questions 1, 2, and 3 must be HARD.
- Questions 4 and 5 must be MEDIUM.
- Each question must have exactly 4 options: A, B, C, D.
- Each question must have exactly 1 correct answer.
- Each question must have a short explanation grounded in the source context.
- If the PDF shows an idea in a diagram but does not spell it out in text, you may infer it and say so briefly in the explanation.
- Return only valid JSON.
- Do not wrap the JSON in code fences.

Return exactly this schema:
{{
  "questions": [
    {{
      "question": "string",
      "difficulty": "hard",
      "options": {{
        "A": "string",
        "B": "string",
        "C": "string",
        "D": "string"
      }},
      "correct_answer": "A",
      "explanation": "string"
    }}
  ]
}}

Source title:
{title}

{focus_line}Source context:
{context}
""".strip()


def _generate_mcq_from_pdf(raw_bytes: bytes, title: str | None = None, question: str | None = None) -> dict:
    text = _extract_pdf_text(raw_bytes)

    if len(text.strip()) < 20:
        raise HTTPException(status_code=422, detail="Could not extract enough readable text from this PDF.")

    chunks = _chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=422, detail="Could not split the PDF into usable chunks.")

    context_chunks = _select_context_chunks(question or "generate quiz from the document", chunks, top_k=5)
    context = "\n\n---\n\n".join(context_chunks)
    prompt = _build_mcq_prompt(context, title or "Uploaded PDF", question)

    raw = _call_ollama(prompt, temperature=0.15, num_predict=1600)
    payload = _extract_json_object(raw)
    questions = _normalize_mcq_questions(payload, 5)

    if len(questions) < 5:
        prompt = _build_mcq_prompt(context, title or "Uploaded PDF", question)
        raw = _call_ollama(prompt, temperature=0.0, num_predict=1800)
        payload = _extract_json_object(raw)
        questions = _normalize_mcq_questions(payload, 5)

    if len(questions) < 5:
        raise HTTPException(status_code=502, detail="Quiz generation failed to produce 5 valid MCQs.")

    return {
        "success": True,
        "type": "multiple_choice",
        "difficulty": "mixed",
        "questions": questions[:5],
        "total_questions": 5,
        "topic": title or "Uploaded PDF",
    }


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

    if quiz_type.lower() == "mcq":
        return _generate_mcq_from_pdf(raw_bytes, title=title or Path(document.filename).stem, question=question)

    if quiz_type.lower() in {"true_false", "fill_blank", "fill_in_blank"}:
        text = _extract_pdf_text(raw_bytes)

        if len(text.strip()) < 20:
            raise HTTPException(status_code=422, detail="Could not extract enough readable text from this PDF.")

        if quiz_type.lower() == "true_false":
            return {
                "success": True,
                "type": "true_false",
                "questions": generate_true_false_quiz(text),
                "total_questions": 5,
                "difficulty": difficulty,
            }

        return {
            "success": True,
            "type": "fill_blank",
            "questions": generate_fill_blank_quiz(text),
            "total_questions": 5,
            "difficulty": difficulty,
        }

    return _generate_mcq_from_pdf(raw_bytes, title=title or Path(document.filename).stem, question=question)


@app.post("/upload/")
async def upload_file(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith((".pdf", ".docx")):
        raise HTTPException(status_code=400, detail="Invalid file type")

    document_data = await process_file(file, db)

    if document_data["already_exists"]:
        return {
            "status": "existing",
            "book": document_data["title"],
            "document_id": document_data["document_id"],
            "chapters": document_data["chapters"],
        }

    doc_id = save_document_and_chapters(db, document_data)

    return {
        "status": "processed",
        "book": document_data["title"],
        "document_id": doc_id,
        "chapters": document_data["chapters"],
    }


class TrueFalseQuizRequest(BaseModel):
    text: str


class FillBlankQuizRequest(BaseModel):
    text: str


def get_chapter_text_by_book_and_number(book: str, chapter_number: int, db: Session) -> str:
    document = db.query(Document).filter(Document.title == book).first()

    if not document:
        raise HTTPException(status_code=404, detail="Book not found")

    chapters = db.query(Chapter).filter(Chapter.document_id == document.id).all()

    if chapter_number < 1 or chapter_number > len(chapters):
        raise HTTPException(status_code=404, detail="Chapter not found")

    chapter = chapters[chapter_number - 1]

    chapter_text = (
        getattr(chapter, "content", None)
        or getattr(chapter, "text", None)
        or getattr(chapter, "body", None)
        or getattr(chapter, "chapter_text", None)
        or ""
    )

    if not chapter_text:
        raise HTTPException(
            status_code=400,
            detail="Chapter text is empty or not found. Check the Chapter model field name.",
        )

    return chapter_text


# ============================================================
# True / False endpoints
# ============================================================

@app.post("/api/quiz/true-false")
def create_true_false_quiz(payload: TrueFalseQuizRequest):
    return generate_true_false_quiz(payload.text)


@app.post("/api/quiz/true-false/chapter")
def create_true_false_quiz_by_chapter(
    book: str = Query(...),
    chapter_number: int = Query(...),
    db: Session = Depends(get_db),
):
    chapter_text = get_chapter_text_by_book_and_number(book, chapter_number, db)
    return generate_true_false_quiz(chapter_text)


# ============================================================
# Fill in the Blank endpoints
# ============================================================

@app.post("/api/quiz/fill-blank")
def create_fill_blank_quiz(payload: FillBlankQuizRequest):
    return generate_fill_blank_quiz(payload.text)


@app.post("/api/quiz/fill-blank/chapter")
def create_fill_blank_quiz_by_chapter(
    book: str = Query(...),
    chapter_number: int = Query(...),
    db: Session = Depends(get_db),
):
    chapter_text = get_chapter_text_by_book_and_number(book, chapter_number, db)
    return generate_fill_blank_quiz(chapter_text)


# Optional aliases, so frontend can call any naming style safely
@app.post("/api/quiz/fill-in-blank")
def create_fill_in_blank_quiz(payload: FillBlankQuizRequest):
    return generate_fill_blank_quiz(payload.text)


@app.post("/api/quiz/fill-in-blank/chapter")
def create_fill_in_blank_quiz_by_chapter(
    book: str = Query(...),
    chapter_number: int = Query(...),
    db: Session = Depends(get_db),
):
    chapter_text = get_chapter_text_by_book_and_number(book, chapter_number, db)
    return generate_fill_blank_quiz(chapter_text)


# ============================================================
# Existing MCQ endpoint
# ============================================================

@app.post("/generate-quiz/")
async def generate_quiz_by_book_and_chapter(
    book: str = Query(...),
    chapter_number: int = Query(...),
    db: Session = Depends(get_db),
):
    document = db.query(Document).filter(Document.title == book).first()

    if not document:
        raise HTTPException(404, detail="Book not found")

    chapters = db.query(Chapter).filter(Chapter.document_id == document.id).all()

    if chapter_number < 1 or chapter_number > len(chapters):
        raise HTTPException(404, detail="Chapter not found")

    chapter = chapters[chapter_number - 1]

    return generate_quiz(chapter.id, db)


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
