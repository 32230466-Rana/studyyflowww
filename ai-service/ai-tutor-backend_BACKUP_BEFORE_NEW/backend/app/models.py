from sqlalchemy import Column, Integer, String, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.db import Base

class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255))
    author = Column(String(255))
    file_type = Column(String(255))
    document_hash = Column(String(255), unique=True)
    meta = Column(JSON)  # âœ… renamed from 'metadata' to 'meta'
    chapters = relationship("Chapter", back_populates="document")

class Chapter(Base):
    __tablename__ = "chapters"
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    chapter_title = Column(String(255))
    content = Column(Text)
    chapter_hash = Column(String(255), unique=True)
    document = relationship("Document", back_populates="chapters")
    questions = relationship("Question", back_populates="chapter")

class Question(Base):
    __tablename__ = "questions"
    id = Column(Integer, primary_key=True)
    chapter_id = Column(Integer, ForeignKey("chapters.id"))
    question_text = Column(Text)
    answer_text = Column(Text)
    question_type = Column(String(255))
    difficulty = Column(String(255))
    options = Column(JSON)
    chapter = relationship("Chapter", back_populates="questions")

