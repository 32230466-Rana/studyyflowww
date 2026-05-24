"""RAG query service."""
from typing import List, Dict, Tuple, Optional
from sqlalchemy.orm import Session
from datetime import datetime
import json
import re
import ollama

from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_core.prompts import PromptTemplate, ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_classic.retrievers.multi_query import MultiQueryRetriever

try:
    from langchain_chroma import Chroma
except ImportError:
    from langchain_community.vectorstores import Chroma

from ..database import PDFMetadata, ChatSession, ChatMessage
from ..config import settings


INVALID_QUIZ_FORMAT_MESSAGE = (
    "Invalid quiz format. The model returned answers without questions. Please regenerate."
)


def is_quiz_request(question: str) -> bool:
    q = str(question or "").lower()
    return any(
        keyword in q
        for keyword in [
            "mcq",
            "mcqs",
            "quiz",
            "question has a, b, c, d",
            "correct answer",
            "generate exactly",
            "multiple choice",
        ]
    )


def normalize_mcq_answer_text(answer: str) -> str:
    """Best-effort cleanup to keep quiz output in a strict, parseable format.

    Goals:
    - Remove markdown/bold and headings.
    - Remove difficulty labels (Hard/Medium/Easy).
    - Normalize question labels to Q1..Q5.
    - Normalize options to A. / B. / C. / D.
    - Normalize correct answer to: `Correct answer: X` (single letter).
    """

    text = str(answer or "")

    # Normalize line endings early.
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # Unwrap fenced code blocks if the model ignored the no-markdown rule.
    text = re.sub(r"```(?:json)?\s*([\s\S]*?)```", r"\1", text, flags=re.IGNORECASE)

    # Remove common markdown emphasis markers.
    text = text.replace("**", "").replace("__", "").replace("`", "")

    # Remove markdown headings / separators.
    text = re.sub(r"(?m)^\s*#{1,6}\s+.*$", "", text)
    text = re.sub(r"(?m)^\s*[-*_]{3,}\s*$", "", text)

    # Normalize question headers.
    text = re.sub(
        r"(?im)^\s*Q\s*(\d{1,2})\s*\((?:hard|medium|easy)\)\s*:\s*",
        lambda m: f"Q{m.group(1)}: ",
        text,
    )
    text = re.sub(
        r"(?im)^\s*(?:quiz|question)\s*(\d{1,2})\s*[:\.-]\s*",
        lambda m: f"Q{m.group(1)}: ",
        text,
    )
    text = re.sub(
        r"(?im)^\s*Q\s*(\d{1,2})\s*[\.)]\s*",
        lambda m: f"Q{m.group(1)}: ",
        text,
    )
    text = re.sub(
        r"(?im)^\s*Q\s*(\d{1,2})\s*[-–—]\s*",
        lambda m: f"Q{m.group(1)}: ",
        text,
    )

    # Remove difficulty labels anywhere they appear.
    text = re.sub(r"(?i)\((?:hard|medium|easy)\)", "", text)
    text = re.sub(r"(?im)^\s*(hard|medium|easy)\s*$", "", text)

    # Normalize option lines (A), - A), A., - A.
    def _normalize_option_line(match: re.Match) -> str:
        letter = match.group(1).upper()
        option_text = (match.group(2) or "").strip()
        return f"{letter}. {option_text}".rstrip()

    text = re.sub(
        r"(?im)^\s*(?:[-*•]\s*)?([A-Da-d])\s*[\)\.]\s*(.+?)\s*$",
        _normalize_option_line,
        text,
    )

    # Normalize Correct answer line variants.
    def _normalize_correct_answer(match: re.Match) -> str:
        return f"Correct answer: {match.group(1).upper()}"

    text = re.sub(
        r"(?im)^\s*Correct\s*Answer\s*:\s*([A-Da-d])\b.*$",
        _normalize_correct_answer,
        text,
    )
    text = re.sub(
        r"(?im)^\s*Correct\s*answer\s*:\s*([A-Da-d])\b.*$",
        _normalize_correct_answer,
        text,
    )

    # Normalize Explanation label.
    text = re.sub(r"(?im)^\s*Explanation\s*[-:]\s*", "Explanation: ", text)

    # Remove disallowed combined-option phrases.
    for phrase in [
        "All of the above",
        "None of the above",
        "Both A and B",
        "Both B and C",
        "Both C and D",
    ]:
        text = text.replace(phrase, "")

    # Trim excessive blank lines.
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


EXPECTED_OPTION_LETTERS = ["A", "B", "C", "D"]
BANNED_OPTION_PHRASES = [
    "all of the above",
    "none of the above",
    "both a and b",
    "both b and c",
    "both c and d",
    "all options",
]

LIGHT_STOPWORDS = {
    "about", "answer", "because", "correct", "from", "into", "option",
    "question", "that", "their", "there", "these", "this", "what", "which",
    "with", "the", "and", "for", "are", "was", "were", "has", "have",
}

BROKEN_OPTION_PATTERNS = [
    r"^\s*\d+(?:\.\d+){1,}\s+.{0,60}$",
    r"^\s*(?:chapter|section|figure|table|page)\s+\d+[\w\s:.-]*$",
    r"^\s*[•\-–—]\s*$",
]


UNSUPPORTED_QUESTION_TERMS = [
    "main",
    "primary",
    "best",
    "most important",
    "challenge",
]


def _clean_inline(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\r", "")).strip()


def _content_words(value: object) -> set:
    words = set()
    for word in re.findall(r"[a-z0-9]+", str(value or "").lower()):
        if len(word) > 3 and word.endswith("s"):
            word = word[:-1]
        if len(word) > 2 and word not in LIGHT_STOPWORDS:
            words.add(word)
    return words


def _word_overlap(left: object, right: object) -> int:
    return len(_content_words(left) & _content_words(right))


def _contains_term(text: object, term: str) -> bool:
    return re.search(rf"\b{re.escape(term)}\b", str(text or "").lower()) is not None


def _unsupported_question_terms(question: object, source_text: object) -> List[str]:
    return [
        term
        for term in UNSUPPORTED_QUESTION_TERMS
        if _contains_term(question, term) and not _contains_term(source_text, term)
    ]


def _options_almost_same(left: object, right: object) -> bool:
    left_text = _clean_inline(left).lower()
    right_text = _clean_inline(right).lower()
    if not left_text or not right_text:
        return False
    if left_text == right_text:
        return True

    left_words = _content_words(left_text)
    right_words = _content_words(right_text)
    if len(left_words) < 2 or len(right_words) < 2:
        return False

    overlap = len(left_words & right_words)
    shorter = min(len(left_words), len(right_words))
    return overlap / shorter >= 0.8


def _looks_like_broken_option(value: object) -> bool:
    text = _clean_inline(value)
    if len(text) < 2 or len(text) > 140:
        return True
    if text.endswith((",", ";", ":")):
        return True
    if sum(ch.isalnum() for ch in text) < max(2, len(text) * 0.45):
        return True
    if len(text.split()) >= 3 and text.isupper():
        return True
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in BROKEN_OPTION_PATTERNS)


def _correct_option_text(item: Dict) -> str:
    correct_letter = item.get("correctAnswer") or item.get("correct_answer") or ""
    for option in item.get("options", []):
        if option.get("letter") == correct_letter:
            return option.get("text", "")
    return ""


def _extract_json_payload(answer: object) -> Optional[object]:
    if isinstance(answer, (dict, list)):
        return answer

    text = str(answer or "").strip()
    if not text:
        return None

    text = re.sub(r"```(?:json)?\s*([\s\S]*?)```", r"\1", text, flags=re.IGNORECASE).strip()

    for candidate in [
        text,
        text[text.find("{") : text.rfind("}") + 1] if "{" in text and "}" in text else "",
        text[text.find("[") : text.rfind("]") + 1] if "[" in text and "]" in text else "",
    ]:
        candidate = candidate.strip()
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    return None


def _find_question_items(payload: object, depth: int = 0) -> Optional[List[object]]:
    if depth > 3:
        return None

    if isinstance(payload, str):
        parsed = _extract_json_payload(payload)
        return _find_question_items(parsed, depth + 1) if parsed is not None else None

    if isinstance(payload, list):
        return payload

    if not isinstance(payload, dict):
        return None

    questions = payload.get("questions")
    if isinstance(questions, list):
        return questions

    for key in [
        "answer",
        "data",
        "result",
        "quiz",
        "response",
        "output",
        "generated_quiz",
        "generated_text",
        "quiz_text",
        "text",
    ]:
        if payload.get(key) is not None:
            nested = _find_question_items(payload.get(key), depth + 1)
            if nested is not None:
                return nested

    return None


def _first_value(item: Dict, keys: List[str]) -> object:
    for key in keys:
        value = item.get(key)
        if value is not None and str(value).strip():
            return value
    return ""


def _normalize_option_text(value: object) -> str:
    return re.sub(r"^[A-D]\s*[\).:-]\s*", "", _clean_inline(value), flags=re.IGNORECASE).strip()


def _normalize_options(options_payload: object) -> Optional[List[Dict[str, str]]]:
    by_letter: Dict[str, object] = {}

    if isinstance(options_payload, dict):
        for letter in EXPECTED_OPTION_LETTERS:
            by_letter[letter] = options_payload.get(letter) or options_payload.get(letter.lower())
    elif isinstance(options_payload, list):
        for index, option in enumerate(options_payload[:4]):
            if isinstance(option, dict):
                raw_letter = _clean_inline(
                    option.get("letter") or option.get("key") or option.get("id") or EXPECTED_OPTION_LETTERS[index]
                ).upper()
                letter = raw_letter if raw_letter in EXPECTED_OPTION_LETTERS else EXPECTED_OPTION_LETTERS[index]
                by_letter[letter] = (
                    option.get("text")
                    or option.get("option")
                    or option.get("value")
                    or option.get("content")
                    or ""
                )
            else:
                by_letter[EXPECTED_OPTION_LETTERS[index]] = option
    else:
        return None

    options = [
        {"letter": letter, "text": _normalize_option_text(by_letter.get(letter))}
        for letter in EXPECTED_OPTION_LETTERS
    ]

    if any(len(option["text"]) < 2 for option in options):
        return None

    for option in options:
        option_lower = option["text"].lower()
        if any(phrase in option_lower for phrase in BANNED_OPTION_PHRASES):
            return None
        if re.search(r"Correct\s*answer\s*:|Explanation\s*:", option["text"], re.IGNORECASE):
            return None

    if len({option["text"].lower() for option in options}) != 4:
        return None

    return options


def _normalize_question_item(raw_item: object, index: int) -> Optional[Dict]:
    if not isinstance(raw_item, dict):
        return None

    question = _clean_inline(
        _first_value(raw_item, ["question", "questionText", "prompt", "stem", "text"])
    )
    question = re.sub(
        r"^\s*(?:Q(?:uestion)?|Quiz)?\s*\d{1,2}\s*(?:\([^)]*\))?\s*[:.)-]\s*",
        "",
        question,
        flags=re.IGNORECASE,
    )
    question = re.sub(r"\((?:hard|medium|easy)\)", "", question, flags=re.IGNORECASE).strip()

    if (
        len(question) < 8
        or re.match(r"^[A-D]\s*[\).:-]", question, re.IGNORECASE)
        or re.match(r"^(?:answer|correct answer|explanation)\b", question, re.IGNORECASE)
        or re.search(r"\b(?:correct\s*)?answer\s*:|Explanation\s*:", question, re.IGNORECASE)
    ):
        return None

    options = _normalize_options(
        raw_item.get("options") or raw_item.get("choices") or raw_item.get("answers")
    )
    if not options:
        return None

    correct_answer = _clean_inline(
        _first_value(raw_item, ["correctAnswer", "correct_answer", "correct", "answer", "solution"])
    ).upper()
    if not re.fullmatch(r"[A-D]", correct_answer):
        return None

    explanation = _clean_inline(_first_value(raw_item, ["explanation", "reason", "rationale"]))
    if len(explanation) < 3 or re.search(r"Correct\s*answer\s*:", explanation, re.IGNORECASE):
        return None

    return {
        "number": str(index + 1),
        "question": question,
        "options": options,
        "correctAnswer": correct_answer,
        "explanation": explanation[:300],
    }


def _parse_json_mcq_quiz(answer: object) -> List[Dict]:
    payload = _extract_json_payload(answer)
    if payload is None:
        return []

    items = _find_question_items(payload)
    if not isinstance(items, list) or not items or len(items) > 5:
        return []

    parsed = []
    for index, item in enumerate(items):
        normalized = _normalize_question_item(item, index)
        if not normalized:
            return []
        parsed.append(normalized)

    return parsed


def _parse_text_mcq_quiz(answer: object) -> List[Dict]:
    text = str(answer or "")
    if not text.strip():
        return []

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"```(?:json)?\s*([\s\S]*?)```", r"\1", text, flags=re.IGNORECASE)
    text = text.replace("**", "").replace("```", "").strip()
    text = re.sub(r"(?i)Correct\s*Answer\s*:", "Correct answer:", text)
    text = re.sub(r"(?im)^\s*Explanation\s*[-:]\s*", "Explanation: ", text)
    text = re.sub(
        r"(?im)(?:^|\n)\s*(?:Question|Quiz)\s*([1-5])\s*(?:\([^)]*\))?\s*[:\.)-]\s*",
        lambda match: f"\nQ{match.group(1)}: ",
        text,
    )
    text = re.sub(
        r"(?im)(?:^|\n)\s*Q\s*([1-5])\s*(?:\([^)]*\))?\s*[:\.)-]\s*",
        lambda match: f"\nQ{match.group(1)}: ",
        text,
    )
    text = re.sub(r"([^\n])\s+(Q[1-5]\s*:)", r"\1\n\2", text, flags=re.IGNORECASE)
    text = re.sub(r"([^\n])\s+([A-D])\s*[\).]\s+", r"\1\n\2. ", text, flags=re.IGNORECASE)
    text = re.sub(r"(?im)(?:^|\n)\s*([A-D])\s*[\).]\s+", lambda m: f"\n{m.group(1).upper()}. ", text)
    text = re.sub(r"([^\n])\s+(Correct\s*answer\s*:)", r"\1\n\2", text, flags=re.IGNORECASE)
    text = re.sub(r"([^\n])\s+(Explanation\s*:)", r"\1\n\2", text, flags=re.IGNORECASE).strip()

    first_question = re.search(r"(?:^|\n)\s*Q1\s*:", text, re.IGNORECASE)
    if first_question and first_question.start() > 0:
        text = text[first_question.start() :].strip()

    header_re = re.compile(r"(?:^|\n)\s*Q([1-5])\s*:\s*", re.IGNORECASE)
    headers = [
        {
            "number": match.group(1),
            "start": match.start(),
            "body_start": match.end(),
        }
        for match in header_re.finditer(text)
    ]

    if len(headers) != 5 or any(
        header["number"] != str(index + 1) for index, header in enumerate(headers)
    ):
        return []

    parsed = []

    for index, header in enumerate(headers):
        next_start = headers[index + 1]["start"] if index + 1 < len(headers) else len(text)
        block = text[header["body_start"] : next_start].strip()

        first_option = re.search(r"(?:^|\n)\s*A\.\s*", block, re.IGNORECASE)
        if not first_option:
            return []

        correct_line = re.search(r"(?:^|\n)\s*Correct answer\s*:", block, re.IGNORECASE)
        explanation_line = re.search(r"(?:^|\n)\s*Explanation\s*:", block, re.IGNORECASE)
        if (
            not correct_line
            or not explanation_line
            or correct_line.start() < first_option.start()
            or explanation_line.start() < correct_line.start()
        ):
            return []

        question = block[: first_option.start()].strip()
        option_lines = [
            line.strip()
            for line in block[first_option.start() : correct_line.start()].splitlines()
            if line.strip()
        ]

        if len(option_lines) != 4:
            return []

        options_dict: Dict[str, str] = {}
        for option_index, line in enumerate(option_lines):
            letter = EXPECTED_OPTION_LETTERS[option_index]
            option_match = re.match(rf"^{letter}\.\s+(.+)$", line, re.IGNORECASE)
            if not option_match:
                return []
            options_dict[letter] = option_match.group(1).strip()

        answer_line = block[correct_line.start() : explanation_line.start()].strip()
        answer_match = re.match(r"^Correct answer:\s*([A-D])$", answer_line, re.IGNORECASE)
        if not answer_match:
            return []

        explanation = re.sub(
            r"(?i)^Explanation\s*:\s*",
            "",
            block[explanation_line.start() :].strip(),
        ).strip()

        normalized = _normalize_question_item(
            {
                "question": question,
                "options": options_dict,
                "correctAnswer": answer_match.group(1).upper(),
                "explanation": explanation,
            },
            index,
        )
        if not normalized:
            return []

        parsed.append(normalized)

    return parsed if len(parsed) == 5 else []


def parse_mcq_quiz(answer: object) -> List[Dict]:
    parsed_json = _parse_json_mcq_quiz(answer)
    if len(parsed_json) == 5:
        return parsed_json

    return _parse_text_mcq_quiz(answer)


def is_valid_mcq_quiz(answer: str) -> bool:
    valid_items, _ = filter_valid_mcq_items(parse_mcq_quiz(answer))
    return len(valid_items) == 5


def validate_mcq_item_quality(item: Dict, source_text: str = "") -> Optional[str]:
    correct_answer = item.get("correctAnswer")

    if correct_answer not in EXPECTED_OPTION_LETTERS:
        return "correctAnswer must be A, B, C, or D."

    options = item.get("options") or []
    if len(options) != 4:
        return "question must have exactly four options."

    question = _clean_inline(item.get("question", ""))
    if (
        len(question) < 8
        or question.endswith(":")
        or any(re.search(pattern, question, re.IGNORECASE) for pattern in BROKEN_OPTION_PATTERNS)
    ):
        return "question is empty or looks like a broken PDF fragment."

    if source_text and _unsupported_question_terms(question, source_text):
        return "question uses unsupported superlative wording not found in the source."

    correct_text = _correct_option_text(item)
    explanation = item.get("explanation", "")

    if not correct_text:
        return "correctAnswer does not match any option."

    if not _clean_inline(explanation):
        return "explanation is empty."

    if source_text and _word_overlap(f"{question} {correct_text} {explanation}", source_text) < 2:
        return "question has no clear support from the source text."

    for option in options:
        if option.get("letter") not in EXPECTED_OPTION_LETTERS:
            return "option letter must be A, B, C, or D."
        if _looks_like_broken_option(option.get("text", "")):
            return "option looks like a broken PDF fragment or heading."

    for option in options:
        option_text = option.get("text", "")
        if option.get("letter") == correct_answer:
            continue

        if _word_overlap(option_text, explanation) > _word_overlap(correct_text, explanation):
            return "explanation appears to support another option."

    for left_index, left_option in enumerate(options):
        for right_option in options[left_index + 1 :]:
            if _options_almost_same(left_option.get("text", ""), right_option.get("text", "")):
                return "two or more options are semantically too similar."

    return None


def filter_valid_mcq_items(items: List[Dict], source_text: str = "") -> Tuple[List[Dict], List[Dict]]:
    valid_items: List[Dict] = []
    rejected_items: List[Dict] = []

    for item in items:
        reason = validate_mcq_item_quality(item, source_text)
        if reason:
            rejected = dict(item)
            rejected["rejection_reason"] = reason
            rejected_items.append(rejected)
            continue
        valid_items.append(item)

    return valid_items[:5], rejected_items


def format_mcq_quiz_json(items: List[Dict]) -> str:
    return json.dumps(
        {
            "questions": [
                {
                    "question": item["question"],
                    "options": {
                        option["letter"]: option["text"]
                        for option in item["options"]
                    },
                    "correctAnswer": item["correctAnswer"],
                    "explanation": item["explanation"],
                }
                for item in items
            ]
        },
        ensure_ascii=False,
    )


def build_quiz_prompt(context: str, repair: bool = False) -> str:
    repair_line = (
        "The previous output was malformed. Return a complete replacement with questions included.\n\n"
        if repair
        else ""
    )

    return f"""{repair_line}Return ONLY valid JSON. No markdown. No extra text.

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
- Avoid near-duplicate questions when possible.
- Make all four options clearly different in meaning.
- The explanation must directly justify the selected correctAnswer.
- Do not mix or swap definitions between related concepts.
- Avoid unsupported superlatives such as main, primary, best, most important, or challenge unless the PDF explicitly uses that wording.
- If the PDF lists several applications, ask "Which of the following is one typical application..." instead of "the main application".
- No All of the above.
- No None of the above.
- Do not show Hard/Medium labels in the visible question text.

PDF Context:
{context}"""


class RAGService:
    def __init__(self):
        self.persist_directory = settings.VECTOR_DB_DIR

    def query_multi_pdf(
        self,
        question: str,
        model: str,
        pdf_ids: Optional[List[str]],
        db: Session
    ) -> Tuple[str, List[Dict], List[str]]:

        reasoning_steps = []

        if pdf_ids is not None and len(pdf_ids) == 0:
            return "No PDF selected. Please upload or select a PDF first.", [], []

        query = db.query(PDFMetadata)

        if pdf_ids is not None:
            query = query.filter(PDFMetadata.pdf_id.in_(pdf_ids))

        pdfs = query.all()

        if not pdfs:
            return "No PDFs found to query.", [], []

        quiz_mode = is_quiz_request(question)
        generation_model = model

        reasoning_steps.append(
            f"📚 Searching across {len(pdfs)} PDF(s): {', '.join([p.name for p in pdfs])}"
        )

        if quiz_mode:
            reasoning_steps.append(
                f"Quiz mode detected: using selected local model {generation_model}"
            )
            print(f"[QUIZ] using selected local model: {generation_model}", flush=True)
        else:
            reasoning_steps.append(f"Using model: {generation_model}")

        llm = None
        QUERY_PROMPT = None
        if not quiz_mode:
            llm = ChatOllama(
                model=generation_model,
                temperature=0.2,
                num_predict=700,
            )

            QUERY_PROMPT = PromptTemplate(
                input_variables=["question"],
                template="""You are an AI assistant. Generate 2 different versions
of the user question to retrieve relevant documents.
Original question: {question}""",
            )

        all_docs = []
        embeddings = OllamaEmbeddings(model="nomic-embed-text")

        for pdf in pdfs:
            try:
                vector_db = Chroma(
                    persist_directory=self.persist_directory,
                    embedding_function=embeddings,
                    collection_name=pdf.collection_name
                )

                reasoning_steps.append(f"📄 Retrieving from: {pdf.name}")

                if quiz_mode:
                    print(f"[QUIZ] before retrieval: {pdf.name}", flush=True)
                    retriever = vector_db.as_retriever(search_kwargs={"k": 4})
                    docs = retriever.invoke(question)
                    print(f"[QUIZ] after retrieval: chunks={len(docs)}", flush=True)
                else:
                    print(f"[RAG] Before retrieval: {pdf.name}", flush=True)
                    retriever = MultiQueryRetriever.from_llm(
                        vector_db.as_retriever(search_kwargs={"k": 3}),
                        llm,
                        prompt=QUERY_PROMPT
                    )
                    docs = retriever.invoke(question)
                    print(f"[RAG] After retrieval: chunks={len(docs)}", flush=True)

                for doc in docs:
                    doc.metadata.setdefault("pdf_name", pdf.name)
                    doc.metadata.setdefault("pdf_id", pdf.pdf_id)

                all_docs.extend(docs)

                reasoning_steps.append(f"✅ Found {len(docs)} chunks in {pdf.name}")

            except Exception as e:
                print(f"Error retrieving from {pdf.name}: {e}", flush=True)
                reasoning_steps.append(f"⚠️ Error retrieving from {pdf.name}: {str(e)}")

        if not all_docs:
            return "No relevant PDF content was found for this question.", [], reasoning_steps

        context_parts = []
        # Use top 4 chunks for quiz
        num_chunks = 4 if quiz_mode else 5
        for doc in all_docs[:num_chunks]:
            source = doc.metadata.get("pdf_name", "Unknown")
            context_parts.append(f"[Source: {source}]\n{doc.page_content}\n")

        formatted_context = "\n---\n".join(context_parts)

        reasoning_steps.append(f"🔗 Using top {min(len(all_docs), num_chunks)} chunks")

        if quiz_mode:
            print("[QUIZ] before ollama.chat", flush=True)

            context_to_use = formatted_context[:2800]

            def generate_quiz(prompt: str) -> str:
                try:
                    return ollama.chat(
                        model=generation_model,
                        messages=[
                            {
                                "role": "user",
                                "content": prompt,
                            }
                        ],
                        stream=False,
                        options={
                            "temperature": 0.1,
                            "num_predict": 900,
                            "num_ctx": 2048,
                        },
                    ).message.content
                except Exception as e:
                    print(f"[QUIZ] ollama.chat failed: {e}", flush=True)
                    return ""

            response = normalize_mcq_answer_text(generate_quiz(build_quiz_prompt(context_to_use)))
            parsed_quiz = parse_mcq_quiz(response)
            valid_quiz, rejected_quiz = filter_valid_mcq_items(parsed_quiz, context_to_use)

            if len(valid_quiz) != 5:
                response = ""
                if rejected_quiz:
                    reasoning_steps.append(
                        "Quiz sanity check rejected one or more malformed questions. Please regenerate."
                    )
                reasoning_steps.append(INVALID_QUIZ_FORMAT_MESSAGE)
            else:
                response = format_mcq_quiz_json(valid_quiz)

            print("[QUIZ] after ollama.chat", flush=True)

            reasoning_steps.append("Quiz generated directly with the selected local Ollama model.")

        else:
            template = """Answer the question based ONLY on the following context.

Context:
{context}

Question:
{question}
"""

            prompt = ChatPromptTemplate.from_template(template)

            chain = (
                {"context": lambda x: formatted_context, "question": lambda x: x}
                | prompt
                | llm
                | StrOutputParser()
            )

            print("[RAG] Before normal generation", flush=True)
            response = chain.invoke(question)

        print(f"[RAG] After generation: chars={len(response or '')}", flush=True)

        sources = [
            {
                "pdf_name": doc.metadata.get("pdf_name"),
                "pdf_id": doc.metadata.get("pdf_id"),
                "chunk_index": doc.metadata.get("chunk_index", 0),
            }
            for doc in all_docs[:5]
        ]

        reasoning_steps.append("✨ Answer generated successfully!")

        return response, sources, reasoning_steps

    def save_message(
        self,
        session_id: str,
        role: str,
        content: str,
        sources: Optional[List[Dict]],
        db: Session
    ) -> ChatMessage:

        session = db.query(ChatSession).filter(
            ChatSession.session_id == session_id
        ).first()

        if not session:
            session = ChatSession(
                session_id=session_id,
                created_at=datetime.now(),
                last_active=datetime.now()
            )
            db.add(session)
        else:
            session.last_active = datetime.now()

        message = ChatMessage(
            session_id=session_id,
            role=role,
            content=content,
            sources=sources,
            timestamp=datetime.now()
        )

        db.add(message)
        db.commit()
        db.refresh(message)

        return message

    def get_session_messages(self, session_id: str, db: Session) -> List[ChatMessage]:
        return db.query(ChatMessage).filter(
            ChatMessage.session_id == session_id
        ).order_by(ChatMessage.timestamp).all()
