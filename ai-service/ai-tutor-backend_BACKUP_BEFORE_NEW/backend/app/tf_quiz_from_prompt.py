import json
import os
import re
import requests
from difflib import SequenceMatcher
from typing import Any, Dict, List, Tuple

# ============================================================
# FINAL Fast Professor-style True / False quiz generator
# ============================================================
# Goals:
# - Return 5 questions = 3 False + 2 True
# - 1 main Ollama call + 1 small repair call only if needed
# - No topic-specific hardcoded swaps
# - Ollama writes statements; backend assigns answers from kind
# - Backend removes slide headings and rejects bad T/F items
# ============================================================

USE_OLLAMA_PROFESSOR = os.environ.get("USE_OLLAMA_PROFESSOR", "true").strip().lower() in {"true", "1", "yes"}
USE_REPAIR_CALL = os.environ.get("TF_USE_REPAIR_CALL", "true").strip().lower() in {"true", "1", "yes"}
USE_OLLAMA_POLISH = os.environ.get("USE_OLLAMA_POLISH", "false").strip().lower() in {"true", "1", "yes"}
# Default False: local models sometimes mark hallucinated/paraphrased TRUE items as source-supported.
# For safety, TRUE final questions are taken from cleaned source sentences unless you explicitly enable this.
ACCEPT_OLLAMA_TRUE = os.environ.get("TF_ACCEPT_OLLAMA_TRUE", "false").strip().lower() in {"true", "1", "yes"}

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")

TARGET_TOTAL = int(os.environ.get("TF_TARGET_TOTAL", "5"))
TARGET_FALSE = int(os.environ.get("TF_TARGET_FALSE", "3"))
TARGET_TRUE = int(os.environ.get("TF_TARGET_TRUE", "2"))

MAX_SOURCE_CHARS = int(os.environ.get("TF_MAX_SOURCE_CHARS", "9000"))
MAX_SNIPPETS = int(os.environ.get("TF_MAX_SNIPPETS", "18"))
OLLAMA_TIMEOUT = int(os.environ.get("TF_OLLAMA_TIMEOUT", "240"))

CODE_VERSION = "RANA_TF_FINAL_WORKING_010_NO_HARDCODE_STRICT_CLEAN_ALWAYS5"

# ------------------------------------------------------------
# Basic helpers
# ------------------------------------------------------------

def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def normalize_sentence(sentence: str) -> str:
    sentence = clean_text(sentence).strip(" -•\t\n\r")
    if sentence and not sentence.endswith((".", "!", "?")):
        sentence += "."
    return sentence


def normalize_key(text: str) -> str:
    return re.sub(r"\W+", " ", (text or "").lower()).strip()


def strip_true_false_prefix(text: str) -> str:
    text = clean_text(text)
    text = re.sub(r"^\s*true\s+or\s+false\s*:\s*", "", text, flags=re.IGNORECASE)
    return normalize_sentence(text)


def default_question_text(statement: str) -> str:
    return f"True or False: {normalize_sentence(statement)}"


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9]+", text or ""))


def starts_with_vague_reference(text: str) -> bool:
    return bool(re.match(r"^\s*(this|these|it|they|those|that)\b", text or "", flags=re.IGNORECASE))


def starts_with_question_word_fragment(text: str) -> bool:
    """Reject question/fragment openings that are bad True/False statements.

    A displayed T/F statement should not begin with Who/What/How/etc.
    This is generic and prevents malformed items like:
    "Who completed is the events..." without knowing the lecture topic.
    """
    return bool(re.match(
        r"^\s*(who|what|when|where|why|how|which|whose|whom)\b",
        text or "",
        flags=re.IGNORECASE,
    ))


def has_malformed_question_phrase(text: str) -> bool:
    s = clean_text(strip_true_false_prefix(text)).lower()
    if not s:
        return True

    # Bad T/F shape: starts as a question fragment.
    if starts_with_question_word_fragment(s):
        return True

    # Generic grammar break: "who completed is...", "what selected are...".
    if re.search(r"\b(who|what|which)\s+\w+(?:ed|ing)?\s+(is|are|was|were)\b", s):
        return True

    return False


def has_table_or_glossary_contamination(text: str) -> bool:
    """Detect generic PDF table/glossary fragments glued into one statement.

    This does not hardcode course words. It catches form problems like:
    "example phrase External term The definition..." where an example/list entry
    is glued before a glossary term and its definition.
    """
    s = clean_text(strip_true_false_prefix(text))
    if not s:
        return True

    words = re.findall(r"[A-Za-z][A-Za-z'-]*|\d+", s)
    if len(words) < 7:
        return False

    # Mid-sentence capitalized glossary entry followed by an article is usually
    # a pasted table row, not one grammatical statement.
    if re.search(r"[a-z]\s+[A-Z][A-Za-z'-]+(?:\s+[a-z][A-Za-z'-]+){0,4}\s+(A|An|The)\b", s):
        return True

    # Two independent definition starts in one item = likely table/list glue.
    definition_starts = len(re.findall(
        r"\b(A|An|The)\s+[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,5}\s+(is|are|means|refers|represents|describes|defines|indicates|initiates)\b",
        s,
        flags=re.IGNORECASE,
    ))
    if definition_starts >= 2:
        return True

    # Lowercase example-like fragment before a later Title Case term.
    first_word = words[0]
    if first_word and first_word[0].islower() and word_count(s) >= 10:
        if re.search(r"\b[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+|\s+[a-z][A-Za-z'-]+){1,5}\s+(is|are|means|refers|represents|describes|defines|indicates|initiates)\b", s):
            return True

    return False


def is_bad_tf_statement_shape(text: str) -> bool:
    s = sanitize_snippet(strip_true_false_prefix(text)) if 'sanitize_snippet' in globals() else clean_text(strip_true_false_prefix(text))
    if has_malformed_question_phrase(s):
        return True
    if has_table_or_glossary_contamination(s):
        return True
    return False


def remove_leading_outline_number(text: str) -> str:
    return clean_text(re.sub(r"^\s*\d+(?:[-.]\d+)+\s+", "", text or ""))


# ------------------------------------------------------------
# Generic PDF / slide cleanup
# ------------------------------------------------------------

NOISE_PATTERNS = [
    r"\bcopyright\b",
    r"\ball rights reserved\b",
    r"\bchapter\s+\d+\b",
    r"\bpage\s+\d+\b",
    r"\bslide\s+\d+\b",
    r"\btable of contents\b",
    r"\breferences\b",
    r"\bbibliography\b",
    r"\bappendix\b",
    r"\blearning objectives\b",
]

DEFINITION_HINTS = {
    "process", "method", "relationship", "sequence", "set", "type", "kind",
    "category", "concept", "model", "system", "role", "purpose", "function",
    "behavior", "task", "activity", "technique", "approach", "flow", "diagram",
}


def has_statement_verb(text: str) -> bool:
    s = f" {clean_text(text).lower()} "
    patterns = [
        r"\b(is|are|was|were|be|being|been)\b",
        r"\b(has|have|had)\b",
        r"\b(can|could|may|might|must|should|would|will)\b",
        r"\b(indicates|shows|means|represents|describes|defines|specifies|requires|includes|contains|provides|allows|causes|leads|depends|initiates|responds|combines|separates|creates|uses|helps|supports|identifies|determines|explains|classifies|extends|performs|completed|performed)\b",
        r"\b\w+(ed|ing|ifies|izes)\b",
    ]
    return any(re.search(p, s, flags=re.IGNORECASE) for p in patterns)


def title_case_ratio(text: str) -> float:
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", text or "")
    if not words:
        return 0.0
    title_words = [w for w in words if len(w) > 2 and w[0].isupper()]
    return len(title_words) / max(1, len(words))


def smart_subject_from_prefix(prefix: str) -> str:
    """Extract the likely actual subject after a glued slide heading.
    This is generic: it keeps the last meaningful 2-4 words before the definition.
    """
    toks = re.findall(r"[A-Za-z][A-Za-z'-]*|\d+", clean_text(prefix))
    if not toks:
        return ""

    # If heading uses 'for X Y' then actual term often comes after 'for'. Prefer the tail.
    low = [t.lower() for t in toks]

    # Keep the shortest useful tail. For terms ending in known concept nouns, keep up to 4 words.
    max_keep = 4
    if len(toks) >= 2:
        # Prefer the last two words for common two-word concept names.
        last2 = " ".join(toks[-2:]).lower()
        if len(last2.split()) == 2 and all(len(x) > 1 for x in last2.split()):
            # If there are many words before it, title was likely glued in front.
            if len(toks) > 3:
                return last2

    keep = toks[-max_keep:]
    return " ".join(keep).lower()


def fix_missing_copula_definition(text: str) -> str:
    """Repair PDF fragments like 'X a sequence...' into 'X is a sequence...'.
    Also drops title-like words before the real subject when possible.
    """
    s = clean_text(text)
    lower = s.lower()

    # Pattern: '<heading> <term> a/an/the <definition...>' where no linking verb exists before the article.
    m = re.match(r"^(.{2,110}?)\s+(a|an|the)\s+(.{8,})$", lower, flags=re.IGNORECASE)
    if m:
        prefix, article, rest = m.group(1), m.group(2), m.group(3)
        if not re.search(r"\b(is|are|was|were|means|represents|describes|defines|specifies|indicates|shows|refers)\b", prefix, flags=re.IGNORECASE):
            first_rest_tokens = set(re.findall(r"[a-z]+", rest)[:8])
            if first_rest_tokens & DEFINITION_HINTS or any(h in rest for h in ["sequence of", "process of", "relationship that", "for the purpose"]):
                subject = smart_subject_from_prefix(prefix)
                if subject:
                    return normalize_sentence(f"{subject.capitalize()} is {article} {rest}")

    # Pattern: '<heading> <term> relationship that specifies ...'
    m2 = re.match(r"^(.{2,120}?)\s+(relationship|process|sequence|method|system|diagram|flow|model)\s+that\s+(.{8,})$", lower, flags=re.IGNORECASE)
    if m2 and not re.search(r"\b(is|are|was|were|means|represents|describes|defines|specifies|indicates|shows)\b", m2.group(1), flags=re.IGNORECASE):
        subject = smart_subject_from_prefix(m2.group(1))
        noun = m2.group(2)
        tail = m2.group(3)
        if subject:
            return normalize_sentence(f"A {subject} {noun} {tail}")

    return normalize_sentence(s)


def remove_glued_heading_prefix(text: str) -> str:
    """Generic heading remover.
    If a sentence begins with a title-like phrase followed by a real statement,
    keep the real statement.
    """
    s = clean_text(remove_leading_outline_number(text))

    # Remove repeated duplicate title fragment: 'X Y X Y ...' (case-insensitive compact words).
    words = s.split()
    for n in range(2, min(7, len(words) // 2 + 1)):
        first = normalize_key(" ".join(words[:n]))
        second = normalize_key(" ".join(words[n:2*n]))
        if first and first == second:
            s = " ".join(words[n:])
            break

    # If it begins with a high-title-case heading and later has a lower-case statement with a verb, trim before that.
    # Example pattern: a title-like phrase glued before a real statement.
    candidates = re.finditer(r"\b([A-Z][A-Za-z-]*(?:\s+[a-z][A-Za-z-]+)?(?:\s+[a-z][A-Za-z-]+)?\s+(?:is|are|means|represents|describes|defines|specifies|indicates|shows|has|can|must)\b)", s)
    for m in candidates:
        if m.start() > 0 and title_case_ratio(s[:m.start()]) >= 0.45:
            trimmed = s[m.start():]
            if word_count(trimmed) >= 7:
                return normalize_sentence(trimmed)

    return normalize_sentence(s)



def _words_with_positions(text: str):
    return list(re.finditer(r"[A-Za-z][A-Za-z'-]*|\d+", text or ""))


def _prefix_is_likely_glued_heading(prefix: str) -> bool:
    """Generic detector for a heading/bullet fragment glued before a sentence.

    This intentionally does NOT know any course topic. It only looks at form:
    title-like words, short bullet-like fragments, or adverbial fragments such
    as "Generally ..." that appear before a full grammatical statement.
    """
    p = clean_text(prefix).strip(" -•:\t\n\r")
    if not p:
        return False

    wc = word_count(p)
    if wc < 3:
        return False

    lower = p.lower()

    # Typical slide headings: several Title Case words with no sentence ending.
    if wc <= 10 and title_case_ratio(p) >= 0.45:
        return True

    # Typical bullet fragments before a full sentence: "Generally ...", "Usually ...".
    if wc <= 10 and re.match(r"^(generally|usually|often|typically|sometimes|normally|commonly|mainly|primarily)\b", lower):
        return True

    # Short heading-like fragment without a linking verb. Keep this conservative:
    # a normal phrase with a prepositional continuation must NOT be
    # treated as a heading.
    if wc <= 8 and title_case_ratio(p) >= 0.35 and not re.search(r"\b(is|are|was|were|means|represents|describes|defines|specifies|indicates|shows|has|have|can|must|requires|includes|contains|allows|depends)\b", lower):
        return True

    return False


def _looks_like_real_statement_start(rest: str) -> bool:
    """Generic check that a substring can stand as a clean statement.

    Important safety rule: do not allow a candidate that starts with a predicate
    like "is" or with a lower-case continuation word. Otherwise a correct
    sentence such as "Use-case modeling is ..." could be incorrectly trimmed
    to "is ...".
    """
    r = clean_text(rest)
    if word_count(r) < 7:
        return False

    first_match = re.search(r"[A-Za-z][A-Za-z'-]*|\d+", r)
    if not first_match:
        return False
    first = first_match.group(0)
    first_lower = first.lower()

    predicate_starts = {
        "is", "are", "was", "were", "means", "represents",
        "describes", "defines", "specifies", "indicates", "shows",
        "has", "have", "can", "must", "requires", "includes",
        "contains", "allows", "depends", "uses", "extends",
        "initiates", "responds", "performs", "provides",
    }
    if first_lower in predicate_starts:
        return False

    # To trim a glued prefix, the new start should look like a fresh sentence or
    # a noun phrase, not like a continuation from the middle of the sentence.
    if not (first[0].isupper() or first_lower in {"a", "an", "the"}):
        return False

    # Full statement with an explicit predicate somewhere near the beginning.
    if re.search(r"\b(is|are|was|were|means|represents|describes|defines|specifies|indicates|shows|has|have|can|must|requires|includes|contains|allows|depends|uses|extends|initiates|responds|performs|provides)\b", r[:180], flags=re.IGNORECASE):
        return True

    # Definition fragment missing a copula, repaired later: "X a sequence...".
    if re.search(r"^.{2,90}\s+(a|an|the)\s+.{8,}$", r, flags=re.IGNORECASE):
        return True

    # Repeated noun-definition fragment repaired by fix_repeated_suffix_definition:
    # "X Y Y that ..." -> "X is a Y that ...".
    if _has_repeated_suffix_before_that(r):
        return True

    return False


def _has_repeated_suffix_before_that(text: str) -> bool:
    s = clean_text(text)
    m = re.search(r"\bthat\b", s, flags=re.IGNORECASE)
    if not m:
        return False
    before = s[:m.start()].strip()
    toks = [w.group(0).lower() for w in _words_with_positions(before)]
    if len(toks) < 4:
        return False
    for k in range(1, min(4, len(toks)//2) + 1):
        if toks[-k:] == toks[-2*k:-k]:
            return True
    return False


def fix_repeated_suffix_definition(text: str) -> str:
    """Repair generic PDF fragments like:

    "Heading Heading Abstract concept concept that ..."
        -> "Abstract concept is a concept that ..."

    This is grammar-based, not topic-based. It detects a repeated noun phrase
    immediately before "that" and keeps only the most likely subject tail.
    """
    s = clean_text(text)
    m = re.search(r"\bthat\b", s, flags=re.IGNORECASE)
    if not m:
        return normalize_sentence(s)

    before = s[:m.start()].strip()
    after = s[m.start():].strip()
    word_matches = _words_with_positions(before)
    toks = [w.group(0) for w in word_matches]
    low = [t.lower() for t in toks]

    if len(toks) < 4:
        return normalize_sentence(s)

    best_k = 0
    for k in range(min(4, len(toks)//2), 0, -1):
        if low[-k:] == low[-2*k:-k]:
            best_k = k
            break

    if not best_k:
        return normalize_sentence(s)

    definition_tokens = toks[-best_k:]
    subject_tokens_all = toks[:-best_k]
    if not subject_tokens_all:
        return normalize_sentence(s)

    # If a title-like heading is glued before the actual subject, keep the
    # shortest useful subject tail: one modifier + the repeated definition term.
    # Example form: "Big Heading Actual term term that ...".
    if len(subject_tokens_all) > best_k + 2:
        keep = min(len(subject_tokens_all), best_k + 1)
        subject_tokens = subject_tokens_all[-keep:]
    else:
        subject_tokens = subject_tokens_all

    subject = " ".join(subject_tokens).strip()
    definition_phrase = " ".join(t.lower() for t in definition_tokens).strip()

    if not subject or not definition_phrase:
        return normalize_sentence(s)

    # Avoid "a a term" when the repeated phrase already starts with an article.
    article = "" if re.match(r"^(a|an|the)\b", definition_phrase) else "a "
    repaired = f"{subject} is {article}{definition_phrase} {after}"
    return normalize_sentence(repaired)


def trim_glued_heading_by_statement_start(text: str) -> str:
    """Trim generic slide heading fragments glued before a real statement.

    It looks for a later substring that can stand alone as a statement and only
    trims when the prefix looks like a heading/bullet fragment.
    """
    s = clean_text(text)
    words = _words_with_positions(s)
    if len(words) < 8:
        return normalize_sentence(s)

    for idx, w in enumerate(words[2:], start=2):
        start = w.start()
        prefix = s[:start]
        rest = s[start:]

        if word_count(prefix) < 3:
            continue
        if not _prefix_is_likely_glued_heading(prefix):
            continue
        if not _looks_like_real_statement_start(rest):
            continue

        rest = fix_repeated_suffix_definition(rest)
        rest = fix_missing_copula_definition(rest)
        if word_count(rest) >= 7:
            return normalize_sentence(rest)

    return normalize_sentence(s)


def has_glued_heading_contamination(text: str) -> bool:
    """Reject remaining heading-contaminated items after cleanup.

    Generic rule: if the first 3-6 words look like a title fragment and a later
    substring is the actual statement, the item is not clean enough for display.
    """
    s = clean_text(strip_true_false_prefix(text))
    words = _words_with_positions(s)
    if len(words) < 8:
        return False

    for idx, w in enumerate(words[3:7], start=3):
        prefix = s[:w.start()]
        rest = s[w.start():]
        if _prefix_is_likely_glued_heading(prefix) and _looks_like_real_statement_start(rest):
            return True
    return False


def sanitize_snippet(text: str) -> str:
    s = clean_text(text)
    # Run a few passes because fixing one PDF artifact can expose another.
    for _ in range(3):
        old = s
        s = remove_leading_outline_number(s)
        s = fix_repeated_suffix_definition(s)
        s = trim_glued_heading_by_statement_start(s)
        s = remove_glued_heading_prefix(s)
        s = fix_missing_copula_definition(s)
        s = fix_repeated_suffix_definition(s)
        s = trim_glued_heading_by_statement_start(s)
        s = normalize_sentence(s)
        if normalize_key(s) == normalize_key(old):
            break
    return normalize_sentence(s)


def looks_like_pdf_noise(text: str) -> bool:
    s = clean_text(text)
    lower = s.lower()
    words = re.findall(r"[A-Za-z][A-Za-z'-]*|\d+", s)

    if len(words) < 5:
        return True
    if any(re.search(p, lower, flags=re.IGNORECASE) for p in NOISE_PATTERNS):
        return True
    if len([w for w in words if w.isdigit()]) >= 3:
        return True
    if re.match(r"^\s*\d+(?:[-.]\d+)+\s+", s) and not has_statement_verb(s):
        return True

    # A title-like fragment with no predicate is noise.
    if word_count(s) <= 12 and title_case_ratio(s) > 0.65 and not has_statement_verb(s):
        return True

    return False


def looks_like_fragment(text: str) -> bool:
    s = sanitize_snippet(text)
    lower = s.lower()

    if has_malformed_question_phrase(s) or has_table_or_glossary_contamination(s):
        return True
    if word_count(s) < 7:
        return True
    if looks_like_pdf_noise(s):
        return True
    if not has_statement_verb(s):
        return True
    if re.match(r"^\s*[a-z]+ing\b", lower) and not re.search(r"\b(is|are|was|were|means|indicates|shows|represents|describes)\b", lower):
        return True
    return False


def split_sentences(source_text: str) -> List[str]:
    text = clean_text(source_text)

    # Add boundaries before slide/section numbers and obvious headings when PDF extraction glues them.
    text = re.sub(r"\s+(?=\d+(?:[-.]\d+)+\s+[A-Z])", ". ", text)
    text = re.sub(r"\s+(?=\d+\.\s*[A-Z])", ". ", text)

    raw = re.split(r"(?<=[.!?])\s+", text)
    sentences: List[str] = []
    seen = set()

    # Also consider medium-size windows because PDFs often omit punctuation.
    chunks: List[str] = []
    for r in raw:
        r = clean_text(r)
        if not r:
            continue
        if len(r) > 420:
            words = r.split()
            for i in range(0, len(words), 35):
                chunks.append(" ".join(words[i:i+45]))
        else:
            chunks.append(r)

    for chunk in chunks:
        s = sanitize_snippet(chunk)
        if not s:
            continue
        if len(s) < 25 or len(s) > 320:
            continue
        if starts_with_vague_reference(s):
            continue
        if has_malformed_question_phrase(s) or has_table_or_glossary_contamination(s):
            continue
        if looks_like_pdf_noise(s):
            continue
        if looks_like_fragment(s):
            continue

        key = normalize_key(s)
        if key in seen:
            continue
        seen.add(key)
        sentences.append(s)

    return sentences


# ------------------------------------------------------------
# Scoring and validation
# ------------------------------------------------------------

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with",
    "by", "from", "that", "which", "who", "whom", "whose", "when", "where",
    "why", "how", "as", "at", "is", "are", "was", "were", "be", "being",
    "been", "this", "these", "those", "it", "they", "them", "its", "their",
    "into", "than", "then", "also", "must", "can", "may", "will", "would",
    "should", "could", "current", "other",
}

NEGATION_WORDS = {
    "not", "no", "never", "cannot", "can't", "doesn't", "don't", "isn't", "aren't",
    "wasn't", "weren't", "without", "incorrectly", "false"
}

ANSWER_CLUE_WORDS = {
    "always", "never", "none", "all", "only", "impossible", "entirely", "completely"
}


def tokenize(text: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def content_tokens(text: str) -> List[str]:
    return [t for t in tokenize(text) if t not in STOPWORDS and t not in NEGATION_WORDS]


def jaccard_similarity(a: str, b: str) -> float:
    a_set = set(tokenize(a))
    b_set = set(tokenize(b))
    if not a_set or not b_set:
        return 0.0
    return len(a_set & b_set) / len(a_set | b_set)


def content_overlap(a: str, b: str) -> float:
    a_set = set(content_tokens(a))
    b_set = set(content_tokens(b))
    if not a_set or not b_set:
        return 0.0
    return len(a_set & b_set) / len(a_set | b_set)


def sequence_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize_key(a), normalize_key(b)).ratio()


def canonical_for_similarity(text: str) -> str:
    """Normalize a statement for final-question similarity checks.

    Important: False T/F items are often made by replacing one word
    (initiated -> completed, responds -> initiates). For final display, those
    are still the same question idea, so we collapse common replacement pairs
    into neutral placeholders before measuring similarity.
    """
    s = sanitize_snippet(strip_true_false_prefix(text)).lower()

    # Collapse common T/F swap pairs so one-word variants are treated as duplicates.
    replacement_groups = {
        "event_action": ["initiated", "completed", "performed", "triggered"],
        "system_action": ["responds", "initiates", "handles", "starts"],
        "order_word": ["before", "after"],
        "quantity_word": ["single", "multiple"],
        "similarity_word": ["same", "different"],
        "availability_word": ["available", "unavailable"],
        "diagram_style": ["graphical", "textual"],
    }
    for label, words in replacement_groups.items():
        for w in words:
            s = re.sub(rf"\b{re.escape(w)}\b", label, s)

    s = re.sub(r"\b(true|false)\b", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def concept_signature_for_final(text: str, n: int = 6) -> str:
    """Compact concept key used to avoid testing the same idea repeatedly."""
    s = canonical_for_similarity(text)
    toks = [t for t in content_tokens(s) if t not in {
        "event_action", "system_action", "order_word", "quantity_word",
        "similarity_word", "availability_word", "diagram_style", "person_system",
        "process", "purpose", "single", "multiple",
    }]
    return " ".join(toks[:n])

def same_opening_subject(a: str, b: str, n: int = 4) -> bool:
    a_sig = content_tokens(a)[:n]
    b_sig = content_tokens(b)[:n]
    if len(a_sig) < 2 or len(b_sig) < 2:
        return False
    shared = len(set(a_sig) & set(b_sig))
    return shared >= min(len(a_sig), len(b_sig), 3)


def are_questions_too_similar(a: str, b: str) -> bool:
    """Final-display duplicate filter.

    This is stricter than validation. A false statement can be close to its
    supported true sentence, but two displayed questions should not be close
    to each other.
    """
    a_clean = canonical_for_similarity(a)
    b_clean = canonical_for_similarity(b)
    if not a_clean or not b_clean:
        return False
    if a_clean == b_clean:
        return True

    seq = SequenceMatcher(None, a_clean, b_clean).ratio()
    cov = content_overlap(a_clean, b_clean)
    jac = jaccard_similarity(a_clean, b_clean)
    sig_a = concept_signature_for_final(a_clean)
    sig_b = concept_signature_for_final(b_clean)

    if sig_a and sig_b and sig_a == sig_b:
        return True

    # Very close wording with most content words shared = same question idea.
    if seq >= 0.76 and (cov >= 0.34 or jac >= 0.34):
        return True

    # Same subject opening and moderate content overlap = likely repeated concept.
    if same_opening_subject(a_clean, b_clean) and (cov >= 0.40 or seq >= 0.70):
        return True

    return False

def is_too_similar_to_selected(candidate: Dict[str, Any], selected: List[Dict[str, Any]]) -> bool:
    cand_stmt = candidate.get("statement", "")
    for old in selected:
        if are_questions_too_similar(cand_stmt, old.get("statement", "")):
            return True
    return False


def is_definition_style(statement: str) -> bool:
    """Detect direct definition items so they stay Medium, not fake-Hard."""
    s = sanitize_snippet(statement).lower()
    definition_start = bool(re.search(
        r"\b(is|are|means|refers to|describes|defines|represents)\b",
        s,
        flags=re.IGNORECASE,
    ))
    deeper_markers = [
        "before", "after", "depends", "requires", "relationship", "initiated",
        "responds", "extends", "includes", "prevents", "allows", "because",
        "therefore", "while", "whereas", "compared", "multiple", "single",
        "source", "destination", "condition",
    ]
    if definition_start and not any(m in s for m in deeper_markers):
        return True
    # Classic direct definition shape: "X is a/an/the ..." with one idea only.
    if re.match(r"^[a-z0-9\- ]{2,55}\s+(is|are)\s+(a|an|the)\s+", s) and word_count(s) <= 28:
        # A definition can mention purpose/sequence and still be Medium.
        if not any(m in s for m in deeper_markers):
            return True
    # Direct textbook definitions often contain words like "single" or "purpose";
    # those should still be Medium when the overall shape is purely definitional.
    if re.match(r"^[a-z0-9\- ]{2,55}\s+(is|are)\s+(a|an|the)\s+.*\b(sequence of|set of|type of|kind of|process of|for the purpose of)\b", s) and word_count(s) <= 30:
        return True
    return False


def has_too_many_ideas(statement: str) -> bool:
    s = clean_text(statement).lower()
    wc = word_count(s)
    connector_count = len(re.findall(r"\b(and|or|but|while|whereas|although|because|therefore|however)\b", s))
    if wc > 32:
        return True
    if wc > 27 and connector_count >= 2:
        return True
    if s.count(",") >= 3:
        return True
    if ";" in s and wc > 22:
        return True
    return False


def sentence_score(text: str) -> int:
    s = text.lower()
    score = 0
    markers = [
        "relationship", "depends", "requires", "process", "sequence", "indicates",
        "shows", "means", "represents", "multiple", "single", "source",
        "destination", "before", "after", "role", "purpose", "function",
        "initiated", "responds", "performed", "completed", "includes",
        "extends", "uses", "allows", "because", "therefore", "however",
        "while", "whereas", "cause", "effect", "result",
    ]
    for m in markers:
        if m in s:
            score += 2
    wc = word_count(text)
    if 10 <= wc <= 26:
        score += 3
    elif wc > 34:
        score -= 4
    if "," in text:
        score += 1
    if starts_with_vague_reference(text):
        score -= 5
    if looks_like_pdf_noise(text):
        score -= 8
    if looks_like_fragment(text):
        score -= 5
    return score


def choose_difficulty(statement: str, is_false: bool = False) -> str:
    """Assign difficulty from the actual statement, not from a forced quota.
    - Direct definitions stay Medium.
    - False items with meaningful relationship/order/role changes can be Hard.
    """
    score = sentence_score(statement)

    if is_definition_style(statement):
        return "Medium"

    if is_false and score >= 4:
        return "Hard"
    if score >= 7:
        return "Hard"
    return "Medium"


def has_answer_clue_word(false_statement: str, true_statement: str) -> bool:
    false_tokens = set(tokenize(false_statement))
    true_tokens = set(tokenize(true_statement))
    new_clues = [t for t in (false_tokens & ANSWER_CLUE_WORDS) if t not in true_tokens]
    return bool(new_clues)


def phrase_has_content(phrase: str) -> bool:
    toks = content_tokens(phrase)
    if len(toks) >= 2:
        return True
    return len(toks) == 1 and (len(toks[0]) >= 4 or toks[0].isdigit())


def soft_contains(container: str, phrase: str) -> bool:
    container_key = normalize_key(container)
    phrase_key = normalize_key(phrase)
    if not container_key or not phrase_key:
        return False
    if phrase_key in container_key:
        return True
    phrase_tokens = content_tokens(phrase)
    if not phrase_tokens:
        return False
    container_tokens = set(tokenize(container))
    overlap = len([t for t in phrase_tokens if t in container_tokens]) / len(phrase_tokens)
    return overlap >= 0.60


def compact_without_negation(text: str) -> str:
    toks = [t for t in tokenize(text) if t not in NEGATION_WORDS and t not in {"do", "does", "did"}]
    return " ".join(toks)


def is_cheap_negation(original: str, candidate: str) -> bool:
    o = normalize_sentence(original)
    c = normalize_sentence(candidate)
    if normalize_key(o) == normalize_key(c):
        return True
    c_lower = c.lower()
    ugly_patterns = [
        r"\bcannot\s*\(",
        r"\bmust\s+do\s+not\b",
        r"\bmust\s+does\s+not\b",
        r"\bdo\s+not\s+has\b",
        r"\bdoes\s+not\s+have\s+to\s+not\b",
        r"\bis\s+not\s+\w+ed\b",
        r"\bare\s+not\s+\w+ed\b",
        r"\bdo\s+not\s+\w+s\b",
        r"\bdoes\s+not\s+\w+ed\b",
    ]
    if any(re.search(p, c_lower) for p in ugly_patterns):
        return True
    contains_negation = any(re.search(rf"\b{re.escape(w)}\b", c_lower) for w in NEGATION_WORDS)
    if contains_negation:
        sim_no_neg = SequenceMatcher(None, compact_without_negation(o), compact_without_negation(c)).ratio()
        if sim_no_neg >= 0.80:
            return True
        if jaccard_similarity(o, c) >= 0.70:
            return True
    return False


def subject_signature(text: str) -> List[str]:
    return content_tokens(text)[:3]


def has_subject_drift(true_statement: str, candidate_statement: str) -> bool:
    true_sig = subject_signature(true_statement)
    cand_sig = subject_signature(candidate_statement)
    if len(true_sig) < 2 or len(cand_sig) < 2:
        return False
    shared = len(set(true_sig) & set(cand_sig))
    return shared == 0


def is_good_true_statement(source_snippet: str, statement: str) -> bool:
    statement = sanitize_snippet(strip_true_false_prefix(statement))
    if not statement:
        return False
    if len(statement) < 25 or len(statement) > 230:
        return False
    if starts_with_vague_reference(statement):
        return False
    if has_malformed_question_phrase(statement) or has_table_or_glossary_contamination(statement):
        return False
    if has_glued_heading_contamination(statement):
        return False
    if looks_like_pdf_noise(statement) or looks_like_fragment(statement):
        return False
    if has_too_many_ideas(statement):
        return False
    if content_overlap(source_snippet, statement) < 0.08 and jaccard_similarity(source_snippet, statement) < 0.12:
        return False
    return True


def is_good_generated_false(true_statement: str, false_statement: str, changed_from: str = "", changed_to: str = "") -> bool:
    true_statement = sanitize_snippet(strip_true_false_prefix(true_statement))
    false_statement = sanitize_snippet(strip_true_false_prefix(false_statement))
    changed_from = clean_text(changed_from)
    changed_to = clean_text(changed_to)

    if not false_statement:
        return False
    if len(false_statement) < 25 or len(false_statement) > 230:
        return False
    if starts_with_vague_reference(false_statement):
        return False
    if has_malformed_question_phrase(false_statement) or has_table_or_glossary_contamination(false_statement):
        return False
    if has_glued_heading_contamination(false_statement):
        return False
    if looks_like_pdf_noise(false_statement) or looks_like_fragment(false_statement):
        return False
    if has_too_many_ideas(false_statement):
        return False
    if is_cheap_negation(true_statement, false_statement):
        return False
    if has_answer_clue_word(false_statement, true_statement):
        return False
    if has_subject_drift(true_statement, false_statement):
        return False

    jac = jaccard_similarity(true_statement, false_statement)
    cov = content_overlap(true_statement, false_statement)
    seq = sequence_similarity(true_statement, false_statement)
    if jac < 0.10 and cov < 0.08:
        return False
    if jac > 0.94 or seq > 0.96:
        return False

    # Prefer proof of the changed phrase, but do not reject a good false item solely because a local model failed this metadata.
    if changed_from and changed_to:
        if normalize_key(changed_from) == normalize_key(changed_to):
            return False
        if phrase_has_content(changed_from) and phrase_has_content(changed_to):
            if not soft_contains(true_statement, changed_from):
                return False
            if not soft_contains(false_statement, changed_to):
                return False

    return True


# ------------------------------------------------------------
# Question builders
# ------------------------------------------------------------

def make_true_question(statement: str, source_snippet: str, difficulty: str) -> Dict[str, Any]:
    statement = sanitize_snippet(statement)
    return {
        "type": "true_false",
        "difficulty": difficulty,
        "question": default_question_text(statement),
        "statement": statement,
        "answer": True,
        "explanation": f'This is true because it is directly supported by the source: "{statement}"',
        "generation_method": "ollama_or_source_true_backend_answer",
        "polished_by_ollama": False,
        "polish_safety": "backend_checked_final",
        "source_sentence": source_snippet,
        "source_key": normalize_key(source_snippet),
    }


def make_false_question(false_statement: str, supported_true_statement: str, source_snippet: str, difficulty: str, changed_from: str = "", changed_to: str = "") -> Dict[str, Any]:
    false_statement = sanitize_snippet(false_statement)
    supported_true_statement = sanitize_snippet(supported_true_statement)
    return {
        "type": "true_false",
        "difficulty": difficulty,
        "question": default_question_text(false_statement),
        "statement": false_statement,
        "answer": False,
        "explanation": f'This is false because the source supports: "{supported_true_statement}"',
        "generation_method": "ollama_false_backend_answer",
        "changed_from": clean_text(changed_from),
        "changed_to": clean_text(changed_to),
        "supported_true_statement": supported_true_statement,
        "polished_by_ollama": False,
        "polish_safety": "backend_checked_final",
        "source_sentence": source_snippet,
        "source_key": normalize_key(source_snippet),
    }


# ------------------------------------------------------------
# Ollama helpers
# ------------------------------------------------------------

def clean_ollama_json(raw: str) -> str:
    raw = re.sub(r"<think>.*?</think>", "", raw or "", flags=re.DOTALL)
    raw = raw.strip()
    raw = re.sub(r"```(?:json)?", "", raw, flags=re.IGNORECASE).replace("```", "")
    return raw.strip()


def extract_json(raw: str):
    raw = clean_ollama_json(raw)
    try:
        return json.loads(raw)
    except Exception:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(raw[start:end + 1])
    except Exception:
        return None


def ollama_generate_json(prompt: str, timeout: int = OLLAMA_TIMEOUT, num_predict: int = 1400):
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.08,
            "top_p": 0.82,
            "repeat_penalty": 1.12,
            "num_ctx": 3072,
            "num_predict": num_predict,
        },
    }
    response = requests.post(f"{OLLAMA_HOST}/api/generate", json=payload, timeout=timeout)
    response.raise_for_status()
    raw = response.json().get("response", "")
    return extract_json(raw)


# ------------------------------------------------------------
# Generation
# ------------------------------------------------------------

def parse_ollama_items(data: Any, source_items: List[Dict[str, str]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not isinstance(data, dict):
        return [], []
    items = data.get("items", [])
    if not isinstance(items, list):
        return [], []

    source_by_id = {int(x["id"]): x["source_snippet"] for x in source_items}
    true_candidates: List[Dict[str, Any]] = []
    false_candidates: List[Dict[str, Any]] = []

    for item in items:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind", "")).strip().lower()
        try:
            source_id = int(item.get("source_id", 0))
        except Exception:
            source_id = 0
        source_snippet = source_by_id.get(source_id) or (source_items[0]["source_snippet"] if source_items else "")
        if not source_snippet:
            continue

        statement = sanitize_snippet(strip_true_false_prefix(str(item.get("statement", "")).strip()))
        supported_true = sanitize_snippet(strip_true_false_prefix(str(item.get("supported_true_statement", "")).strip()))
        changed_from = str(item.get("changed_from", "")).strip()
        changed_to = str(item.get("changed_to", "")).strip()

        if kind == "true":
            # By default we do NOT trust Ollama TRUE items, because the model can
            # paraphrase or invent a true-looking sentence. Deterministic source
            # TRUE candidates are created later from the cleaned PDF text.
            if ACCEPT_OLLAMA_TRUE:
                if not supported_true:
                    supported_true = statement
                if is_good_true_statement(source_snippet, statement):
                    true_candidates.append(make_true_question(statement, source_snippet, choose_difficulty(statement, is_false=False)))
        elif kind == "false":
            if not is_good_true_statement(source_snippet, supported_true):
                continue
            if is_good_generated_false(supported_true, statement, changed_from, changed_to):
                false_candidates.append(make_false_question(statement, supported_true, source_snippet, choose_difficulty(supported_true, is_false=True), changed_from, changed_to))

    return true_candidates, false_candidates


def build_source_items(ranked_sentences: List[str], max_snippets: int = MAX_SNIPPETS) -> List[Dict[str, str]]:
    selected = ranked_sentences[:max_snippets]
    return [{"id": i, "source_snippet": sanitize_snippet(s[:360])} for i, s in enumerate(selected)]


def generate_fast_candidates_with_ollama(ranked_sentences: List[str]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not USE_OLLAMA_PROFESSOR:
        return [], []

    source_items = build_source_items(ranked_sentences, MAX_SNIPPETS)
    if not source_items:
        return [], []

    prompt = f"""
You are a senior professor writing exam-quality True/False questions from lecture/PDF snippets.

Return EXACTLY 12 candidate items:
- at least 8 items with kind = "false"
- at least 4 items with kind = "true"

Rules for all items:
- One central idea only.
- Use clean professor wording; do not copy slide titles or section headings.
- Remove broken PDF heading text.
- Use only the snippets; no outside facts.
- Avoid long/complex sentences.
- Do not mention source, snippet, slide, PDF, or page.
- A statement must be a complete declarative sentence; it must not start with who/what/when/where/why/how.
- Do not merge examples, glossary terms, table cells, or headings into one statement.
- Diversity is mandatory: do not create more than one item from the same idea.
- Do not create repeated variants of one sentence by only changing completed/initiated/responds/initiates.
- Cover different concepts when available: definition, role, relationship, order, diagram/function, condition, sequence.

TRUE item:
- kind = "true"
- statement is directly supported by one source snippet.
- supported_true_statement is the same as statement.
- changed_from and changed_to are empty.

FALSE item:
- kind = "false"
- supported_true_statement is a clean TRUE statement from the snippet.
- statement is a plausible FALSE statement that changes one meaningful idea.
- Do NOT make it false by adding not/cannot/do not/never/no.
- Keep the same central subject as the supported true statement.
- changed_from is the exact true idea/phrase.
- changed_to is the exact false replacement idea/phrase.

Return ONLY valid JSON in this exact shape:
{{
  "items": [
    {{"kind":"false","source_id":0,"supported_true_statement":"...","statement":"...","changed_from":"...","changed_to":"..."}}
  ]
}}

Source snippets:
{json.dumps(source_items, ensure_ascii=False, indent=2)}
"""
    try:
        data = ollama_generate_json(prompt, timeout=OLLAMA_TIMEOUT, num_predict=2200)
    except Exception:
        return [], []

    return parse_ollama_items(data, source_items)


def repair_missing_with_ollama(ranked_sentences: List[str], need_false: int, need_true: int) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not USE_REPAIR_CALL or not USE_OLLAMA_PROFESSOR:
        return [], []
    if need_false <= 0 and need_true <= 0:
        return [], []

    source_items = build_source_items(ranked_sentences[2:] + ranked_sentences[:2], max(MAX_SNIPPETS, 10))
    if not source_items:
        return [], []

    prompt = f"""
Generate ONLY the missing True/False exam items from the snippets.
Need exactly {max(0, need_false)} false item(s) and exactly {max(0, need_true)} true item(s).

Rules:
- One central idea.
- No slide titles/headings.
- No outside facts.
- False items must change a meaningful relationship/category/order/quantity/role/purpose, not just add not/cannot.
- A statement must be a complete declarative sentence; it must not start with who/what/when/where/why/how.
- Do not merge examples, glossary terms, table cells, or headings into one statement.
- Backend will assign answers from kind, so do not include an answer field.

JSON shape:
{{"items":[{{"kind":"false","source_id":0,"supported_true_statement":"...","statement":"...","changed_from":"...","changed_to":"..."}}]}}

Source snippets:
{json.dumps(source_items, ensure_ascii=False, indent=2)}
"""
    try:
        data = ollama_generate_json(prompt, timeout=min(OLLAMA_TIMEOUT, 180), num_predict=900)
    except Exception:
        return [], []
    return parse_ollama_items(data, source_items)


# ------------------------------------------------------------
# Generic deterministic fallback (source-based, no topic-specific swaps)
# ------------------------------------------------------------

GENERIC_SWAPS = [
    (r"\bsingle\b", "multiple"), (r"\bmultiple\b", "single"),
    (r"\bbefore\b", "after"), (r"\bafter\b", "before"),
    (r"\binitiated by\b", "completed by"),
    (r"\bresponds to\b", "initiates"),
    (r"\bincludes\b", "excludes"), (r"\bextends\b", "replaces"),
    (r"\brequires\b", "prevents"), (r"\ballows\b", "prevents"),
    (r"\bperformed before\b", "performed after"),
    (r"\bcompleted by\b", "initiated by"),
    (r"\binitiated\b", "completed"),
    (r"\bresponds\b", "initiates"),
    (r"\buses\b", "ignores"),
    (r"\bused\b", "ignored"),
    (r"\bavailable\b", "unavailable"),
    (r"\bcommon\b", "unrelated"),
    (r"\bsame\b", "different"),
    (r"\bdifferent\b", "same"),
    (r"\binside\b", "outside"),
    (r"\babove\b", "outside"),
    (r"\bbelow\b", "outside"),
    (r"\bgraphical\b", "textual"),
]


def deterministic_false_candidates(ranked_sentences: List[str], existing: List[Dict[str, Any]], need: int) -> List[Dict[str, Any]]:
    """Create safe fallback false items.

    Important fix: generate at most ONE false item from each source sentence,
    otherwise the UI can show three variants of the same concept.
    """
    if need <= 0:
        return []
    out: List[Dict[str, Any]] = []
    seen = {normalize_key(q.get("statement", "")) for q in existing}
    used_concepts = {concept_signature_for_final(q.get("statement", "")) for q in existing}

    for source in ranked_sentences:
        true_stmt = sanitize_snippet(source)
        if not is_good_true_statement(source, true_stmt):
            continue

        source_concept = concept_signature_for_final(true_stmt)
        if source_concept and source_concept in used_concepts:
            continue

        best_q = None
        best_score = -999
        for pattern, repl in GENERIC_SWAPS:
            if not re.search(pattern, true_stmt, flags=re.IGNORECASE):
                continue
            false_stmt = re.sub(pattern, repl, true_stmt, count=1, flags=re.IGNORECASE)
            false_stmt = sanitize_snippet(false_stmt)
            key = normalize_key(false_stmt)
            if not key or key in seen:
                continue
            changed_from_match = re.search(pattern, true_stmt, flags=re.IGNORECASE)
            changed_from = changed_from_match.group(0) if changed_from_match else ""
            if not is_good_generated_false(true_stmt, false_stmt, changed_from, repl):
                continue
            q = make_false_question(false_stmt, true_stmt, source, choose_difficulty(true_stmt, is_false=True), changed_from, repl)
            if is_too_similar_to_selected(q, existing + out):
                continue
            score = question_quality_score(q)
            if score > best_score:
                best_q = q
                best_score = score

        if best_q:
            out.append(best_q)
            seen.add(normalize_key(best_q.get("statement", "")))
            used_concepts.add(source_concept)
            if len(out) >= need:
                return out

    return out

def deterministic_false_from_true_candidates(true_candidates: List[Dict[str, Any]], existing_false: List[Dict[str, Any]], need: int) -> List[Dict[str, Any]]:
    """Create extra FALSE items from trusted TRUE candidates using generic semantic swaps.

    Strong diversity rule: at most one false item from each true candidate, and
    never choose an item that is too similar to a previously selected false item.
    """
    if need <= 0:
        return []
    out: List[Dict[str, Any]] = []
    seen = {normalize_key(q.get("statement", "")) for q in existing_false}
    used_concepts = {concept_signature_for_final(q.get("statement", "")) for q in existing_false}

    for tq in true_candidates:
        true_stmt = sanitize_snippet(tq.get("statement", ""))
        source = tq.get("source_sentence", true_stmt)
        if not is_good_true_statement(source, true_stmt):
            continue

        source_concept = concept_signature_for_final(true_stmt)
        if source_concept and source_concept in used_concepts:
            continue

        best_q = None
        best_score = -999
        for pattern, repl in GENERIC_SWAPS:
            if not re.search(pattern, true_stmt, flags=re.IGNORECASE):
                continue

            changed_from_match = re.search(pattern, true_stmt, flags=re.IGNORECASE)
            changed_from = changed_from_match.group(0) if changed_from_match else ""
            false_stmt = re.sub(pattern, repl, true_stmt, count=1, flags=re.IGNORECASE)
            false_stmt = sanitize_snippet(false_stmt)
            key = normalize_key(false_stmt)

            if not key or key in seen:
                continue

            if is_good_generated_false(true_stmt, false_stmt, changed_from, repl):
                q = make_false_question(
                    false_stmt,
                    true_stmt,
                    source,
                    choose_difficulty(true_stmt, is_false=True),
                    changed_from,
                    repl,
                )
                if is_too_similar_to_selected(q, existing_false + out):
                    continue
                score = question_quality_score(q)
                if score > best_score:
                    best_q = q
                    best_score = score

        if best_q:
            out.append(best_q)
            seen.add(normalize_key(best_q.get("statement", "")))
            used_concepts.add(source_concept)
            if len(out) >= need:
                return out

    return out

def repair_false_from_trusted_true(true_candidates: List[Dict[str, Any]], existing_false: List[Dict[str, Any]], need: int) -> List[Dict[str, Any]]:
    """Small emergency Ollama call: create only missing false items from trusted true statements.
    This avoids accepting hallucinated TRUE items while still giving the model a clean base.
    """
    if need <= 0 or not USE_REPAIR_CALL or not USE_OLLAMA_PROFESSOR:
        return []

    trusted = []
    for i, tq in enumerate(true_candidates[:14]):
        stmt = sanitize_snippet(tq.get("statement", ""))
        source = tq.get("source_sentence", stmt)
        if is_good_true_statement(source, stmt):
            trusted.append({"id": i, "true_statement": stmt, "source_snippet": source[:360]})

    if not trusted:
        return []

    prompt = f"""
You are a senior professor writing exam-quality True/False items.

Create exactly {need} FALSE statement(s) from these trusted TRUE statements.

Rules:
- Keep the same central subject.
- Change exactly one meaningful idea: relationship, order, role, quantity, category, purpose, condition, or direction.
- Do NOT make it false by adding not/cannot/do not/never/no.
- Do NOT use slide/page/source wording.
- The false statement must be a complete declarative sentence; it must not start with who/what/when/where/why/how.
- Do not merge examples, glossary terms, table cells, or headings into one statement.
- Return ONLY valid JSON.
- Prefer different true_id values; do not create many variants from the same true statement.

JSON shape:
{{"items":[{{"true_id":0,"false_statement":"...","changed_from":"...","changed_to":"..."}}]}}

Trusted true statements:
{json.dumps(trusted, ensure_ascii=False, indent=2)}
"""

    try:
        data = ollama_generate_json(prompt, timeout=min(OLLAMA_TIMEOUT, 150), num_predict=700)
    except Exception:
        return []

    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return []

    true_by_id = {item["id"]: item for item in trusted}
    seen = {normalize_key(q.get("statement", "")) for q in existing_false}
    out: List[Dict[str, Any]] = []

    for item in data.get("items", []):
        if not isinstance(item, dict):
            continue
        try:
            tid = int(item.get("true_id", 0))
        except Exception:
            tid = 0
        base = true_by_id.get(tid)
        if not base:
            continue

        true_stmt = sanitize_snippet(base["true_statement"])
        source = base.get("source_snippet", true_stmt)
        false_stmt = sanitize_snippet(strip_true_false_prefix(str(item.get("false_statement", ""))))
        changed_from = str(item.get("changed_from", "")).strip()
        changed_to = str(item.get("changed_to", "")).strip()

        key = normalize_key(false_stmt)
        if not key or key in seen:
            continue

        if is_good_generated_false(true_stmt, false_stmt, changed_from, changed_to):
            out.append(make_false_question(false_stmt, true_stmt, source, choose_difficulty(true_stmt, is_false=True), changed_from, changed_to))
            seen.add(key)

        if len(out) >= need:
            break

    return out


def deterministic_true_candidates(ranked_sentences: List[str], existing: List[Dict[str, Any]], need: int) -> List[Dict[str, Any]]:
    if need <= 0:
        return []
    out: List[Dict[str, Any]] = []
    seen = {normalize_key(q.get("statement", "")) for q in existing}
    for source in ranked_sentences:
        stmt = sanitize_snippet(source)
        if normalize_key(stmt) in seen:
            continue
        if is_good_true_statement(source, stmt):
            out.append(make_true_question(stmt, source, choose_difficulty(stmt, is_false=False)))
            seen.add(normalize_key(stmt))
            if len(out) >= need:
                return out
    return out


def loose_true_candidates(ranked_sentences: List[str], existing: List[Dict[str, Any]], need: int) -> List[Dict[str, Any]]:
    """Last-resort TRUE filler.
    A true item is safer than inventing a false item: it is simply a cleaned sentence
    taken from the source. This keeps the quiz at exactly 5 without trusting the LLM
    for answers.
    """
    if need <= 0:
        return []

    out: List[Dict[str, Any]] = []
    seen = {normalize_key(q.get("statement", "")) for q in existing}

    for source in ranked_sentences:
        stmt = sanitize_snippet(source)
        stmt = normalize_sentence(stmt)
        key = normalize_key(stmt)

        if not key or key in seen:
            continue
        if len(stmt) < 25 or len(stmt) > 230:
            continue
        if starts_with_vague_reference(stmt):
            continue
        if looks_like_pdf_noise(stmt):
            continue
        if looks_like_fragment(stmt):
            continue
        if has_too_many_ideas(stmt):
            continue

        # Looser grounding than is_good_true_statement: the statement came directly
        # from the cleaned source sentence, so exact semantic proof is not needed.
        if content_overlap(source, stmt) < 0.05 and jaccard_similarity(source, stmt) < 0.08:
            continue

        out.append(make_true_question(stmt, source, choose_difficulty(stmt, is_false=False)))
        seen.add(key)
        if len(out) >= need:
            return out

    return out


def true_candidates_from_false_candidates(false_candidates: List[Dict[str, Any]], existing_true: List[Dict[str, Any]], need: int) -> List[Dict[str, Any]]:
    """Safe TRUE bridge fallback.
    A validated false item includes a supported_true_statement. We only reuse it
    if it still passes source-grounded TRUE validation.
    """
    if need <= 0:
        return []
    out: List[Dict[str, Any]] = []
    seen = {normalize_key(q.get("statement", "")) for q in existing_true}
    for fq in false_candidates:
        true_stmt = sanitize_snippet(fq.get("supported_true_statement", ""))
        source = fq.get("source_sentence", true_stmt)
        key = normalize_key(true_stmt)
        if not key or key in seen:
            continue
        if is_good_true_statement(source, true_stmt):
            out.append(make_true_question(true_stmt, source, choose_difficulty(true_stmt, is_false=False)))
            seen.add(key)
        if len(out) >= need:
            break
    return out


# ------------------------------------------------------------
# Selection
# ------------------------------------------------------------

def question_quality_score(q: Dict[str, Any]) -> int:
    score = sentence_score(q.get("statement", ""))
    if q.get("answer") is False:
        score += 1
    if q.get("difficulty") == "Hard":
        score += 1
    return score


def dedupe_questions(questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    final = []
    seen = set()
    for q in questions:
        q["statement"] = sanitize_snippet(q.get("statement", ""))
        q["question"] = default_question_text(q["statement"])
        key = normalize_key(q.get("statement", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        final.append(q)
    return final


def pick_with_source_diversity(
    pool: List[Dict[str, Any]],
    needed: int,
    final: List[Dict[str, Any]],
    max_per_source: int = 1,
    avoid_similar: bool = True,
) -> List[Dict[str, Any]]:
    picked: List[Dict[str, Any]] = []
    source_counts: Dict[str, int] = {}
    for q in final:
        sk = q.get("source_key", normalize_key(q.get("source_sentence", q.get("statement", ""))))
        source_counts[sk] = source_counts.get(sk, 0) + 1

    for q in sorted(pool, key=question_quality_score, reverse=True):
        if len(picked) >= needed:
            break
        sk = q.get("source_key", normalize_key(q.get("source_sentence", q.get("statement", ""))))
        if source_counts.get(sk, 0) >= max_per_source:
            continue
        if q in final or q in picked:
            continue
        if avoid_similar and is_too_similar_to_selected(q, final + picked):
            continue
        picked.append(q)
        source_counts[sk] = source_counts.get(sk, 0) + 1
    return picked


def force_difficulty_labels(final: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep the old function name for compatibility, but do not fake difficulty.
    Recompute labels honestly. If all items become Medium, upgrade only the
    strongest non-definition FALSE item so the quiz still has some challenge.
    """
    for q in final:
        q["difficulty"] = choose_difficulty(q.get("statement", ""), is_false=(q.get("answer") is False))

    hard_count = len([q for q in final if q.get("difficulty") == "Hard"])
    if hard_count == 0:
        for q in sorted(final, key=question_quality_score, reverse=True):
            if q.get("answer") is False and not is_definition_style(q.get("statement", "")):
                q["difficulty"] = "Hard"
                break

    return final


def select_final_questions(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    candidates = dedupe_questions(candidates)
    false_questions = [q for q in candidates if q.get("answer") is False]
    true_questions = [q for q in candidates if q.get("answer") is True]

    final: List[Dict[str, Any]] = []

    # Pick FALSE first because the target is 3 False + 2 True.
    # This prevents a TRUE statement from blocking its stronger FALSE variant.
    final.extend(pick_with_source_diversity(false_questions, TARGET_FALSE, final, max_per_source=1))
    final.extend(pick_with_source_diversity(true_questions, TARGET_TRUE, final, max_per_source=1))

    if len([q for q in final if q.get("answer") is False]) < TARGET_FALSE:
        need = TARGET_FALSE - len([q for q in final if q.get("answer") is False])
        final.extend(pick_with_source_diversity(false_questions, need, final, max_per_source=2, avoid_similar=True))

    if len([q for q in final if q.get("answer") is True]) < TARGET_TRUE:
        need = TARGET_TRUE - len([q for q in final if q.get("answer") is True])
        final.extend(pick_with_source_diversity(true_questions, need, final, max_per_source=2, avoid_similar=True))

    # Emergency fill: keep the exact 3 False + 2 True target, but still avoid
    # same-concept duplicates. If candidates are limited, source count is relaxed.
    if len([q for q in final if q.get("answer") is False]) < TARGET_FALSE:
        need = TARGET_FALSE - len([q for q in final if q.get("answer") is False])
        final.extend(pick_with_source_diversity(false_questions, need, final, max_per_source=4, avoid_similar=True))

    if len([q for q in final if q.get("answer") is True]) < TARGET_TRUE:
        need = TARGET_TRUE - len([q for q in final if q.get("answer") is True])
        final.extend(pick_with_source_diversity(true_questions, need, final, max_per_source=4, avoid_similar=True))

    # Display order: 3 false first, then 2 true. Counts are preserved.
    final_false = [q for q in final if q.get("answer") is False][:TARGET_FALSE]
    final_true = [q for q in final if q.get("answer") is True][:TARGET_TRUE]
    final = final_false + final_true

    return force_difficulty_labels(final[:TARGET_TOTAL])


def remove_internal_fields(questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned = []
    for q in questions:
        q = dict(q)
        q.pop("source_key", None)
        q.pop("source_sentence", None)
        q.pop("changed_from", None)
        q.pop("changed_to", None)
        q.pop("supported_true_statement", None)
        cleaned.append(q)
    return cleaned


# ------------------------------------------------------------
# Main entry
# ------------------------------------------------------------

def generate_true_false_quiz(source_text: str):
    source_text = clean_text(source_text)
    if len(source_text) < 80:
        return {"questions": [], "error": "Not enough source text to generate True/False questions.", "code_version": CODE_VERSION}

    source_text = source_text[:MAX_SOURCE_CHARS]
    sentences = split_sentences(source_text)
    if len(sentences) < 2:
        return {"questions": [], "error": "Not enough clear source content found after removing PDF/slide noise.", "code_version": CODE_VERSION}

    ranked_sentences = sorted(sentences, key=sentence_score, reverse=True)

    ollama_true_candidates, false_candidates = generate_fast_candidates_with_ollama(ranked_sentences)

    # IMPORTANT: TRUE items are safest when they come directly from the cleaned source.
    # Ollama TRUE candidates are ignored by default because the local model can invent
    # plausible statements and label them true. Enable TF_ACCEPT_OLLAMA_TRUE only if needed.
    true_candidates = deterministic_true_candidates(ranked_sentences, [], TARGET_TRUE + 14)
    if ACCEPT_OLLAMA_TRUE:
        true_candidates = dedupe_questions(true_candidates + ollama_true_candidates)

    true_candidates = dedupe_questions(true_candidates)
    false_candidates = dedupe_questions(false_candidates)

    # First deterministic supplement from trusted TRUE items. This gives the
    # selector more diverse non-LLM alternatives before any repair call.
    pre_need_false = max(0, (TARGET_FALSE + 5) - len(false_candidates))
    if pre_need_false:
        false_candidates = dedupe_questions(false_candidates + deterministic_false_from_true_candidates(true_candidates, false_candidates, pre_need_false))

    # Repair once if the main call did not produce enough usable FALSE items.
    # We usually do not ask repair for TRUE, because source-based TRUE fallback is safer.
    need_false = max(0, TARGET_FALSE - len(false_candidates))
    if need_false:
        rt, rf = repair_missing_with_ollama(ranked_sentences, need_false, 0)
        false_candidates = dedupe_questions(false_candidates + rf)

    # If TRUE items are still missing, use the supported true statements from valid false items.
    need_true = max(0, TARGET_TRUE - len(true_candidates))
    if need_true:
        true_candidates = dedupe_questions(true_candidates + true_candidates_from_false_candidates(false_candidates, true_candidates, need_true))

    # Source-based fallback: true is direct; false uses generic non-topic semantic swaps only as last resort.
    need_true = max(0, TARGET_TRUE - len(true_candidates))
    if need_true:
        true_candidates = dedupe_questions(true_candidates + deterministic_true_candidates(ranked_sentences, true_candidates, need_true))

    # If strict true validation still gives fewer than 2 true items, use a safe
    # loose source-sentence fallback. This is what prevents the UI from showing
    # only 4 questions or all-false questions.
    need_true = max(0, TARGET_TRUE - len(true_candidates))
    if need_true:
        true_candidates = dedupe_questions(true_candidates + loose_true_candidates(ranked_sentences, true_candidates, need_true))

    need_false = max(0, TARGET_FALSE - len(false_candidates))
    if need_false:
        false_candidates = dedupe_questions(false_candidates + deterministic_false_candidates(ranked_sentences, false_candidates, need_false))

    # If still missing false items, create them from trusted TRUE candidates.
    need_false = max(0, TARGET_FALSE - len(false_candidates))
    if need_false:
        false_candidates = dedupe_questions(false_candidates + deterministic_false_from_true_candidates(true_candidates, false_candidates, need_false))

    # One small emergency LLM repair using trusted TRUE statements only.
    need_false = max(0, TARGET_FALSE - len(false_candidates))
    if need_false:
        false_candidates = dedupe_questions(false_candidates + repair_false_from_trusted_true(true_candidates, false_candidates, need_false))

    # Last tiny repair from snippets if everything above still did not give 3 false items.
    need_false = max(0, TARGET_FALSE - len(false_candidates))
    if need_false:
        _rt_extra, rf_extra = repair_missing_with_ollama(ranked_sentences, need_false, 0)
        false_candidates = dedupe_questions(false_candidates + rf_extra)

    # Final diversity supplement: use more lower-ranked source sentences, then
    # build only one false from each concept. This is specifically to avoid
    # outputs like three use-case-modeling variants and only four total items.
    if len(false_candidates) < TARGET_FALSE + 3:
        extra_true_pool = deterministic_true_candidates(ranked_sentences, true_candidates, 20)
        true_candidates = dedupe_questions(true_candidates + extra_true_pool)
        false_candidates = dedupe_questions(false_candidates + deterministic_false_from_true_candidates(true_candidates, false_candidates, TARGET_FALSE + 3 - len(false_candidates)))

    final_questions = select_final_questions(true_candidates + false_candidates)
    false_count = len([q for q in final_questions if q.get("answer") is False])
    true_count = len([q for q in final_questions if q.get("answer") is True])

    if len(final_questions) < TARGET_TOTAL or false_count < TARGET_FALSE or true_count < TARGET_TRUE:
        return {
            "questions": remove_internal_fields(final_questions),
            "error": (
                f"Only generated {len(final_questions)} valid True/False questions "
                f"({false_count} false, {true_count} true). Need more clean source text or a stronger local model."
            ),
            "code_version": CODE_VERSION,
            "debug_plan": {
                "used_content_chars": len(source_text),
                "sentence_count_after_noise_filter": len(sentences),
                "true_candidate_count": len(true_candidates),
                "false_candidate_count": len(false_candidates),
                "ollama_model": OLLAMA_MODEL if USE_OLLAMA_PROFESSOR else None,
                "repair_call": USE_REPAIR_CALL,
            },
        }

    final_questions = remove_internal_fields(final_questions)
    return {
        "questions": final_questions,
        "code_version": CODE_VERSION,
        "model": "final_fast_professor_tf_backend_answer_safety",
        "ollama_model": OLLAMA_MODEL if USE_OLLAMA_PROFESSOR else None,
        "quiz_mode": "true_false_final_3false_2true_generic_no_hardcoded_answers",
        "debug_plan": {
            "used_content_chars": len(source_text),
            "sentence_count_after_noise_filter": len(sentences),
            "true_candidate_count": len(true_candidates),
            "false_candidate_count": len(false_candidates),
            "target": "5 questions: 3 False + 2 True",
            "speed_policy": "one main Ollama call; one repair call only if needed; no verifier loop",
            "answer_policy": "backend assigns True/False safely",
            "quality_policy": "one idea, generic grammar-based heading cleanup, no cheap negation, no title fragments, avoid near-duplicate final questions, honest difficulty labels, reject question-word fragments and table/glossary glue, no topic-specific memorized answers",
        },
    }


if __name__ == "__main__":
    import sys
    source = sys.stdin.read()
    result = generate_true_false_quiz(source)
    print(json.dumps(result, indent=2, ensure_ascii=False))
