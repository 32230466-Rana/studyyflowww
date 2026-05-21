"""RAG query service - optimized for accurate PDF MCQs."""
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

        llm = ChatOllama(model=model, temperature=0.1)
        validator_llm = ChatOllama(model="phi3:mini", temperature=0)

        reasoning_steps.append(f"🤖 Generator: {model}")
        reasoning_steps.append("🛡️ Validator: phi3:mini")

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

                docs = vector_db.similarity_search(question, k=3)

                for doc in docs:
                    doc.metadata.setdefault("pdf_name", pdf.name)
                    doc.metadata.setdefault("pdf_id", pdf.pdf_id)

                    chunk_key = (
                        doc.metadata.get("pdf_id"),
                        doc.metadata.get("chunk_index"),
                        doc.page_content[:120],
                    )

                    if chunk_key not in seen_chunks:
                        seen_chunks.add(chunk_key)
                        all_docs.append(doc)

            except Exception as e:
                reasoning_steps.append(f"⚠️ Error retrieving from {pdf.name}: {str(e)}")

        if not all_docs:
            return "I could not retrieve relevant PDF chunks.", [], reasoning_steps

        MAX_CONTEXT_CHARS = 2500
        MAX_DOCS_FOR_CONTEXT = 3

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

            context_parts.append(f"[Source: {source}]\n{text}")

        formatted_context = "\n---\n".join(context_parts)

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
            reasoning_steps.append("🧪 Strict MCQ mode enabled")

            def get_answer_text(block: str) -> str:
                options = dict(
                    re.findall(
                        r"^\s*([A-D])\.\s*(.+?)\s*$",
                        block,
                        flags=re.MULTILINE,
                    )
                )

                answer_match = re.search(
                    r"Correct answer\s*:\s*([A-D])\b",
                    block,
                    flags=re.IGNORECASE,
                )

                if not answer_match:
                    return ""

                letter = answer_match.group(1).upper()
                return options.get(letter, "").strip()

            def has_ambiguous_options(block: str) -> bool:
                options = [
                    option.strip().lower()
                    for _, option in re.findall(
                        r"^\s*([A-D])\.\s*(.+?)\s*$",
                        block,
                        flags=re.MULTILINE,
                    )
                ]

                for i in range(len(options)):
                    for j in range(i + 1, len(options)):
                        if options[i] in options[j] or options[j] in options[i]:
                            return True

                return False

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
                        cleaned = option_text.strip().lower()

                        if len(cleaned) < 3:
                            return False

                        if cleaned in {
                            "all of the above",
                            "none of the above",
                            "both a and b",
                            "both b and c",
                            "both a and c",
                            "both c and d",
                        }:
                            return False

                    if not re.search(
                        r"Correct answer\s*:\s*([A-D])\b",
                        block,
                        re.IGNORECASE,
                    ):
                        return False

                    answer_text = get_answer_text(block)

                    if not answer_text:
                        return False

                    if answer_text.lower() not in formatted_context.lower():
                        return False

                    if has_ambiguous_options(block):
                        return False

                    if not re.search(
                        r"Explanation\s*:\s*(.+)",
                        block,
                        re.IGNORECASE | re.DOTALL,
                    ):
                        return False

                return True

            strict_mcq_prompt = f"""
You are a strict exam MCQ generator.

Generate exactly 5 MCQs from the provided PDF context.

Requirements:
- Use ONLY the provided context.
- Create 4 options for each question: A, B, C, D.
- Only ONE option must be correct.
- Avoid ambiguous wording.
- Do not invent information.
- Keep explanations short.
- Difficulty must be exactly: 3 Hard + 2 Medium.
- No All of the above.
- No None of the above.
- No Both A and B.
- Output ONLY the quiz.

PDF CONTEXT:
{formatted_context}

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

            validator_prompt = f"""
Validate this MCQ quiz.

Rules:
- Reject if two answers can be correct.
- Reject if any correct answer is unsupported by the context.
- Reject hallucinations.
- Reject ambiguous questions.
- Reject if explanation contradicts the correct answer.
- Return only VALID or INVALID.

Context:
{formatted_context}

MCQ:
{response}
""".strip()

            validation = validator_llm.invoke(validator_prompt)
            validation = validation.content if hasattr(validation, "content") else str(validation)

            if (not mcq_is_valid(response)) or ("INVALID" in validation.upper()):
                reasoning_steps.append("⚠️ MCQ invalid or rejected by phi3. Retrying once.")

                retry_prompt = f"""
The previous output was invalid.

Regenerate from scratch using ONLY this PDF context.

Rules:
- Generate exactly 5 MCQs.
- Use exactly 3 Hard and 2 Medium.
- Every question must have A, B, C, D.
- Only ONE answer can be correct.
- No empty options.
- No All/None/Both of the above.
- Correct answer must be one letter only.
- Add short explanation.
- Output only the quiz.

PDF CONTEXT:
{formatted_context}

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
                    "The local model generated incomplete or invalid MCQs. "
                    "Please click Generate again. No invalid quiz was accepted."
                )
            else:
                reasoning_steps.append("✅ Strict MCQ quiz generated and validated")

            return response, sources, reasoning_steps

        general_prompt = f"""
Use ONLY the PDF context below.

Do not use outside knowledge.
Answer clearly and directly.

Context:
{formatted_context}

Question:
{question}

Answer:
""".strip()

        response = llm.invoke(general_prompt)
        response = response.content if hasattr(response, "content") else str(response)

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