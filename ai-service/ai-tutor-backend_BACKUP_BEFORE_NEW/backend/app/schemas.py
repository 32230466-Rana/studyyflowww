from pydantic import BaseModel
from typing import List, Optional

class ChapterSchema(BaseModel):
    title: str
    content: str
    chapter_hash: Optional[str] = None

class DocumentUploadResponse(BaseModel):
    status: str
    document_id: Optional[int] = None
    chapters: Optional[List[ChapterSchema]] = None

class QuestionSchema(BaseModel):
    question_text: str
    answer_text: str
    question_type: str
    difficulty: Optional[str] = "medium"
    options: Optional[List[str]] = None

class QuizResponse(BaseModel):
    chapter_id: int
    questions: List[QuestionSchema]