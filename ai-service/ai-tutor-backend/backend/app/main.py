from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Depends
from app.llm_utils import generate_quiz, generate_studyflow_quiz_from_text
import os
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from app.db import get_db, engine, Base
from sqlalchemy.orm import Session

from app.models import Document, Chapter
from pydantic import BaseModel
from typing import Optional
app = FastAPI()
@app.on_event("startup")
def create_tables():
    if engine is not None:
        Base.metadata.create_all(bind=engine)

_cors_origins = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
class StudyFlowQuizRequest(BaseModel):
    content: str
    title: Optional[str] = None
    quiz_type: str = "mcq"        # mcq | true_false | subjective
    difficulty: str = "Mixed"     # Mixed | Hard | Medium
    questions_count: int = 5


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ai-tutor-backend"
    }


@app.post("/studyflow/generate-quiz")
async def studyflow_generate_quiz(payload: StudyFlowQuizRequest):
    content = (payload.content or "").strip()

    if len(content) < 200:
        raise HTTPException(
            status_code=400,
            detail="Content is too short to generate good questions."
        )

    return generate_studyflow_quiz_from_text(
        original_content=content,
        quiz_type=payload.quiz_type,
        difficulty=payload.difficulty,
        questions_count=payload.questions_count,
    )

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


@app.post("/generate-quiz/")
async def generate_quiz_by_book_and_chapter(
        book: str = Query(...),
        chapter_number: int = Query(...),
        db: Session = Depends(get_db)
):
    document = db.query(Document).filter(Document.title == book).first()
    if not document:
        raise HTTPException(404, detail="Book not found")

    chapters = db.query(Chapter).filter(Chapter.document_id == document.id).all()
    if chapter_number < 1 or chapter_number > len(chapters):
        raise HTTPException(404, detail="Chapter not found")

    chapter = chapters[chapter_number - 1]  # 1-indexed
    return generate_quiz(chapter.id, db)

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)