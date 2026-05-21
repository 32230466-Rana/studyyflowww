"""RAG query service - optimized for large PDFs."""
from typing import List, Dict, Tuple, Optional
from sqlalchemy.orm import Session
from datetime import datetime
import re

from langchain_ollama import ChatOllama, OllamaEmbeddings

try:
    from langchain_chroma import Chroma
except ImportError:
    from langchain_community.vectorstores import Chroma

from ..database import PDFMetadata, ChatSession, ChatMessage
from ..config import settings


class RAGService:
    """Service for fast RAG operations."""

    def __init__(self):
        self.persist_directory = settings.VECTOR_DB_DIR

    def query_multi_pdf(
        self,
        question: str,
        model: str,
        pdf_ids: Optional[List[str]],
        db: Session,
    ) -> Tuple[str, List[Dict], List[str]]:
        reasoning_steps = []

        query = db.query(PDFMetadata)
        if pdf_ids:
            query = query.filter(PDFMetadata.pdf_id.in_(pdf_ids))

        pdfs = query.all()

        if not pdfs:
            return "No PDFs found to query.", [], []

        reasoning_steps.append(
            f"📚 Searching across {len(pdfs)} PDF(s): {', '.join([p.name for p in pdfs])}"
        )

        llm = ChatOllama(
            model=model,
            temperature=0.1,
        )

        reasoning_steps.append(f"🤖 Using model: {model}")

        embeddings = OllamaEmbeddings(model="nomic-embed-text")

        all_docs = []
        seen_chunks = set()

        for pdf in pdfs:
            try:
                vector_db = Chroma(
                    persist_directory=self.persist_directory,
                    embedding_function=embeddings,
                    collection_name=pdf.collection_name,
                )

                reasoning_steps.append(f"📄 Fast retrieving from: {pdf.name}")

                docs = vector_db.similarity_search(
                    question,
                    k=5,
                )

                clean_docs = []

                for doc in docs:
                    if "pdf_name" not in doc.metadata:
                        doc.metadata["pdf_name"] = pdf.name

                    if "pdf_id" not in doc.metadata:
                        doc.metadata["pdf_id"] = pdf.pdf_id

                    chunk_key = (
                        doc.metadata.get("pdf_id"),
                        doc.metadata.get("chunk_index"),
                        doc.page_content[:120],
                    )

                    if chunk_key in seen_chunks:
                        continue

                    seen_chunks.add(chunk_key)
                    clean_docs.append(doc)

                all_docs.extend(clean_docs)
                reasoning_steps.append(
                    f"✅ Found {len(clean_docs)} relevant chunks in {pdf.name}"
                )

            except Exception as e:
                reasoning_steps.append(f"⚠️ Error retrieving from {pdf.name}: {str(e)}")
                print(f"Error retrieving from {pdf.name}: {e}")

        if not all_docs:
            return (
                "I could not retrieve relevant PDF chunks. Try uploading the PDF again.",
                [],
                reasoning_steps,
            )

        reasoning_steps.append(f"📊 Total chunks retrieved: {len(all_docs)}")

        MAX_CONTEXT_CHARS = 6500
        MAX_DOCS_FOR_CONTEXT = 6

        context_parts = []
        used_chars = 0

        for doc in all_docs[:MAX_DOCS_FOR_CONTEXT]:
            source = doc.metadata.get("pdf_name", "Unknown")
            text = (doc.page_content or "").strip()

            if not text:
                continue

            remaining = MAX_CONTEXT_CHARS - used_chars

            if remaining <= 0:
                break

            text = text[:remaining]
            used_chars += len(text)

            context_parts.append(f"[Source: {source}]\n{text}\n")

        formatted_context = "\n---\n".join(context_parts)

        reasoning_steps.append(
            f"🔗 Using top {min(len(all_docs), MAX_DOCS_FOR_CONTEXT)} chunks "
            f"with max {MAX_CONTEXT_CHARS} context chars"
        )

        sources = [
            {
                "pdf_name": doc.metadata.get("pdf_name"),
                "pdf_id": doc.metadata.get("pdf_id"),
                "chunk_index": doc.metadata.get("chunk_index", 0),
            }
            for doc in all_docs[:MAX_DOCS_FOR_CONTEXT]
        ]

        mcq_keywords = [
            "generate exactly 5 mcqs",
            "generate exactly 5 multiple-choice",
            "multiple-choice questions",
            "multiple choice questions",
            "mcq",
            "a, b, c, d",
            "correct answer",
        ]

        is_mcq_request = any(
            keyword in (question or "").lower() for keyword in mcq_keywords
        )

        if is_mcq_request:
            reasoning_steps.append("🧪 Fast strict MCQ generation mode enabled")

            def mcq_is_valid(text: str) -> bool:
                text = (text or "").strip()

                blocks = re.split(
                    r"\n(?=Q\d+\s*(?:\((?:Hard|Medium|Easy)\))?\s*:)",
                    text,
                    flags=re.IGNORECASE,
                )

                blocks = [
                    block.strip()
                    for block in blocks
                    if re.match(
                        r"^Q\d+\s*(?:\([^)]+\))?\s*:",
                        block.strip(),
                        re.IGNORECASE,
                    )
                ]

                if len(blocks) != 5:
                    return False

                for block in blocks:
                    question_match = re.search(
                        r"^Q\d+\s*(?:\([^)]+\))?\s*:\s*(.+?)\n\s*A\.",
                        block,
                        flags=re.IGNORECASE | re.DOTALL,
                    )

                    if not question_match:
                        return False

                    if len(question_match.group(1).strip()) < 10:
                        return False

                    options = re.findall(
                        r"^\s*([A-D])\.\s*(.+?)\s*$",
                        block,
                        flags=re.MULTILINE,
                    )

                    if len(options) != 4:
                        return False

                    letters = [letter.upper() for letter, _ in options]

                    if letters != ["A", "B", "C", "D"]:
                        return False

                    for _, option_text in options:
                        cleaned_option = option_text.strip()

                        if len(cleaned_option) < 3:
                            return False

                        if cleaned_option.lower() in {
                            "all of the above",
                            "none of the above",
                            "both a and b",
                            "both b and c",
                        }:
                            return False

                    answer_match = re.search(
                        r"Correct answer\s*:\s*([A-D])\b",
                        block,
                        flags=re.IGNORECASE,
                    )

                    if not answer_match:
                        return False

                return True

            strict_mcq_prompt = f"""
You are a strict exam MCQ generator.

Use ONLY the PDF context below.
Do not use outside knowledge.
Do not explain your steps.

PDF CONTEXT:
{formatted_context}

TASK:
Generate exactly 5 multiple-choice questions from the PDF context.

STRICT RULES:
- Generate exactly 5 questions.
- Difficulty must be exactly: 3 Hard + 2 Medium.
- Every question MUST have four options: A, B, C, D.
- A, B, C, and D must NEVER be empty.
- Each option must be meaningful.
- Wrong options must be plausible and related to the PDF.
- Correct answer must be ONE letter only: A, B, C, or D.
- Do NOT use All of the above.
- Do NOT use None of the above.
- Do NOT use Both A and B.
- Keep options short.
- Avoid headings and copied long sentences.
- Add a short explanation for each answer.
- Output ONLY the quiz.

FORMAT EXACTLY:

Q1 (Hard): question text
A. option text
B. option text
C. option text
D. option text
Correct answer: A
Explanation: short explanation

Q2 (Hard): question text
A. option text
B. option text
C. option text
D. option text
Correct answer: B
Explanation: short explanation

Q3 (Hard): question text
A. option text
B. option text
C. option text
D. option text
Correct answer: C
Explanation: short explanation

Q4 (Medium): question text
A. option text
B. option text
C. option text
D. option text
Correct answer: D
Explanation: short explanation

Q5 (Medium): question text
A. option text
B. option text
C. option text
D. option text
Correct answer: A
Explanation: short explanation
""".strip()

            response = llm.invoke(strict_mcq_prompt)
            response = response.content if hasattr(response, "content") else str(response)

            if not mcq_is_valid(response):
                reasoning_steps.append("⚠️ First MCQ output invalid. Retrying once.")

                retry_prompt = f"""
The previous output was invalid.

Regenerate from scratch using ONLY this PDF context:
{formatted_context}

Generate exactly 5 MCQs.
Use exactly 3 Hard and 2 Medium.
Every question must have A, B, C, D.
No empty options.
Correct answer must be one letter only.
Output only the quiz.

Required format:
Q1 (Hard): question text
A. option text
B. option text
C. option text
D. option text
Correct answer: A
Explanation: short explanation

Q2 (Hard): question text
A. option text
B. option text
C. option text
D. option text
Correct answer: B
Explanation: short explanation

Q3 (Hard): question text
A. option text
B. option text
C. option text
D. option text
Correct answer: C
Explanation: short explanation

Q4 (Medium): question text
A. option text
B. option text
C. option text
D. option text
Correct answer: D
Explanation: short explanation

Q5 (Medium): question text
A. option text
B. option text
C. option text
D. option text
Correct answer: A
Explanation: short explanation
""".strip()

                response = llm.invoke(retry_prompt)
                response = response.content if hasattr(response, "content") else str(response)

            if not mcq_is_valid(response):
                reasoning_steps.append("❌ Strict MCQ validation failed after retry.")
                response = (
                    "The local model generated incomplete MCQs. "
                    "Please click Generate again or use a stronger local model. "
                    "No invalid quiz was accepted."
                )
            else:
                reasoning_steps.append("✅ Strict MCQ quiz generated and validated")

            return response, sources, reasoning_steps

        general_prompt = f"""
Use ONLY the PDF context below.

Do not use outside knowledge.
Do not explain your internal reasoning.
Answer clearly and directly.
Mention the source document name when helpful.

Context:
{formatted_context}

Question:
{question}

Answer:
""".strip()

        reasoning_steps.append("💭 Generating fast RAG answer...")

        response = llm.invoke(general_prompt)
        response = response.content if hasattr(response, "content") else str(response)

        reasoning_steps.append("✨ Answer generated successfully!")

        return response, sources, reasoning_steps

    def save_message(
        self,
        session_id: str,
        role: str,
        content: str,
        sources: Optional[List[Dict]],
        db: Session,
    ) -> ChatMessage:
        session = db.query(ChatSession).filter(
            ChatSession.session_id == session_id
        ).first()

        if not session:
            session = ChatSession(
                session_id=session_id,
                created_at=datetime.now(),
                last_active=datetime.now(),
            )
            db.add(session)
        else:
            session.last_active = datetime.now()

        message = ChatMessage(
            session_id=session_id,
            role=role,
            content=content,
            sources=sources,
            timestamp=datetime.now(),
        )

        db.add(message)
        db.commit()
        db.refresh(message)

        return message

    def get_session_messages(
        self,
        session_id: str,
        db: Session,
    ) -> List[ChatMessage]:
        return db.query(ChatMessage).filter(
            ChatMessage.session_id == session_id
        ).order_by(ChatMessage.timestamp).all()
        