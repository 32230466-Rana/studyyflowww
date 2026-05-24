"""RAG query endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import uuid
import re

from ..dependencies import get_db, get_rag_service
from ..models import QueryRequest, QueryResponse, SourceInfo
from ..services.rag_service import RAGService

router = APIRouter(prefix="/api/v1", tags=["query"])


def build_safe_mcq_prompt(user_question: str) -> str:
    q = user_question or ""

    is_quiz_request = any(
        word in q.lower()
        for word in ["mcq", "quiz", "generate exactly", "correct answer", "questions"]
    )

    if not is_quiz_request:
        return q

    focus_match = re.search(r"(?im)^\s*-?\s*Focus topic:\s*(.+)$", q)
    focus_line = f"\n- Focus topic: {focus_match.group(1).strip()}" if focus_match else ""

    return f"""
Return ONLY valid JSON. No markdown. No extra text.

JSON format:
{{
  "questions": [
    {{
      "question": "Full question text here",
      "options": {{
        "A": "short option",
        "B": "short option",
        "C": "short option",
        "D": "short option"
      }},
      "correctAnswer": "A",
      "explanation": "short explanation from the PDF"
    }}
  ]
}}

Rules:
- Generate exactly 5 MCQs.
- Use only the uploaded PDF content.
- Every question field must contain a real question.
- Never return answers without questions.
- Never reveal answers inside the question text.
- correctAnswer must be one letter only.
- Options must be short.
- No All of the above.
- No None of the above.
- Do not show Hard/Medium labels in the visible question text.{focus_line}
""".strip()


def normalize_mcq_answer_text(answer: str) -> str:
    """
    Small safety cleanup for model answers:
    - keeps "Correct answer: A" style
    - removes common weird answer formats
    """
    text = answer or ""

    text = re.sub(
        r"Correct\s*answer\s*:\s*([A-Da-d])[\.\)]?\s*[^\n]*",
        lambda m: f"Correct answer: {m.group(1).upper()}",
        text,
        flags=re.IGNORECASE,
    )

    text = text.replace("All of the above", "")
    text = text.replace("None of the above", "")
    text = text.replace("Both A and B", "")

    return text.strip()


@router.post("/query", response_model=QueryResponse)
def query_pdfs(
    request: QueryRequest,
    db: Session = Depends(get_db),
    rag_service: RAGService = Depends(get_rag_service)
):
    """Query across PDFs with source attribution."""
    import logging
    logger = logging.getLogger(__name__)

    safe_question = build_safe_mcq_prompt(request.question)

    logger.info(
        f"📥 Received query request: question='{request.question[:50]}...', model={request.model}"
    )

    session_id = request.session_id or str(uuid.uuid4())
    logger.info(f"🔑 Session ID: {session_id}")

    rag_service.save_message(
        session_id=session_id,
        role="user",
        content=request.question,
        sources=None,
        db=db
    )
    logger.info("💾 User message saved")

    logger.info("🚀 Starting RAG query...")
    try:
        answer, sources, reasoning_steps = rag_service.query_multi_pdf(
            question=safe_question,
            model=request.model,
            pdf_ids=request.pdf_ids,
            db=db
        )

        answer = normalize_mcq_answer_text(answer)

        logger.info(
            f"✅ RAG query complete: answer_length={len(answer)}, "
            f"sources_count={len(sources)}, reasoning_steps={len(reasoning_steps)}"
        )

    except Exception as e:
        error_msg = str(e)
        if "not found" in error_msg.lower() and "404" in error_msg:
            logger.error(f"❌ Model not found: {request.model}")
            raise HTTPException(
                status_code=404,
                detail=f"Model '{request.model}' not found. Please select a different model or install it with: ollama pull {request.model}"
            )

        logger.error(f"❌ Query failed: {error_msg}")
        raise HTTPException(status_code=500, detail=f"Query failed: {error_msg}")

    message = rag_service.save_message(
        session_id=session_id,
        role="assistant",
        content=answer,
        sources=sources,
        db=db
    )
    logger.info(f"💾 Assistant message saved with ID: {message.message_id}")

    response = QueryResponse(
        answer=answer,
        sources=[SourceInfo(**s) for s in sources],
        metadata={
            "model_used": request.model,
            "chunks_retrieved": len(sources),
            "pdfs_queried": len(set(s["pdf_id"] for s in sources)) if sources else 0,
            "reasoning_steps": reasoning_steps,
            "mcq_safety_prompt": True
        },
        session_id=session_id,
        message_id=message.message_id
    )

    logger.info(
        f"📤 Returning response: answer_length={len(response.answer)}, sources={len(response.sources)}"
    )
    logger.info(f"📊 First 200 chars of answer: {response.answer[:200]}")

    return response


@router.get("/sessions/{session_id}/messages")
def get_session_messages(
    session_id: str,
    db: Session = Depends(get_db),
    rag_service: RAGService = Depends(get_rag_service)
):
    """Get chat history for a session."""
    messages = rag_service.get_session_messages(session_id, db)
    return [
        {
            "message_id": msg.message_id,
            "role": msg.role,
            "content": msg.content,
            "sources": msg.sources,
            "timestamp": msg.timestamp
        }
        for msg in messages
    ]
