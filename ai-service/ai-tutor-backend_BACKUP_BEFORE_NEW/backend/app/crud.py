from sqlalchemy.orm import Session
from app.models import Document, Chapter, Question
from typing import Optional

def get_document_by_hash(db: Session, doc_hash: str):
    return db.query(Document).filter(Document.document_hash == doc_hash).first() # type: ignore

def get_document_id(db: Session, doc_hash: str):
    doc = get_document_by_hash(db, doc_hash)
    return doc.id if doc else None

def get_chapter_by_id(db: Session, chapter_id: int) -> Optional[Chapter]:
    return db.query(Chapter).filter(Chapter.id == chapter_id).first() # type: ignore

def document_exists_in_db(db: Session, title: str, author: Optional[str] = None) -> Optional[Document]:
    query = db.query(Document).filter(Document.title == title) # type: ignore
    if author:
        query = query.filter(Document.author == author)
    return query.first()

def save_document_and_chapters(db: Session, doc_data: dict):
    doc = Document(
        title=doc_data["title"],
        author=doc_data.get("author"),
        file_type=doc_data.get("file_type"),
        document_hash=doc_data["document_hash"],
        meta=doc_data.get("meta", {})
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    for ch in doc_data["chapters"]:
        chapter = Chapter(
            document_id=doc.id,
            chapter_title=ch["title"],
            content=ch["content"],
            chapter_hash=ch["hash"]
        )
        db.add(chapter)
    db.commit()
    return doc.id

def save_questions_for_chapter(db: Session, chapter_id: int, questions: list[dict]):
    for q in questions:
        question_text = q.get("question")  # matches LLM output
        answer_text = q.get("answer", "")
        question_type = q.get("type", "unknown")
        options = q.get("options") if question_type == "mcq" else None

        db_question = Question(
            chapter_id=chapter_id,
            question_text=question_text,
            answer_text=answer_text,
            question_type=question_type,
            difficulty="medium",  # or derive if present
            options=options
        )
        db.add(db_question)
    db.commit()
