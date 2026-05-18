"""Unit tests for app.crud"""
import pytest
from unittest.mock import MagicMock

from app.crud import (
    get_document_by_hash,
    get_document_id,
    get_chapter_by_id,
    save_document_and_chapters,
    save_questions_for_chapter,
)
from app.models import Document, Chapter, Question


def _make_mock_db():
    """Return a simple SQLAlchemy-session-like mock."""
    db = MagicMock()
    return db


# ---------------------------------------------------------------------------
# get_document_by_hash
# ---------------------------------------------------------------------------

def test_get_document_by_hash_found():
    db = _make_mock_db()
    doc = Document(id=1, document_hash="abc")
    db.query.return_value.filter.return_value.first.return_value = doc

    result = get_document_by_hash(db, "abc")
    assert result is doc


def test_get_document_by_hash_not_found():
    db = _make_mock_db()
    db.query.return_value.filter.return_value.first.return_value = None

    result = get_document_by_hash(db, "nonexistent")
    assert result is None


# ---------------------------------------------------------------------------
# get_document_id
# ---------------------------------------------------------------------------

def test_get_document_id_returns_id_when_found():
    db = _make_mock_db()
    doc = Document(id=42, document_hash="xyz")
    db.query.return_value.filter.return_value.first.return_value = doc

    assert get_document_id(db, "xyz") == 42


def test_get_document_id_returns_none_when_not_found():
    db = _make_mock_db()
    db.query.return_value.filter.return_value.first.return_value = None

    assert get_document_id(db, "missing") is None


# ---------------------------------------------------------------------------
# get_chapter_by_id
# ---------------------------------------------------------------------------

def test_get_chapter_by_id_found():
    db = _make_mock_db()
    chapter = Chapter(id=5)
    db.query.return_value.filter.return_value.first.return_value = chapter

    result = get_chapter_by_id(db, 5)
    assert result is chapter


def test_get_chapter_by_id_not_found():
    db = _make_mock_db()
    db.query.return_value.filter.return_value.first.return_value = None

    assert get_chapter_by_id(db, 99) is None


# ---------------------------------------------------------------------------
# save_document_and_chapters
# ---------------------------------------------------------------------------

def test_save_document_and_chapters_returns_doc_id():
    db = _make_mock_db()

    # Simulate db.refresh setting the id
    def fake_refresh(obj):
        obj.id = 7

    db.refresh.side_effect = fake_refresh

    doc_data = {
        "title": "Test Book",
        "author": "Test Author",
        "file_type": "pdf",
        "document_hash": "hash123",
        "meta": {},
        "chapters": [
            {"title": "Ch1", "content": "Content 1", "hash": "h1"},
            {"title": "Ch2", "content": "Content 2", "hash": "h2"},
        ],
    }

    result = save_document_and_chapters(db, doc_data)
    assert result == 7
    assert db.add.call_count == 3  # 1 doc + 2 chapters
    assert db.commit.call_count == 2


# ---------------------------------------------------------------------------
# save_questions_for_chapter
# ---------------------------------------------------------------------------

def test_save_questions_for_chapter():
    db = _make_mock_db()

    questions = [
        {"type": "mcq", "question": "Q1?", "answer": "A1", "options": ["A1", "A2"]},
        {"type": "subjective", "question": "Q2?", "answer": "A2"},
    ]

    save_questions_for_chapter(db, chapter_id=3, questions=questions)

    assert db.add.call_count == 2
    db.commit.assert_called_once()
