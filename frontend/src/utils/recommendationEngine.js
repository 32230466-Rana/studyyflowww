function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:()[\]{}"'`]/g, "");
}

function normalizeAnswer(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  return normalizeText(value);
}

function getQuestionId(question, index) {
  return (
    question?.id ??
    question?.question_id ??
    question?.questionId ??
    question?.uuid ??
    index
  );
}

function getQuestionText(question) {
  return (
    question?.question ??
    question?.text ??
    question?.prompt ??
    question?.title ??
    question?.statement ??
    "Question"
  );
}

function getCorrectAnswer(question) {
  return (
    question?.correct_answer ??
    question?.correctAnswer ??
    question?.answer ??
    question?.model_answer ??
    question?.modelAnswer ??
    question?.expected_answer ??
    question?.expectedAnswer ??
    question?.correct_option ??
    question?.correctOption ??
    question?.correct ??
    ""
  );
}

const STOPWORDS = new Set([
  "what",
  "which",
  "where",
  "when",
  "why",
  "how",
  "does",
  "the",
  "and",
  "or",
  "with",
  "from",
  "into",
  "this",
  "that",
  "these",
  "those",
  "true",
  "false",
  "question",
  "answer",
  "best",
  "explains",
  "explain",
  "following",
  "correct",
  "incorrect",
  "about",
  "between",
  "because",
  "based",
  "related",
  "chapter",
  "quiz",
  "latest",
  "current",
  "topic",
  "study",
  "flow",
  "student",
  "students",
  "material",
  "uploaded",
  "pdf",
  "primary",
  "purpose",
  "role",
  "important",
  "importance",
  "main",
  "most",
  "least",
  "choose",
  "select",
  "option",
  "statement",
  "statements",
  "process",
  "method",
  "system",
  "systems",
]);

function isGenericTopic(value) {
  const text = normalizeText(value);

  if (!text) return true;
  if (/^chapter \d+$/.test(text)) return true;
  if (/^chapter\d+$/.test(text)) return true;
  if (/^page \d+$/.test(text)) return true;

  return [
    "chapter",
    "latest quiz",
    "current quiz topic",
    "current topic",
    "quiz",
    "latest",
    "related uploaded material",
    "uploaded material",
    "current chapter",
  ].includes(text);
}

function toTitleCase(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function cleanTopicPhrase(value) {
  let text = String(value || "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  text = text
    .replace(/\b(in|for|during|within|when|where|why|how|because|that|which|who|what)\b.*$/i, "")
    .replace(/\b(is|are|was|were|can|could|should|would|will|must)\b.*$/i, "")
    .trim();

  const words = text
    .split(" ")
    .map((word) => word.replace(/[^a-zA-Z0-9/-]/g, ""))
    .filter(Boolean)
    .filter((word) => !STOPWORDS.has(word.toLowerCase()))
    .slice(0, 5);

  if (!words.length) return "";

  return toTitleCase(words.join(" "));
}

function inferTopicFromQuestion(question) {
  const questionText = String(getQuestionText(question) || "");
  const correctAnswer = String(getCorrectAnswer(question) || "");
  const supportText = String(
    question?.explanation ??
      question?.supporting_fact ??
      question?.supportingFact ??
      question?.source_text ??
      question?.sourceText ??
      question?.context ??
      ""
  );

  const patterns = [
    /(?:role|purpose|importance|function|meaning|definition)\s+of\s+(.+?)(?:\?|\.|,|:|;|$)/i,
    /(?:how\s+does|how\s+do)\s+(.+?)\s+(?:relate|affect|support|help|contribute|compare)/i,
    /(?:compare\s+and\s+contrast|compare|contrast)\s+(.+?)\s+(?:with|and|versus|vs\.?)/i,
    /(?:which|what)\s+(.+?)\s+(?:primarily|mainly|directly|best)/i,
    /(?:about|regarding|related\s+to)\s+(.+?)(?:\?|\.|,|:|;|$)/i,
  ];

  for (const pattern of patterns) {
    const match = questionText.match(pattern);

    if (match?.[1]) {
      const phrase = cleanTopicPhrase(match[1]);
      if (phrase && !isGenericTopic(phrase)) return phrase;
    }
  }

  const combinedText = [questionText, correctAnswer, supportText]
    .filter(Boolean)
    .join(" ");

  const words = normalizeText(combinedText)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length >= 4)
    .filter((word) => !STOPWORDS.has(word));

  const counts = {};

  words.forEach((word, index) => {
    const next = words[index + 1];
    const pair = next ? `${word} ${next}` : "";

    counts[word] = (counts[word] || 0) + 1;

    if (pair) {
      counts[pair] = (counts[pair] || 0) + 2;
    }
  });

  const keywords = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([phrase]) => phrase)
    .filter((phrase) => !isGenericTopic(phrase))
    .slice(0, 2);

  if (!keywords.length) return "";

  return toTitleCase(keywords[0]);
}

function getTopic(question, fallbackTopic) {
  const possibleTopics = [
    question?.topic,
    question?.source_topic,
    question?.sourceTopic,
    question?.section,
    question?.source_section,
    question?.sourceSection,
    question?.category,
    question?.concept,
    question?.skill,
    question?.learning_objective,
    question?.learningObjective,
  ];

  for (const topic of possibleTopics) {
    if (topic && !isGenericTopic(topic)) {
      return String(topic);
    }
  }

  const inferredTopic = inferTopicFromQuestion(question);

  if (inferredTopic && !isGenericTopic(inferredTopic)) {
    return inferredTopic;
  }

  const chapter =
    question?.chapter_title ??
    question?.chapterTitle ??
    question?.chapter ??
    fallbackTopic;

  return chapter || "Current Quiz Topic";
}

function getUserAnswer(question, userAnswers, index) {
  const id = getQuestionId(question, index);
  const text = getQuestionText(question);

  if (question?.user_answer !== undefined) return question.user_answer;
  if (question?.userAnswer !== undefined) return question.userAnswer;
  if (question?.selected_answer !== undefined) return question.selected_answer;
  if (question?.selectedAnswer !== undefined) return question.selectedAnswer;
  if (question?.selected_option !== undefined) return question.selected_option;
  if (question?.selectedOption !== undefined) return question.selectedOption;

  if (!userAnswers) return "";

  return (
    userAnswers[id] ??
    userAnswers[String(id)] ??
    userAnswers[index] ??
    userAnswers[String(index)] ??
    userAnswers[text] ??
    ""
  );
}

function getOptions(question) {
  const options =
    question?.options ??
    question?.choices ??
    question?.answers ??
    question?.mcq_options ??
    [];

  if (!Array.isArray(options)) return [];

  return options.map((option) => {
    if (typeof option === "string") return option;

    return (
      option?.text ??
      option?.label ??
      option?.answer ??
      option?.value ??
      String(option ?? "")
    );
  });
}

function backendAlreadyChecked(question) {
  if (typeof question?.is_correct === "boolean") return question.is_correct;
  if (typeof question?.isCorrect === "boolean") return question.isCorrect;
  if (question?.correctness === true) return true;
  if (question?.correctness === false) return false;

  const result = normalizeText(question?.result ?? question?.status ?? "");

  if (["correct", "right", "true", "passed"].includes(result)) return true;
  if (["wrong", "incorrect", "false", "failed"].includes(result)) return false;

  return null;
}

function isAnswerCorrect(question, userAnswer, correctAnswer) {
  const checked = backendAlreadyChecked(question);
  if (checked !== null) return checked;

  const user = normalizeAnswer(userAnswer);
  const correct = normalizeAnswer(correctAnswer);

  if (!user || !correct) return false;
  if (user === correct) return true;

  const options = getOptions(question);
  const letters = ["a", "b", "c", "d", "e", "f"];

  const userLetterIndex = letters.indexOf(user);
  const correctLetterIndex = letters.indexOf(correct);

  if (correctLetterIndex !== -1 && options[correctLetterIndex]) {
    return user === normalizeAnswer(options[correctLetterIndex]);
  }

  if (userLetterIndex !== -1 && options[userLetterIndex]) {
    return normalizeAnswer(options[userLetterIndex]) === correct;
  }

  if (Array.isArray(correctAnswer)) {
    return correctAnswer.some((item) => normalizeAnswer(item) === user);
  }

  return false;
}

function getPriority(score, wrongCount = 0) {
  if (score < 50 || wrongCount >= 2) return "High";
  if (score < 75 || wrongCount === 1) return "Medium";
  return "Low";
}

function getTodayLabel() {
  return new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function buildScoreTrend(latestScore) {
  let oldTrend = [];

  try {
    oldTrend = JSON.parse(localStorage.getItem("studyflow_score_trend") || "[]");
  } catch {
    oldTrend = [];
  }

  const updatedTrend = [
    ...oldTrend,
    {
      label: getTodayLabel(),
      score: latestScore,
    },
  ].slice(-5);

  localStorage.setItem("studyflow_score_trend", JSON.stringify(updatedTrend));

  return {
    previousScore: oldTrend.length ? Number(oldTrend[oldTrend.length - 1].score) : 0,
    scoreTrend: updatedTrend,
  };
}

function getField(question, names) {
  for (const name of names) {
    if (
      question?.[name] !== undefined &&
      question?.[name] !== null &&
      question?.[name] !== ""
    ) {
      return question[name];
    }
  }

  return "";
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function firstValue(values = []) {
  return values.find((value) => value !== undefined && value !== null && value !== "") || "";
}

function getReviewMeta(question, fallbackTopic) {
  const chapter = getField(question, [
    "chapter",
    "chapter_title",
    "chapterTitle",
    "source_chapter",
    "sourceChapter",
  ]);

  const section = getField(question, [
    "section",
    "source_section",
    "sourceSection",
    "topic",
    "source_topic",
    "sourceTopic",
    "category",
    "concept",
  ]);

  const pageFrom = getField(question, [
    "review_from",
    "reviewFrom",
    "page_from",
    "pageFrom",
    "page_start",
    "pageStart",
    "source_page",
    "sourcePage",
    "page",
  ]);

  const pageTo = getField(question, [
    "review_to",
    "reviewTo",
    "page_to",
    "pageTo",
    "page_end",
    "pageEnd",
    "source_page",
    "sourcePage",
    "page",
  ]);

  let reviewSource = "";

  if (pageFrom && pageTo) {
    reviewSource =
      String(pageFrom) === String(pageTo)
        ? `Page ${pageFrom}`
        : `Pages ${pageFrom}-${pageTo}`;
  } else if (pageFrom) {
    reviewSource = `Page ${pageFrom}`;
  } else if (section && !isGenericTopic(section)) {
    reviewSource = `Section: ${section}`;
  } else if (chapter && !isGenericTopic(chapter)) {
    reviewSource = chapter;
  } else if (fallbackTopic && !isGenericTopic(fallbackTopic)) {
    reviewSource = `Topic: ${fallbackTopic}`;
  } else {
    reviewSource = "Related uploaded material";
  }

  if (
    chapter &&
    !isGenericTopic(chapter) &&
    !String(reviewSource).includes(String(chapter))
  ) {
    reviewSource = `${chapter} · ${reviewSource}`;
  }

  return {
    chapter: chapter || fallbackTopic || "Current Chapter",
    section: section || fallbackTopic || "Current Topic",
    pageFrom,
    pageTo,
    reviewSource,
  };
}

function getQuestionSourceMeta(question, defaults = {}) {
  const noteId =
    getField(question, ["note_id", "noteId", "document_id", "documentId"]) ||
    defaults.noteId ||
    "";

  const noteTitle =
    getField(question, ["note_title", "noteTitle", "document_title", "documentTitle"]) ||
    defaults.noteTitle ||
    "";

  const chapterId =
    getField(question, ["chapter_id", "chapterId"]) ||
    defaults.chapterId ||
    "";

  const chapterTitle =
    getField(question, ["chapter_title", "chapterTitle", "chapter"]) ||
    defaults.chapterTitle ||
    "";

  const singleChunkId =
    getField(question, [
      "source_chunk_id",
      "sourceChunkId",
      "chunk_id",
      "chunkId",
      "source_id",
      "sourceId",
    ]) || "";

  const sourceChunkIds = Array.isArray(question?.source_chunk_ids)
    ? question.source_chunk_ids
    : Array.isArray(question?.sourceChunkIds)
      ? question.sourceChunkIds
      : singleChunkId
        ? [singleChunkId]
        : defaults.sourceChunkIds || [];

  return {
    noteId,
    noteTitle,
    chapterId,
    chapterTitle,
    sourceChunkIds: uniqueValues(sourceChunkIds),
  };
}

function extractKeywords(text, limit = 4) {
  const words = normalizeText(text)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));

  const counts = {};

  words.forEach((word) => {
    counts[word] = (counts[word] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => toTitleCase(word))
    .slice(0, limit);
}

function buildReason(topicItem) {
  const wrongCount = topicItem.total - topicItem.correct;

  if (wrongCount <= 0) {
    return `You did well in ${topicItem.topic}, but it is still useful to review it once before the next quiz.`;
  }

  const wrongText = topicItem.wrongQuestions
    .map((item) => `${item.question} ${item.correctAnswer}`)
    .join(" ");

  const keywords = extractKeywords(wrongText, 3);

  if (keywords.length) {
    return `You missed ${wrongCount}/${topicItem.total} question(s) connected to ${keywords.join(", ")}.`;
  }

  return `You missed ${wrongCount}/${topicItem.total} question(s) in this topic, so it needs focused review.`;
}

function buildAskPdfPrompt(topic, reviewSource) {
  return `Explain ${topic} in simple steps using the PDF content. Focus on ${reviewSource}, give examples, and mention common mistakes.`;
}

function getRecommendedQuizType(quizType, priority) {
  const type = String(quizType || "").toLowerCase();

  if (type.includes("true")) return "True/False";
  if (type.includes("mcq")) return "MCQ";
  if (type.includes("subjective")) return "Subjective";
  if (priority === "High") return "True/False";

  return "MCQ";
}

function buildRecommendationText(priority, topic) {
  if (priority === "High") {
    return `Review ${topic}, ask the PDF for examples, then solve a focused quiz only from this weak part.`;
  }

  if (priority === "Medium") {
    return `Practice targeted questions on ${topic} and compare your answers with the correct ones.`;
  }

  return `Do a quick review of ${topic} to keep your score stable.`;
}

function buildAiAdvice({ weakTopics, latestScore, improvement }) {
  if (!weakTopics.length) {
    return "Great work. Your latest quiz result shows strong understanding. Keep practicing with short quizzes to maintain your progress.";
  }

  const mainTopic = weakTopics[0].topic;

  if (latestScore < 50) {
    return `Focus first on ${mainTopic}. Review the exact source section, ask the PDF for a simple explanation, then generate a focused quiz from this weak part only.`;
  }

  if (improvement > 0) {
    return `You are improving. Your next best step is to review ${mainTopic}, understand why the wrong answers were wrong, and retry a focused quiz.`;
  }

  return `Your main focus should be ${mainTopic}. Review the source section, ask the PDF for examples, then generate a focused quiz to check your understanding.`;
}

function buildWrongQuestionPayload(item) {
  return {
    id: item.id,
    question: item.question,
    topic: item.topic,
    difficulty: item.difficulty,
    userAnswer: item.userAnswer,
    correctAnswer: item.correctAnswer,
    reviewSource: item.reviewMeta?.reviewSource || "Related uploaded material",
    sourceChunkIds: item.sourceMeta?.sourceChunkIds || [],
  };
}

function pickReviewSource(item, chapterTitle, noteTitle) {
  const sources = item.reviewSources.filter(Boolean);
  const nonGenericSource = sources.find((source) => !isGenericTopic(source));

  if (nonGenericSource) return nonGenericSource;
  if (chapterTitle && !isGenericTopic(chapterTitle)) return chapterTitle;
  if (noteTitle && !isGenericTopic(noteTitle)) return noteTitle;
  if (item.topic && !isGenericTopic(item.topic)) return `Topic: ${item.topic}`;

  return "Related uploaded material";
}

/* Weak-area alignment guard.
   This prevents a weak topic from being displayed if its source/reason does not
   contain matching evidence from the same question/source metadata.
*/
const RECOMMENDATION_STOPWORDS = new Set([
  "what",
  "which",
  "when",
  "where",
  "why",
  "how",
  "the",
  "is",
  "are",
  "was",
  "were",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "for",
  "and",
  "or",
  "with",
  "about",
  "between",
  "from",
  "into",
  "by",
  "as",
  "at",
  "this",
  "that",
  "these",
  "those",
  "topic",
  "question",
  "answer",
  "correct",
  "wrong",
  "student",
]);

function normalizeRecommendationText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function recommendationTerms(value = "") {
  const text = normalizeRecommendationText(value);
  const words = text.match(/[a-zA-Z][a-zA-Z-]{2,}/g) || [];

  return [...new Set(words.filter((word) => !RECOMMENDATION_STOPWORDS.has(word)))];
}

function recommendationOverlap(query = "", evidence = "") {
  const queryTerms = recommendationTerms(query);
  const evidenceTerms = new Set(recommendationTerms(evidence));

  if (!queryTerms.length) return 0;

  const matched = queryTerms.filter((term) => evidenceTerms.has(term));

  return matched.length / queryTerms.length;
}

function splitComparisonWeakTopic(topic = "") {
  const text = normalizeRecommendationText(topic);

  if (text.includes(" vs ")) {
    return text.split(/\s+vs\.?\s+/).map((part) => part.trim()).filter(Boolean);
  }

  if (text.includes(" versus ")) {
    return text.split(/\s+versus\s+/).map((part) => part.trim()).filter(Boolean);
  }

  const match = text.match(/difference between (.+?) and (.+)/);

  if (match) {
    return [match[1].trim(), match[2].trim()];
  }

  return [];
}

function buildWeakTopicEvidenceText(item, reviewSource, focusedSourceItems = []) {
  const questionEvidenceText = focusedSourceItems
    .map((question) => {
      const raw = question.rawQuestion || {};

      return [
        question.question,
        question.correctAnswer,
        question.userAnswer,
        question.topic,
        question.reviewMeta?.reviewSource,
        question.reviewMeta?.section,
        question.reviewMeta?.chapter,
        question.sourceMeta?.chapterTitle,
        question.sourceMeta?.noteTitle,

        raw.explanation,
        raw.supporting_fact,
        raw.supportingFact,
        raw.source_text,
        raw.sourceText,
        raw.context,
        raw.section,
        raw.source_section,
        raw.sourceSection,
        raw.topic,
        raw.source_topic,
        raw.sourceTopic,
        raw.category,
        raw.concept,
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join(" ");

  return [
    reviewSource,
    item.topic,
    item.reviewSources?.join(" "),
    item.noteTitles?.join(" "),
    item.chapterTitles?.join(" "),
    questionEvidenceText,
  ]
    .filter(Boolean)
    .join(" ");
}

function isWeakTopicSourceAligned(topic, evidenceText) {
  const cleanTopic = normalizeRecommendationText(topic);
  const cleanEvidence = normalizeRecommendationText(evidenceText);

  if (!cleanTopic || !cleanEvidence) return false;

  const comparisonParts = splitComparisonWeakTopic(cleanTopic);

  if (comparisonParts.length >= 2) {
    return comparisonParts.every((part) => recommendationOverlap(part, cleanEvidence) >= 0.5);
  }

  return recommendationOverlap(cleanTopic, cleanEvidence) >= 0.25;
}

function buildSafeWeakReason(topicItem, reviewSource) {
  const wrongCount = topicItem.total - topicItem.correct;

  if (wrongCount <= 0) {
    return `Review "${topicItem.topic}" from ${reviewSource} to keep this area fresh.`;
  }

  return `You missed ${wrongCount}/${topicItem.total} question(s), so review "${topicItem.topic}" from ${reviewSource}.`;
}

export function buildRecommendationFromQuiz({
  questions = [],
  userAnswers = {},
  quizTitle = "Latest Quiz",
  chapterTitle = "",
  quizType = "Quiz",

  noteId = "",
  noteTitle = "",
  chapterId = "",
  sourceChunkIds = [],
} = {}) {
  const safeQuestions = Array.isArray(questions) ? questions : [];
  const fallbackTopic = chapterTitle || quizTitle || "Current Quiz Topic";

  const evaluatedQuestions = safeQuestions.map((question, index) => {
    const userAnswer = getUserAnswer(question, userAnswers, index);
    const correctAnswer = getCorrectAnswer(question);
    const isCorrect = isAnswerCorrect(question, userAnswer, correctAnswer);
    const topic = getTopic(question, fallbackTopic);
    const reviewMeta = getReviewMeta(question, topic);

    const sourceMeta = getQuestionSourceMeta(question, {
      noteId,
      noteTitle,
      chapterId,
      chapterTitle,
      sourceChunkIds,
    });

    return {
      id: getQuestionId(question, index),
      question: getQuestionText(question),
      topic,
      difficulty: question?.difficulty || "Medium",
      userAnswer,
      correctAnswer,
      isCorrect,
      reviewMeta,
      sourceMeta,
      rawQuestion: question,
    };
  });

  const totalQuestions = evaluatedQuestions.length;
  const correctCount = evaluatedQuestions.filter((item) => item.isCorrect).length;

  const latestScore =
    totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  const topicMap = {};

  evaluatedQuestions.forEach((item) => {
    const topicKey = item.topic || fallbackTopic;

    if (!topicMap[topicKey]) {
      topicMap[topicKey] = {
        topic: topicKey,
        total: 0,
        correct: 0,
        questions: [],
        wrongQuestions: [],
        reviewSources: [],
        noteIds: [],
        noteTitles: [],
        chapterIds: [],
        chapterTitles: [],
        sourceChunkIds: [],
      };
    }

    topicMap[topicKey].total += 1;
    topicMap[topicKey].questions.push(item);

    topicMap[topicKey].noteIds.push(item.sourceMeta?.noteId);
    topicMap[topicKey].noteTitles.push(item.sourceMeta?.noteTitle);
    topicMap[topicKey].chapterIds.push(item.sourceMeta?.chapterId);
    topicMap[topicKey].chapterTitles.push(item.sourceMeta?.chapterTitle);

    if (item.reviewMeta?.reviewSource) {
      topicMap[topicKey].reviewSources.push(item.reviewMeta.reviewSource);
    }

    if (item.isCorrect) {
      topicMap[topicKey].correct += 1;
    } else {
      topicMap[topicKey].wrongQuestions.push(item);
      topicMap[topicKey].sourceChunkIds.push(...(item.sourceMeta?.sourceChunkIds || []));
    }
  });

  let weakTopics = Object.values(topicMap)
    .map((item) => {
      const score = Math.round((item.correct / item.total) * 100);
      const wrongCount = item.total - item.correct;
      const priority = getPriority(score, wrongCount);

      const selectedNoteId = firstValue(item.noteIds) || noteId;
      const selectedNoteTitle = firstValue(item.noteTitles) || noteTitle;
      const selectedChapterId = firstValue(item.chapterIds) || chapterId;
      const selectedChapterTitle = firstValue(item.chapterTitles) || chapterTitle;

      const baseReviewSource = pickReviewSource(
        item,
        selectedChapterTitle,
        selectedNoteTitle
      );

      const focusedSourceItems = item.wrongQuestions.length
        ? item.wrongQuestions
        : item.questions;

      const focusedSourceChunkIds = uniqueValues([
        ...item.sourceChunkIds,
        ...focusedSourceItems.flatMap(
          (question) => question.sourceMeta?.sourceChunkIds || []
        ),
      ]);

      const pageNumbers = item.wrongQuestions
        .map((question) => question.reviewMeta)
        .filter(Boolean)
        .flatMap((meta) => [meta.pageFrom, meta.pageTo])
        .filter(Boolean)
        .map(Number)
        .filter((page) => !Number.isNaN(page));

      const pageFrom = pageNumbers.length ? Math.min(...pageNumbers) : "";
      const pageTo = pageNumbers.length ? Math.max(...pageNumbers) : "";

      const reviewSource =
        pageFrom && pageTo
          ? pageFrom === pageTo
            ? `Page ${pageFrom}`
            : `Pages ${pageFrom}-${pageTo}`
          : baseReviewSource;

      const evidenceText = buildWeakTopicEvidenceText(
        item,
        reviewSource,
        focusedSourceItems
      );

      if (!isWeakTopicSourceAligned(item.topic, evidenceText)) {
        return null;
      }

      const safeReason = buildSafeWeakReason(item, reviewSource);
      const recommendedQuizType = getRecommendedQuizType(quizType, priority);

      const askPdfPrompt =
        pageFrom && pageTo
          ? `Explain ${item.topic} using only ${reviewSource} from this uploaded note.`
          : `Explain ${item.topic} from this uploaded note. If possible, mention where this topic appears.`;

      const recommendedSteps =
        pageFrom && pageTo
          ? [
              `Review ${reviewSource}`,
              `Focus on weak topic: ${item.topic}`,
              `Generate 5 ${recommendedQuizType} questions only from ${reviewSource}`,
              "Retry after reviewing your wrong answers",
            ]
          : [
              `Review topic: ${item.topic}`,
              "Source pages were not returned by the backend",
              "Ask PDF where this topic appears in the uploaded note",
              "Generate a focused quiz from this note",
            ];

      return {
        topic: item.topic,
        score,
        total: item.total,
        correct: item.correct,
        wrongCount,
        priority,
        reason: safeReason,

        noteId: selectedNoteId,
        noteTitle: selectedNoteTitle,
        chapterId: selectedChapterId,
        chapterTitle: selectedChapterTitle,

        pageFrom,
        pageTo,
        hasExactPages: Boolean(pageFrom && pageTo),

        reviewSource,
        sourceChunkIds: focusedSourceChunkIds,

        wrongQuestions: item.wrongQuestions.map(buildWrongQuestionPayload),

        recommendation: buildRecommendationText(priority, item.topic),
        recommendedQuizType,
        askPdfPrompt,
        recommendedSteps,
      };
    })
    .filter(Boolean)
    .filter((item) => item.score < 80 || item.wrongCount > 0)
    .sort((a, b) => {
      if (a.priority === "High" && b.priority !== "High") return -1;
      if (a.priority !== "High" && b.priority === "High") return 1;
      if (a.priority === "Medium" && b.priority === "Low") return -1;
      if (a.priority === "Low" && b.priority === "Medium") return 1;
      return b.wrongCount - a.wrongCount;
    })
    .slice(0, 4);

  /*
    Important:
    Only show fallback when all answers are correct.
    If weak topics were rejected because of source/topic mismatch,
    do NOT create a fake fallback weak area.
  */
  if (!weakTopics.length && totalQuestions > 0 && correctCount === totalQuestions) {
    const bestTopic =
      evaluatedQuestions.find((item) => !isGenericTopic(item.topic))?.topic ||
      (!isGenericTopic(fallbackTopic) ? fallbackTopic : "Latest Quiz Topic");

    const reviewSource =
      chapterTitle && !isGenericTopic(chapterTitle)
        ? chapterTitle
        : noteTitle && !isGenericTopic(noteTitle)
          ? noteTitle
          : `Topic: ${bestTopic}`;

    const askPdfPrompt = buildAskPdfPrompt(bestTopic, reviewSource);

    weakTopics = [
      {
        topic: bestTopic,
        score: latestScore,
        total: totalQuestions,
        correct: correctCount,
        wrongCount: totalQuestions - correctCount,
        priority: getPriority(latestScore, totalQuestions - correctCount),

        noteId,
        noteTitle,
        chapterId,
        chapterTitle,
        reviewSource,
        sourceChunkIds: uniqueValues(sourceChunkIds),
        wrongQuestions: [],

        reason:
          "You answered all questions correctly. Do a quick revision to keep the information fresh.",
        recommendation: "Do one short review and generate another quick quiz later.",
        recommendedQuizType: "MCQ",
        askPdfPrompt,
        recommendedSteps: [
          `Quickly review ${reviewSource}`,
          `Ask PDF: "${askPdfPrompt}"`,
          "Generate one short quiz from this note",
          "Keep your score consistent",
        ],
      },
    ];
  }

  const trend = buildScoreTrend(latestScore);
  const improvement = latestScore - trend.previousScore;
  const highPriority = weakTopics.filter((item) => item.priority === "High").length;

  const studyPlan = weakTopics.length
    ? [
        `Review: ${weakTopics[0].reviewSource}`,
        `Ask PDF about: ${weakTopics[0].topic}`,
        `Generate 5 ${weakTopics[0].recommendedQuizType || "MCQ"} questions from this weak part`,
        "Retry the quiz after reviewing",
      ]
    : [
        "Review your wrong answers manually",
        "Ask PDF about the quiz questions you missed",
        "Generate a new focused quiz from the same note",
        "Retry after reviewing",
      ];

  return {
    quizTitle,
    quizType,
    latestScore,
    previousScore: trend.previousScore,
    improvement,
    recommendedFocus: weakTopics[0]?.topic || fallbackTopic,
    totalRecommendations: weakTopics.length + studyPlan.length,
    highPriority,
    completed: correctCount,
    averageScore: latestScore,
    weakTopics,
    studyPlan,
    scoreTrend: trend.scoreTrend,
    evaluatedQuestions,
    aiAdvice: buildAiAdvice({
      weakTopics,
      latestScore,
      improvement,
    }),
  };
}

export function saveRecommendationFromQuiz(payload) {
  const recommendation = buildRecommendationFromQuiz(payload);

  localStorage.setItem(
    "studyflow_recommendation",
    JSON.stringify(recommendation)
  );

  return recommendation;
}