import re
from typing import Any, Dict, List, Optional


STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "than", "this", "that",
    "these", "those", "with", "without", "from", "into", "onto", "over", "under",
    "between", "within", "during", "before", "after", "about", "because", "while",
    "where", "when", "which", "what", "who", "whom", "whose", "why", "how",
    "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
    "do", "does", "did", "can", "could", "should", "would", "may", "might",
    "will", "shall", "must", "not", "no", "yes", "also", "only", "very",
    "system", "process", "method", "thing", "item", "data", "information",
    "example", "figure", "table", "page", "chapter", "slide", "lecture",
}


def _clean_text(text: Any) -> str:
    if text is None:
        return ""
    if isinstance(text, list):
        text = "\n".join(str(x) for x in text)
    text = str(text)
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def _split_sentences(text: str) -> List[str]:
    text = re.sub(r"\s+", " ", text)
    parts = re.split(r"(?<=[.!?])\s+", text)
    sentences = []

    for s in parts:
        s = s.strip(" -•\t\n")
        if len(s) < 45 or len(s) > 260:
            continue
        if s.count(" ") < 6:
            continue
        if re.search(r"^(chapter|slide|page|figure|table)\b", s, re.I):
            continue
        if not re.search(r"[a-zA-Z]", s):
            continue
        sentences.append(s)

    return sentences


def _is_good_answer(answer: str) -> bool:
    answer = answer.strip(" .,:;()[]{}\"'")
    if not answer:
        return False

    words = [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z\-]*", answer)]

    if len(words) == 0 or len(words) > 5:
        return False

    if len(words) == 1:
        w = words[0]
        if len(w) < 4:
            return False
        if w in STOPWORDS:
            return False

    weak_count = sum(1 for w in words if w in STOPWORDS)
    if weak_count >= len(words):
        return False

    return True


def _candidate_answers(sentence: str) -> List[str]:
    candidates: List[str] = []

    patterns = [
        r"\b(?:called|known as|referred to as|named)\s+([A-Za-z][A-Za-z\-]*(?:\s+[A-Za-z][A-Za-z\-]*){0,4})",
        r"\b([A-Za-z][A-Za-z\-]*(?:\s+[A-Za-z][A-Za-z\-]*){0,3})\s+(?:is|are|refers to|means)\b",
        r"\b(?:the|a|an)\s+([A-Z][A-Za-z\-]*(?:\s+[A-Z][A-Za-z\-]*){0,3})\b",
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, sentence):
            ans = match.group(1).strip()
            ans = re.sub(r"\s+", " ", ans)
            if _is_good_answer(ans):
                candidates.append(ans)

    quoted = re.findall(r"[\"“']([^\"”']{3,60})[\"”']", sentence)
    for ans in quoted:
        ans = ans.strip()
        if _is_good_answer(ans):
            candidates.append(ans)

    tech_phrases = re.findall(
        r"\b[A-Za-z][A-Za-z\-]{4,}(?:\s+[A-Za-z][A-Za-z\-]{3,}){0,3}\b",
        sentence,
    )
    for ans in tech_phrases:
        ans = ans.strip()
        words = ans.lower().split()
        if any(w not in STOPWORDS for w in words) and _is_good_answer(ans):
            candidates.append(ans)

    unique = []
    seen = set()
    for c in candidates:
        key = c.lower()
        if key not in seen:
            seen.add(key)
            unique.append(c)

    return unique


def _make_blank(sentence: str, answer: str) -> Optional[str]:
    pattern = re.compile(re.escape(answer), re.I)
    if not pattern.search(sentence):
        return None

    q = pattern.sub("________", sentence, count=1)
    q = q.strip()

    if "________" not in q:
        return None

    if not q.endswith((".", "?", "!")):
        q += "."

    return q


def generate_fill_blank_quiz(
    content: Any = None,
    questions_count: int = 5,
    difficulty: str = "mixed",
    title: Optional[str] = None,
    *args: Any,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Generic local Fill-in-the-Blank generator.
    No hardcoded PDF answers.
    Builds blanks directly from the provided source text.
    """

    if content is None and args:
        content = args[0]

    content = kwargs.get("content", content)
    content = kwargs.get("text", content)
    content = kwargs.get("source_text", content)
    content = kwargs.get("chapter_text", content)

    questions_count = int(
        kwargs.get(
            "questions_count",
            kwargs.get("question_count", kwargs.get("total_questions", questions_count)),
        )
    )

    difficulty = kwargs.get("difficulty", difficulty) or "mixed"

    text = _clean_text(content)
    sentences = _split_sentences(text)

    questions: List[Dict[str, Any]] = []
    used_answers = set()
    used_sentences = set()

    for sentence in sentences:
        if len(questions) >= questions_count:
            break

        if sentence.lower() in used_sentences:
            continue

        for answer in _candidate_answers(sentence):
            if len(questions) >= questions_count:
                break

            answer_key = answer.lower().strip()
            if answer_key in used_answers:
                continue

            blank_question = _make_blank(sentence, answer)
            if not blank_question:
                continue

            if difficulty.lower() in {"mixed", "auto", "all"}:
                q_difficulty = "Hard" if len(questions) < 3 else "Medium"
            else:
                q_difficulty = difficulty.capitalize()

            questions.append(
                {
                    "type": "fill_blank",
                    "quiz_type": "fill_blank",
                    "difficulty": q_difficulty,
                    "question": blank_question,
                    "answer": answer,
                    "correct_answer": answer,
                    "options": [],
                    "explanation": f"The missing term is '{answer}' because it appears in the source sentence.",
                    "source_sentence": sentence,
                    "safety": "source_text_cloze",
                }
            )

            used_answers.add(answer_key)
            used_sentences.add(sentence.lower())

    return questions
