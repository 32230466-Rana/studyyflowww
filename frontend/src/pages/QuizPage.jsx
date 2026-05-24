import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ScreenRecorderMenu from "../components/ScreenRecorderMenu";
const PDF_RAG_URL = "http://127.0.0.1:8016";
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000;
const QUIZ_TIMEOUT_MESSAGE =
  "Quiz generation is taking too long. Please try again with a smaller PDF or lighter model.";

const SAVED_QUIZ_KEY = "studyflow_latest_generated_quiz";
const SAVED_RECOMMENDATION_KEY = "studyflow_latest_quiz_recommendation";
const QUIZ_ERROR_MESSAGES = {
  noResponseText: "Unable to generate quiz: no response text.",
  noQuestionsParsed: "Unable to generate quiz: no questions parsed.",
  questionsParsedButInvalid:
    "Unable to generate quiz: questions parsed but invalid.",
  fewerThanFiveValidQuestions:
    "Unable to generate quiz: fewer than 5 valid questions.",
};

const OPTION_LETTERS = ["A", "B", "C", "D"];
const BANNED_OPTION_PHRASES = [
  "all of the above",
  "none of the above",
  "both a and b",
  "both b and c",
  "both c and d",
  "all options",
];

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasCandidateContent = (value) => {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return value !== null && value !== undefined;
};

const isLikelyQuestionObject = (value) =>
  isPlainObject(value) &&
  ["question", "questionText", "prompt", "stem", "text"].some((key) =>
    hasCandidateContent(value[key])
  ) &&
  ["options", "choices", "answers"].some((key) =>
    hasCandidateContent(value[key])
  );

const jsonContainsQuestions = (value, depth = 0) => {
  if (depth > 4) return false;

  if (Array.isArray(value)) {
    return value.some((item) => isLikelyQuestionObject(item));
  }

  if (!isPlainObject(value)) {
    return false;
  }

  if (Array.isArray(value.questions)) {
    return true;
  }

  return Object.values(value).some((nested) =>
    jsonContainsQuestions(nested, depth + 1)
  );
};

const tryParseJsonCandidate = (candidate) => {
  if (typeof candidate !== "string" || !candidate.trim()) return null;

  try {
    return JSON.parse(candidate.trim());
  } catch {
    return null;
  }
};

const collectBalancedJsonCandidates = (text) => {
  const candidates = [];
  const pairs = [
    ["{", "}"],
    ["[", "]"],
  ];

  pairs.forEach(([open, close]) => {
    for (let start = 0; start < text.length; start += 1) {
      if (text[start] !== open) continue;

      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let index = start; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === "\"") {
            inString = false;
          }
          continue;
        }

        if (char === "\"") {
          inString = true;
          continue;
        }

        if (char === open) depth += 1;
        if (char === close) depth -= 1;

        if (depth === 0) {
          candidates.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  });

  return candidates;
};

const cleanInlineText = (value) =>
  String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/\s+/g, " ")
    .trim();

const cleanQuestionText = (value) =>
  cleanInlineText(value)
    .replace(/^\s*(?:Q(?:uestion)?|Quiz)?\s*\d{1,2}\s*(?:\([^)]*\))?\s*[:.)-]\s*/i, "")
    .replace(/\((?:hard|medium|easy)\)/gi, "")
    .trim();

const tryParseJson = (value) => {
  if (typeof value !== "string") return null;

  const rawText = value.trim();
  if (!rawText) return null;

  const unfencedText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  for (const candidate of [rawText, unfencedText]) {
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  const candidates = [];
  const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fencedMatch;

  while ((fencedMatch = fencedRegex.exec(rawText)) !== null) {
    candidates.push(fencedMatch[1]);
  }

  candidates.push(...collectBalancedJsonCandidates(rawText));

  const parsedCandidates = [];

  for (const candidate of candidates) {
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed === null) continue;

    if (jsonContainsQuestions(parsed)) {
      return parsed;
    }

    parsedCandidates.push(parsed);
  }

  return parsedCandidates[0] || null;
};

const getFirstValue = (source, keys) => {
  if (!isPlainObject(source)) return "";

  for (const key of keys) {
    const value = source[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
};

const normalizeOptionText = (value) =>
  cleanInlineText(value).replace(/^[A-D]\s*[).:-]\s*/i, "").trim();

const normalizeOptions = (options) => {
  const byLetter = {};

  if (isPlainObject(options)) {
    OPTION_LETTERS.forEach((letter) => {
      byLetter[letter] = options[letter] ?? options[letter.toLowerCase()];
    });
  } else if (Array.isArray(options)) {
    options.forEach((option, index) => {
      if (index >= OPTION_LETTERS.length) return;

      if (isPlainObject(option)) {
        const rawLetter = cleanInlineText(
          option.letter ?? option.key ?? option.id ?? OPTION_LETTERS[index]
        ).toUpperCase();
        const letter = OPTION_LETTERS.includes(rawLetter)
          ? rawLetter
          : OPTION_LETTERS[index];

        byLetter[letter] =
          option.text ?? option.option ?? option.value ?? option.content ?? "";
        return;
      }

      byLetter[OPTION_LETTERS[index]] = option;
    });
  }

  const normalized = OPTION_LETTERS.map((letter) => ({
    letter,
    text: normalizeOptionText(byLetter[letter]),
  }));

  if (normalized.some((option) => option.text.length < 2)) {
    return { options: [], reason: "Each question must have four non-empty options A-D." };
  }

  if (
    normalized.some((option) =>
      BANNED_OPTION_PHRASES.some((phrase) =>
        option.text.toLowerCase().includes(phrase)
      )
    )
  ) {
    return { options: [], reason: "Options cannot include All/None/Both of the above." };
  }

  if (
    normalized.some(
      (option) =>
        /Correct\s*answer\s*:/i.test(option.text) ||
        /Explanation\s*:/i.test(option.text)
    )
  ) {
    return { options: [], reason: "An option contains answer or explanation text." };
  }

  const uniqueOptions = new Set(
    normalized.map((option) => option.text.trim().toLowerCase())
  );
  if (uniqueOptions.size !== OPTION_LETTERS.length) {
    return { options: [], reason: "Options must be four unique choices." };
  }

  return { options: normalized, reason: "" };
};

const normalizeQuestionItem = (rawItem, index) => {
  if (!isPlainObject(rawItem)) {
    return { question: null, reason: `Question ${index + 1} is not an object.` };
  }

  const questionText = cleanQuestionText(
    getFirstValue(rawItem, ["question", "questionText", "prompt", "stem", "text"])
  );

  if (
    !questionText ||
    /^[A-D]\s*[).:-]/i.test(questionText) ||
    /^(?:answer|correct answer|explanation)\b/i.test(questionText) ||
    /\b(?:correct\s*)?answer\s*:|Explanation\s*:/i.test(questionText)
  ) {
    return {
      question: null,
      reason: `Question ${index + 1} is missing real question text.`,
    };
  }

  const { options, reason: optionsReason } = normalizeOptions(
    rawItem.options ?? rawItem.choices ?? rawItem.answers
  );

  if (options.length !== OPTION_LETTERS.length) {
    return {
      question: null,
      reason: `Question ${index + 1}: ${optionsReason}`,
    };
  }

  const rawCorrectAnswer = getFirstValue(rawItem, [
    "correctAnswer",
    "correct_answer",
    "correct",
    "answer",
    "solution",
  ]);
  const correctAnswer = normalizeAnswerLetter(rawCorrectAnswer, options);

  if (!/^[A-D]$/.test(correctAnswer)) {
    return {
      question: null,
      reason: `Question ${index + 1} must have correctAnswer as A, B, C, or D only.`,
    };
  }

  const explanation = cleanInlineText(
    getFirstValue(rawItem, ["explanation", "reason", "rationale"])
  );

  return {
    question: {
      id: `q-${index + 1}`,
      number: String(index + 1),
      question: questionText,
      options,
      correctAnswer,
      explanation: explanation.slice(0, 300),
      userAnswer: null,
    },
    reason: "",
  };
};

const normalizeQuestionItems = (items) => {
  const invalidReasons = [];
  const validQuestions = [];
  const seenQuestions = new Set();

  items.forEach((item, index) => {
    const normalized = normalizeQuestionItem(item, index);

    if (!normalized.question) {
      invalidReasons.push(normalized.reason);
      return;
    }

    const questionKey = normalized.question.question
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    if (seenQuestions.has(questionKey)) {
      invalidReasons.push(`Question ${index + 1} is a duplicate question.`);
      return;
    }

    seenQuestions.add(questionKey);
    validQuestions.push({
      ...normalized.question,
      id: `q-${validQuestions.length + 1}`,
      number: String(validQuestions.length + 1),
    });
  });

  const firstFiveQuestions = validQuestions.slice(0, 5);
  let failureType = "";
  let reason = "";

  if (items.length === 0) {
    failureType = "no-questions-parsed";
    reason = "No questions parsed from the response.";
  } else if (validQuestions.length === 0) {
    failureType = "questions-parsed-but-invalid";
    reason = invalidReasons[0] || "Questions parsed but invalid.";
  } else if (validQuestions.length < 5) {
    failureType = "fewer-than-5-valid-questions";
    reason = `Only ${validQuestions.length} valid question(s) were parsed.`;
  }

  return {
    questions: firstFiveQuestions,
    reason,
    failureType,
    parsedCount: items.length,
    validCount: validQuestions.length,
    invalidReasons,
    responseTextFound: true,
  };
};

const findQuestionItems = (payload, depth = 0) => {
  if (depth > 3) return null;

  if (typeof payload === "string") {
    const parsed = tryParseJson(payload);
    return parsed ? findQuestionItems(parsed, depth + 1) : null;
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isPlainObject(payload)) {
    return null;
  }

  if (Array.isArray(payload.questions)) {
    return payload.questions;
  }

  for (const key of [
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
  ]) {
    if (hasCandidateContent(payload[key])) {
      const nested = findQuestionItems(payload[key], depth + 1);
      if (nested) return nested;
    }
  }

  return null;
};

const parseJsonMcqQuiz = (payload) => {
  const items = findQuestionItems(payload);

  if (!items) {
    return {
      questions: [],
      reason: "No JSON questions array found.",
      failureType: "no-questions-parsed",
      parsedCount: 0,
      validCount: 0,
      invalidReasons: [],
      responseTextFound: hasCandidateContent(payload),
    };
  }

  if (!Array.isArray(items)) {
    return {
      questions: [],
      reason: "Parsed quiz questions are not an array.",
      failureType: "questions-parsed-but-invalid",
      parsedCount: 1,
      validCount: 0,
      invalidReasons: ["Parsed quiz questions are not an array."],
      responseTextFound: true,
    };
  }

  return normalizeQuestionItems(items);
};

const parsePlainTextMcqQuiz = (payload) => {
  const raw = String(payload || "");

  if (!raw.trim()) {
    return {
      questions: [],
      reason: "No response text found in the quiz response.",
      failureType: "no-response-text",
      parsedCount: 0,
      validCount: 0,
      invalidReasons: [],
      responseTextFound: false,
    };
  }

  let cleaned = raw
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/Correct\s*Answer\s*:/gi, "Correct answer:")
    .replace(/CorrectAnswer\s*:/gi, "Correct answer:")
    .replace(/^\s*Answer\s*[-:]\s*/gim, "Answer: ")
    .replace(/^\s*Explanation\s*[-:]\s*/gim, "Explanation: ")
    .trim();

  cleaned = cleaned
    .replace(
      /(?:^|\n)\s*(?:Question|Quiz)\s*(\d{1,2})\s*(?:\([^)]*\))?\s*[:.)-]\s*/gi,
      "\nQ$1: "
    )
    .replace(
      /(?:^|\n)\s*Q\s*(\d{1,2})\s*(?:\([^)]*\))?\s*[:.)-]\s*/gi,
      "\nQ$1: "
    )
    .replace(/(?:^|\n)\s*(\d{1,2})\s*[.)-]\s+(?=\S)/g, "\nQ$1: ")
    .replace(/([^\n])\s+(Q\d{1,2}\s*:)/gi, "$1\n$2")
    .replace(/([^\n])\s+([A-D])\s*[).:-]\s+/g, "$1\n$2. ")
    .replace(/(?:^|\n)\s*(?:[-*]\s*)?([A-D])\s*[).:-]\s+/gi, "\n$1. ")
    .replace(/([^\n])\s+(Correct\s*answer\s*:)/gi, "$1\n$2")
    .replace(
      /(?:^|\n)\s*(?:Correct\s*answer|Answer)\s*[:-]\s*(?:option\s*)?([A-D])\b[^\n]*/gi,
      "\nCorrect answer: $1"
    )
    .replace(/([^\n])\s+(Explanation\s*:)/gi, "$1\n$2")
    .trim();

  const firstQuestionIndex = cleaned.search(/(?:^|\n)\s*Q1\s*:/i);
  if (firstQuestionIndex > 0) {
    cleaned = cleaned.slice(firstQuestionIndex).trim();
  }

  const headerRegex = /(?:^|\n)\s*Q(\d{1,2})\s*:\s*/gi;
  const headers = [];
  let headerMatch;

  while ((headerMatch = headerRegex.exec(cleaned)) !== null) {
    headers.push({
      number: headerMatch[1],
      start: headerMatch.index,
      bodyStart: headerRegex.lastIndex,
    });
  }

  if (headers.length === 0) {
    return {
      questions: [],
      reason: "No plain text question blocks were found.",
      failureType: "no-questions-parsed",
      parsedCount: 0,
      validCount: 0,
      invalidReasons: [],
      responseTextFound: true,
    };
  }

  const rawItems = headers.map((header, index) => {
    const nextStart =
      index + 1 < headers.length ? headers[index + 1].start : cleaned.length;
    const block = cleaned.slice(header.bodyStart, nextStart).trim();
    const optionRegex =
      /(?:^|\n)\s*(?:[-*]\s*)?([A-D])\s*[).:-]\s*([\s\S]*?)(?=(?:^|\n)\s*(?:[-*]\s*)?[A-D]\s*[).:-]\s*|(?:^|\n)\s*(?:Correct\s*answer|Answer)\s*[:-]|(?:^|\n)\s*Explanation\s*[:-]|$)/gi;
    const options = {};
    const optionMatches = [];
    let optionMatch;

    while ((optionMatch = optionRegex.exec(block)) !== null) {
      const letter = optionMatch[1].toUpperCase();
      options[letter] = optionMatch[2].trim();
      optionMatches.push(optionMatch);
    }

    const firstOptionIndex =
      optionMatches.length > 0 ? optionMatches[0].index : block.length;
    const questionText = block.slice(0, firstOptionIndex).trim();
    const answerMatch = block.match(
      /(?:^|\n)\s*(?:Correct\s*answer|Answer)\s*[:-]\s*(?:option\s*)?([A-D])\b/i
    );
    const explanationMatch = block.match(
      /(?:^|\n)\s*Explanation\s*[:-]\s*([\s\S]*)$/i
    );

    return {
      question: questionText,
      options,
      correctAnswer: answerMatch?.[1] || "",
      explanation: explanationMatch?.[1]?.trim() || "",
    };
  });

  return normalizeQuestionItems(rawItems);
};

const parseMcqQuizWithReason = (payload) => {
  try {
    const parsedJson = typeof payload === "string" ? tryParseJson(payload) : payload;
    let jsonResult = null;

    if (parsedJson && (Array.isArray(parsedJson) || isPlainObject(parsedJson))) {
      jsonResult = parseJsonMcqQuiz(parsedJson);
      if (jsonResult.questions.length >= 5 || typeof payload !== "string") {
        return jsonResult;
      }
    }

    if (typeof payload === "string") {
      const textResult = parsePlainTextMcqQuiz(payload);
      if (!jsonResult) return textResult;
      if (textResult.questions.length >= 5) return textResult;

      const jsonScore = (jsonResult.validCount || 0) * 100 + (jsonResult.parsedCount || 0);
      const textScore = (textResult.validCount || 0) * 100 + (textResult.parsedCount || 0);
      return textScore > jsonScore ? textResult : jsonResult;
    }

    return {
      questions: [],
      reason: "Extracted quiz payload is not a JSON quiz or plain text quiz.",
      failureType: "no-questions-parsed",
      parsedCount: 0,
      validCount: 0,
      invalidReasons: [],
      responseTextFound: hasCandidateContent(payload),
    };
  } catch (error) {
    return {
      questions: [],
      reason: error?.message || "Quiz parser failed.",
      failureType: "questions-parsed-but-invalid",
      parsedCount: 0,
      validCount: 0,
      invalidReasons: [error?.message || "Quiz parser failed."],
      responseTextFound: hasCandidateContent(payload),
    };
  }
};

const parseMcqQuiz = (payload) => parseMcqQuizWithReason(payload).questions;

const getQuizErrorMessage = (parsed) => {
  if (parsed?.failureType === "no-response-text") {
    return QUIZ_ERROR_MESSAGES.noResponseText;
  }

  if (parsed?.failureType === "questions-parsed-but-invalid") {
    return QUIZ_ERROR_MESSAGES.questionsParsedButInvalid;
  }

  if (parsed?.failureType === "fewer-than-5-valid-questions") {
    return QUIZ_ERROR_MESSAGES.fewerThanFiveValidQuestions;
  }

  return QUIZ_ERROR_MESSAGES.noQuestionsParsed;
};

const serializeQuizForStorage = (questions) =>
  JSON.stringify(
    {
      questions: questions.map((question) => ({
        question: question.question,
        options: question.options.reduce((acc, option) => {
          acc[option.letter] = option.text;
          return acc;
        }, {}),
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
      })),
    },
    null,
    2
  );

const getPathValue = (source, path) =>
  path.reduce(
    (value, key) =>
      value !== null && value !== undefined ? value[key] : undefined,
    source
  );

const describeResponseShape = (value, depth = 0) => {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      first: depth < 1 ? describeResponseShape(value[0], depth + 1) : undefined,
    };
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    return {
      type: "object",
      keys,
      fields:
        depth < 1
          ? keys.slice(0, 12).reduce((acc, key) => {
              acc[key] = describeResponseShape(value[key], depth + 1);
              return acc;
            }, {})
          : undefined,
    };
  }

  if (typeof value === "string") {
    return {
      type: "string",
      length: value.length,
      preview: value.slice(0, 120),
    };
  }

  return { type: typeof value };
};

const extractQuizPayload = (quizData) => {
  const paths = [
    ["questions"],
    ["data", "questions"],
    ["quiz", "questions"],
    ["data", "quiz", "questions"],
    ["data", "data", "questions"],
    ["data", "answer", "questions"],
    ["data", "answer", "answer"],
    ["data", "answer"],
    ["data", "quiz"],
    ["data", "data"],
    ["data"],
    ["answer", "questions"],
    ["answer", "answer"],
    ["answer"],
    ["quiz", "answer"],
    ["quiz", "data"],
    ["quiz"],
    ["quiz_text"],
    ["generated_quiz"],
    ["generated_text"],
    ["output"],
    ["response"],
    ["text"],
    ["quiz"],
    ["result", "questions"],
    ["result", "answer", "answer"],
    ["result", "answer"],
    ["result", "quiz_text"],
    ["result", "generated_quiz"],
    ["result", "generated_text"],
    ["result", "output"],
    ["result", "response"],
    ["result", "text"],
    ["result"],
    [],
  ];

  let bestRejected = null;
  let bestRejectedScore = -1;

  for (const path of paths) {
    const payload = path.length ? getPathValue(quizData, path) : quizData;
    if (!hasCandidateContent(payload)) continue;

    const parsed = parseMcqQuizWithReason(payload);
    const candidate = {
      path: path.length ? path.join(".") : "root",
      payload,
      parsed,
    };

    if (parsed.questions.length === 5) {
      return candidate;
    }

    const rejectedScore =
      (parsed.validCount || parsed.questions.length || 0) * 100 +
      (parsed.parsedCount || 0);
    if (rejectedScore > bestRejectedScore) {
      bestRejected = candidate;
      bestRejectedScore = rejectedScore;
    }
  }

  return (
    bestRejected || {
      path: "none",
      payload: "",
      parsed: {
        questions: [],
        reason: "No quiz payload field was found.",
        failureType: "no-response-text",
        parsedCount: 0,
        validCount: 0,
        invalidReasons: [],
        responseTextFound: false,
      },
    }
  );
};

const normalizeAnswerLetter = (value, options = []) => {
  if (value === null || value === undefined) return "";

  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= 0 && value < OPTION_LETTERS.length) {
      return OPTION_LETTERS[value];
    }
    if (value >= 1 && value <= OPTION_LETTERS.length) {
      return OPTION_LETTERS[value - 1];
    }
  }

  if (isPlainObject(value)) {
    const objectLetter = normalizeAnswerLetter(
      value.letter ?? value.key ?? value.id ?? value.answer,
      options
    );
    if (objectLetter) return objectLetter;

    return normalizeAnswerLetter(
      value.text ?? value.option ?? value.value ?? value.content,
      options
    );
  }

  const raw = cleanInlineText(value);
  if (!raw) return "";

  const compact = raw.toUpperCase();
  if (/^[A-D]$/.test(compact)) return compact;

  const prefixedLetter = raw.match(/^\s*(?:option\s*)?([A-D])\s*[).:-]\s+/i);
  if (prefixedLetter) return prefixedLetter[1].toUpperCase();

  const normalizedRawText = normalizeOptionText(raw).toLowerCase();
  const matchedOption = options.find(
    (option) =>
      normalizeOptionText(option?.text).toLowerCase() === normalizedRawText
  );

  return matchedOption?.letter || "";
};

export default function QuizPage() {
  const fileInputRef = useRef(null);
  const activeRequestIdRef = useRef(0);
  const navigate = useNavigate();

  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedModel, setSelectedModel] = useState("qwen2.5:1.5b");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [quizText, setQuizText] = useState("");
  const [sources, setSources] = useState([]);
  const [quizPdfName, setQuizPdfName] = useState("");
  const [, setQuizCreatedAt] = useState("");
  const [uploadedPdfId, setUploadedPdfId] = useState("");
  const [status, setStatus] = useState("Upload a PDF file to get started.");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeMode, setThemeMode] = useState("light");

  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem(SAVED_QUIZ_KEY);
      if (!savedRaw) return;

      const saved = JSON.parse(savedRaw);
      const savedQuizText = typeof saved?.quizText === "string" ? saved.quizText : "";
      if (!savedQuizText.trim()) {
        localStorage.removeItem(SAVED_QUIZ_KEY);
        return;
      }

      if (parseMcqQuiz(savedQuizText).length !== 5) {
        localStorage.removeItem(SAVED_QUIZ_KEY);
        setQuizText("");
        setSources([]);
        return;
      }

      setQuizText(savedQuizText);
      setSources(Array.isArray(saved?.sources) ? saved.sources : []);
      setQuizPdfName(typeof saved?.pdfName === "string" ? saved.pdfName : "");
      setQuizCreatedAt(typeof saved?.createdAt === "string" ? saved.createdAt : "");

      const restoredLabel = saved?.pdfName
        ? `Restored last quiz: ${saved.pdfName}`
        : "Restored last quiz.";
      setStatus(restoredLabel);
    } catch {
      try {
        localStorage.removeItem(SAVED_QUIZ_KEY);
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPdfPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(selectedFile);
    setPdfPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const parsedQuestions = useMemo(() => {
    return parseMcqQuiz(quizText);
  }, [quizText]);
  const hasValidQuiz = parsedQuestions.length === 5;

  useEffect(() => {
    setSelectedAnswers({});
    setSubmitted(false);
  }, [quizText]);

  const answeredCount = parsedQuestions.filter(
    (q) => selectedAnswers[q.id]
  ).length;

  const handleSelectAnswer = (questionId, letter) => {
    if (submitted) return;

    setSelectedAnswers((prev) => ({
      ...prev,
      [questionId]: letter,
    }));
  };

  const handleSubmitAnswers = () => {
    if (!hasValidQuiz || answeredCount !== parsedQuestions.length) return;

    const total = parsedQuestions.length;
    const gradedQuestions = parsedQuestions.map((q, index) => {
      const selectedAnswerRaw = selectedAnswers[q.id];
      const correctAnswerRaw = q.correctAnswer;
      const normalizedSelectedLetter = normalizeAnswerLetter(
        selectedAnswerRaw,
        q.options
      );
      const normalizedCorrectLetter = normalizeAnswerLetter(
        correctAnswerRaw,
        q.options
      );
      const isCorrect = normalizedSelectedLetter === normalizedCorrectLetter;

      console.log("QUIZ GRADE CHECK", {
        question: q.question,
        options: q.options,
        selectedAnswerRaw,
        correctAnswerRaw,
        normalizedSelectedLetter,
        normalizedCorrectLetter,
        isCorrect,
      });

      return {
        q,
        index,
        selectedAnswerRaw,
        correctAnswerRaw,
        normalizedSelectedLetter,
        normalizedCorrectLetter,
        isCorrect,
      };
    });

    const correct = gradedQuestions.filter((item) => item.isCorrect).length;

    const wrongQuestions = gradedQuestions
  .map((item) => {
    const { q, index, normalizedSelectedLetter, normalizedCorrectLetter } = item;

    const selectedOption = q.options.find(
      (option) =>
        normalizeAnswerLetter(option.letter, q.options) === normalizedSelectedLetter
    );

    const correctOption = q.options.find(
      (option) =>
        normalizeAnswerLetter(option.letter, q.options) === normalizedCorrectLetter
    );

    return {
      number: index + 1,
      question: q.question,
      selectedAnswer: normalizedSelectedLetter,
      selectedAnswerText: selectedOption?.text || "",
      correctAnswer: normalizedCorrectLetter,
      correctAnswerText: correctOption?.text || "",
      explanation: q.explanation,
      isWrong: !item.isCorrect,
    };
  })
  .filter((item) => item.isWrong);
    const percentage = total ? Math.round((correct / total) * 100) : 0;

    const recommendationPayload = {
      type: "quiz",
      title: selectedFile?.name || quizPdfName || "Generated Quiz",
      pdfName: selectedFile?.name || quizPdfName || "",
      quizText,
      sources,
      score: correct,
      total,
      percentage,
      weakQuestions: wrongQuestions,
      message:
        percentage >= 80
          ? "Great work. Review only the few missed points."
          : percentage >= 60
          ? "Good progress. Focus on the questions you answered incorrectly."
          : "You need more review. Start with the weak questions below.",
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem(
      SAVED_RECOMMENDATION_KEY,
      JSON.stringify(recommendationPayload)
    );

    setSubmitted(true);
  };

  function handleFile(file) {
    if (!file) return;

    const allowed =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

    if (!allowed) {
      setError("Please upload a PDF file only.");
      setSelectedFile(null);
      return;
    }

    activeRequestIdRef.current = Date.now();

    setError("");
    setQuizText("");
    setSources([]);
    setUploadedPdfId("");
    setSelectedAnswers({});
    setSubmitted(false);
    setSelectedFile(file);
    setQuizPdfName(file.name);
    setStatus(`Selected: ${file.name}`);
  }
  const getCachedPdf = (fileName) => {
  try {
    const cache = JSON.parse(localStorage.getItem("studyflow_pdf_cache") || "{}");
    return cache[fileName] || null;
  } catch {
    return null;
  }
};

const saveCachedPdf = (fileName, pdfId) => {
  try {
    const cache = JSON.parse(localStorage.getItem("studyflow_pdf_cache") || "{}");

    cache[fileName] = {
      pdfId,
      savedAt: Date.now(),
    };

    localStorage.setItem(
      "studyflow_pdf_cache",
      JSON.stringify(cache)
    );
  } catch (e) {
    console.error(e);
  }
};

  async function generateQuiz() {
    if (loading) return;

    if (!selectedFile) {
      setError("Please choose a PDF first.");
      return;
    }

    const requestId = Date.now();
    activeRequestIdRef.current = requestId;

    setLoading(true);
    setError("");
    setQuizText("");
    setSources([]);
    setSelectedAnswers({});
    setSubmitted(false);
    setStatus(uploadedPdfId ? "Using cached PDF..." : "Uploading PDF...");

    const fetchWithFrontendTimeout = (url, options = {}) => {
      let timeoutId;

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(QUIZ_TIMEOUT_MESSAGE));
        }, GENERATION_TIMEOUT_MS);
      });

      return Promise.race([
        fetch(url, { ...options }),
        timeoutPromise,
      ]).finally(() => {
        clearTimeout(timeoutId);
      });
    };

    try {
      let pdfId = uploadedPdfId;

      if (!pdfId && selectedFile) {
        const cached = getCachedPdf(selectedFile.name);
        if (cached?.pdfId) {
          pdfId = cached.pdfId;
          setUploadedPdfId(pdfId);
          setStatus("Using saved PDF cache...");
        }
      }

      if (!pdfId) {
        const formData = new FormData();
        formData.append("file", selectedFile);

        const uploadResponse = await fetchWithFrontendTimeout(
          `${PDF_RAG_URL}/api/v1/pdfs/upload`,
          {
            method: "POST",
            body: formData,
          }
        );

        if (!uploadResponse.ok) {
          const text = await uploadResponse.text();
          throw new Error(`PDF upload failed: ${text}`);
        }

        const uploadData = await uploadResponse.json();
        console.log("UPLOAD DATA", uploadData);

        pdfId =
          uploadData.pdf_id ||
          uploadData.doc_id ||
          uploadData.docId ||
          uploadData.document_id ||
          uploadData.id;

        if (!pdfId) {
          throw new Error("PDF uploaded, but no pdf_id/doc_id/docId/document_id/id was returned.");
        }

        setUploadedPdfId(pdfId);
        saveCachedPdf(selectedFile.name, pdfId);
      }

      console.log("PDF ID USED", pdfId);

      const promptText = `
Create a lightweight quiz from the uploaded PDF content.
Return valid JSON only.
No markdown.
No extra text before or after JSON.

Use exactly this JSON shape:
{
  "questions": [
    {
      "question": "Question text",
      "options": {
        "A": "short option",
        "B": "short option",
        "C": "short option",
        "D": "short option"
      },
      "correctAnswer": "A",
      "explanation": "short explanation"
    }
  ]
}

Rules:
- Generate exactly 5 MCQs.
- Use only the uploaded PDF content.
- Return valid JSON only.
- No markdown.
- No extra text before or after JSON.
- correctAnswer must be A, B, C, or D only.
- Put the answer only in correctAnswer; do not reveal it in the question or option text.
- Do not create duplicate questions.
- Do not create duplicate or near-duplicate options.
- Each question must have exactly four options: A, B, C, and D.
- Keep questions, options, and explanations short for local Ollama llama3.2:3b on 8GB RAM.
${customPrompt.trim() ? `- Focus topic: ${customPrompt.trim()}` : ""}
`.trim();

      const EXTRACT_QUIZ_TEXT = (quizData) => {
        console.log("RAW QUIZ DATA:", quizData);

        const candidates = [
          quizData.quiz_text,
          quizData.generated_quiz,
          quizData.generated_text,
          quizData.output,
          quizData.response,
          quizData.answer,
          quizData.text,
          quizData.quiz,
          quizData.data?.quiz_text,
          quizData.data?.generated_quiz,
          quizData.data?.generated_text,
          quizData.data?.output,
          quizData.data?.response,
          quizData.data?.answer,
          quizData.data?.text,
          quizData.result?.quiz_text,
          quizData.result?.generated_quiz,
          quizData.result?.generated_text,
          quizData.result?.output,
          quizData.result?.response,
          quizData.result?.answer,
          quizData.result?.text,
          quizData.result,
        ];

        const normalizeText = (value) => {
          if (!value) return "";
          if (typeof value === "string") return value.trim();
          if (typeof value === "object") return JSON.stringify(value, null, 2);
          return String(value).trim();
        };

        const texts = candidates.map(normalizeText).filter(Boolean);

        const looksLikeMcq = (text) => {
          const hasQ1 =
            /(?:^|\n)\s*(?:Q\s*1|Quiz\s*1|Question\s*1)\s*(?:\([^)]+\))?\s*[:.)-]/i.test(
              text
            );

          const hasOptionA =
            /\n\s*(?:[-*•]\s*)?A\s*[.)]/i.test(text);

          const hasCorrect = /Correct\s*answer\s*:/i.test(text);

          return hasQ1 && hasOptionA && hasCorrect;
        };

        const mcqText = texts.find(looksLikeMcq);

        if (mcqText) {
          return mcqText
            .replace(
              /^.*?(?=(?:^|\n)\s*(?:Q\s*1|Quiz\s*1|Question\s*1)\s*(?:\([^)]+\))?\s*[:.)-])/is,
              ""
            )
            .trim();
        }

        return texts[0] || "";
      };

      setStatus("Generating 5 MCQs from the PDF...");

      const queryPayload = {
        question: promptText,
        model: selectedModel,
        pdf_ids: [pdfId],
      };

      console.log("QUERY PAYLOAD", queryPayload);

      const quizResponse = await fetchWithFrontendTimeout(`${PDF_RAG_URL}/api/v1/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(queryPayload),
      });

      if (!quizResponse.ok) {
        const text = await quizResponse.text();
        throw new Error(`Quiz generation failed: ${text}`);
      }

      const quizResponseText = await quizResponse.text();
      let quizData;

      try {
        quizData = JSON.parse(quizResponseText);
      } catch {
        quizData = { answer: quizResponseText };
      }

      console.log("QUERY RESPONSE", quizData);
      console.log("RAW RESPONSE SHAPE", describeResponseShape(quizData));
      console.log("RESPONSE SHAPE res.data", describeResponseShape(quizData));
      console.log("RESPONSE SHAPE res.data.answer", describeResponseShape(quizData?.answer));
      console.log("RESPONSE SHAPE res.data.data", describeResponseShape(quizData?.data));
      console.log(
        "RESPONSE SHAPE res.data.questions",
        describeResponseShape(quizData?.questions)
      );

      const extractedQuiz = extractQuizPayload(quizData);
      const rawQuizPayload = extractedQuiz.payload;
      console.log("EXTRACTED RAW QUIZ PAYLOAD", {
        path: extractedQuiz.path,
        payload: rawQuizPayload,
      });
      console.log(
        "RESPONSE SHAPE rawQuizPayload",
        describeResponseShape(rawQuizPayload)
      );

      if (activeRequestIdRef.current !== requestId) {
        return;
      }

      const parsedGeneratedQuiz = extractedQuiz.parsed.questions;
      console.log("PARSED QUESTION COUNT", extractedQuiz.parsed.parsedCount || 0);
      console.log("VALID QUESTION COUNT", parsedGeneratedQuiz.length);

      if (parsedGeneratedQuiz.length !== 5) {
        console.warn("QUIZ REJECTION REASON", {
          path: extractedQuiz.path,
          reason: extractedQuiz.parsed.reason,
          failureType: extractedQuiz.parsed.failureType,
          parsedCount: extractedQuiz.parsed.parsedCount || 0,
          validCount: extractedQuiz.parsed.validCount || parsedGeneratedQuiz.length,
          invalidReasons: extractedQuiz.parsed.invalidReasons || [],
        });
        setQuizText("");
        setSources([]);
        try {
          localStorage.removeItem(SAVED_QUIZ_KEY);
        } catch {
          // ignore
        }

        throw new Error(getQuizErrorMessage(extractedQuiz.parsed));
      }

      const generatedQuiz = serializeQuizForStorage(parsedGeneratedQuiz);
      setQuizText(generatedQuiz);

      const responseSources = quizData.sources || quizData.result?.sources || [];
      setSources(responseSources);

      const createdAt = new Date().toISOString();
      setQuizCreatedAt(createdAt);
      setQuizPdfName(selectedFile?.name || quizPdfName || "");

      try {
        localStorage.setItem(
          SAVED_QUIZ_KEY,
          JSON.stringify({
            pdfName: selectedFile?.name || quizPdfName || "",
            quizText: generatedQuiz,
            sources: responseSources,
            createdAt,
          })
        );
      } catch {
        // Ignore localStorage write failures.
      }

      setStatus("Quiz generated successfully.");

      setLoading(false);
    } catch (err) {
      if (activeRequestIdRef.current !== requestId) {
        setLoading(false);
        return;
      }

      console.error(err);
      const message =
        err.message === QUIZ_TIMEOUT_MESSAGE
          ? QUIZ_TIMEOUT_MESSAGE
          : err.message || "Something went wrong while generating the quiz.";

      setError(message);
      setStatus(
        err.message === QUIZ_TIMEOUT_MESSAGE
          ? "Quiz generation timed out."
          : "Failed to generate quiz."
      );
      setLoading(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`quiz-page ${themeMode === "dark" ? "dark-mode" : ""}`}>
      <style>{`
        .quiz-page {
          width: 100%;
          min-height: 100vh;
          background: #ffffff;
          color: #1f2937;
          padding: 0;
        }

        .streamlit-shell {
          width: 100%;
          min-height: 100vh;
          background: #ffffff;
          display: flex;
          flex-direction: column;
        }

        .streamlit-topbar {
          height: 58px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #e5e7eb;
          padding: 0 18px;
          background: #ffffff;
          position: sticky;
          top: 0;
          z-index: 5;
        }

        .topbar-left {
          display: flex;
          align-items: center;
          gap: 12px;
          font-weight: 800;
          color: #111827;
        }

        .collapse-icon {
          border: none;
          background: transparent;
          font-size: 24px;
          color: #64748b;
          cursor: pointer;
        }

        .topbar-actions {
          display: flex;
          align-items: center;
          gap: 14px;
          color: #111827;
          font-size: 14px;
        }

        .topbar-menu {
          border: none;
          background: transparent;
          font-size: 24px;
          cursor: pointer;
          color: #111827;
        }

        .streamlit-body {
          display: grid;
          grid-template-columns: 260px 1fr;
          min-height: calc(100vh - 58px);
        }

        .loaded-sidebar {
          background: #f4f7fb;
          border-right: 1px solid #e5e7eb;
          padding: 28px 18px;
        }

        .sidebar-section-title {
          font-size: 15px;
          font-weight: 800;
          margin-bottom: 18px;
          color: #111827;
        }

        .metric-card {
          margin-bottom: 22px;
        }

        .metric-label {
          color: #475569;
          font-size: 13px;
          margin-bottom: 8px;
        }

        .metric-value {
          font-size: 34px;
          color: #111827;
          font-weight: 500;
        }

        .pdf-expander {
          margin: 26px 0;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #ffffff;
          padding: 12px;
          color: #111827;
          font-size: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .delete-all-btn {
          border: 1px solid #d1d5db;
          background: #ffffff;
          color: #111827;
          border-radius: 8px;
          padding: 11px 14px;
          cursor: pointer;
          font-weight: 600;
        }

        .main-workspace {
          padding: 38px 40px 70px;
          max-width: 1180px;
          width: 100%;
          margin: 0 auto;
        }

        .page-title {
          font-size: 30px;
          font-weight: 800;
          color: #111827;
          margin: 0;
          padding-bottom: 12px;
          border-bottom: 2px solid #cbd5e1;
        }

        .main-grid {
          display: grid;
          grid-template-columns: minmax(310px, 0.95fr) minmax(420px, 1.25fr);
          gap: 28px;
          margin-top: 22px;
          align-items: start;
        }

        .left-column,
        .right-column {
          min-width: 0;
        }

        .toggle-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 18px;
          color: #111827;
          font-size: 14px;
        }

        .fake-toggle {
          width: 36px;
          height: 20px;
          background: #d1d5db;
          border-radius: 999px;
          position: relative;
          flex: 0 0 auto;
          margin-top: 2px;
        }

        .fake-toggle::after {
          content: "";
          width: 16px;
          height: 16px;
          background: #ffffff;
          border-radius: 50%;
          position: absolute;
          top: 2px;
          left: 2px;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
        }

        .upload-label,
        .model-label {
          display: block;
          color: #111827;
          font-size: 14px;
          margin-bottom: 8px;
          font-weight: 500;
        }

        .upload-card {
          background: #eef2f7;
          border-radius: 8px;
          padding: 18px;
          min-height: 106px;
          display: flex;
          align-items: center;
          gap: 14px;
          cursor: pointer;
          transition: 0.2s ease;
          border: 1px solid transparent;
        }

        .upload-card:hover {
          border-color: #cbd5e1;
          background: #e8edf5;
        }

        .cloud-icon {
          font-size: 34px;
          color: #8aa1c2;
        }

        .upload-main-text {
          color: #1f2937;
          font-size: 15px;
          line-height: 1.35;
        }

        .upload-sub-text {
          color: #64748b;
          font-size: 12px;
          margin-top: 4px;
        }

        .browse-btn {
          margin-left: auto;
          background: #ffffff;
          border: 1px solid #d1d5db;
          color: #111827;
          border-radius: 8px;
          padding: 13px 16px;
          font-weight: 600;
          cursor: pointer;
        }

        .file-pill {
          margin-top: 14px;
          background: #fce7e7;
          color: #334155;
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          max-width: 100%;
          font-size: 13px;
        }

        .file-icon {
          width: 32px;
          height: 32px;
          border-radius: 7px;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .file-pill strong {
          color: #334155;
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 180px;
        }

        .file-pill small {
          color: #64748b;
        }

        .plus-line {
          margin-top: 12px;
          color: #64748b;
          font-size: 24px;
        }

        .info-box {
          background: #e8f3ff;
          color: #075985;
          border-radius: 8px;
          padding: 18px;
          margin-top: 16px;
          line-height: 1.6;
          font-size: 15px;
        }

        .delete-btn {
          margin-top: 18px;
          border: 1px solid #d1d5db;
          background: #ffffff;
          color: #111827;
          border-radius: 8px;
          padding: 11px 14px;
          cursor: pointer;
          font-weight: 600;
        }

        .zoom-row {
          margin-top: 22px;
        }

        .zoom-label {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          color: #334155;
          margin-bottom: 8px;
        }

        .zoom-range {
          width: 100%;
          accent-color: #ff4b4b;
        }

        .pdf-preview-box {
          margin-top: 16px;
          height: 420px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #ffffff;
          overflow: hidden;
        }

        .pdf-preview-box iframe {
          width: 100%;
          height: 100%;
          border: 0;
        }

        .empty-preview {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
          text-align: center;
          padding: 22px;
        }

        .model-select {
          width: 100%;
          border: none;
          background: #eef2f7;
          border-radius: 8px;
          padding: 14px;
          color: #111827;
          font-size: 15px;
          outline: none;
          margin-bottom: 16px;
        }

        .chat-panel {
          height: 500px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #ffffff;
          padding: 18px;
          overflow-y: auto;
        }

        .chat-empty,
        .chat-loading {
          height: 100%;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 46px;
          color: #64748b;
        }

        .chat-loading {
          color: #16a34a;
          gap: 10px;
          justify-content: flex-start;
          padding-left: 14px;
        }

        .bot-icon {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          background: #ff9f1c;
          color: #ffffff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }

        .warning-box {
          background: #fffbd1;
          color: #92400e;
          border-radius: 8px;
          padding: 18px;
          display: flex;
          gap: 12px;
          align-items: center;
          width: 100%;
        }

        .quiz-generator-section {
          margin-top: 24px;
        }

        .quiz-generator-title {
          font-size: 26px;
          font-weight: 800;
          margin: 0 0 16px;
          color: #111827;
        }

        .generate-btn {
          border: none;
          background: #ff4b4b;
          color: #ffffff;
          border-radius: 8px;
          padding: 13px 18px;
          cursor: pointer;
          font-weight: 800;
          font-size: 15px;
          margin-bottom: 16px;
        }

        .generate-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .prompt-row {
          display: flex;
          align-items: center;
          background: #eef2f7;
          border-radius: 8px;
          overflow: hidden;
        }

        .prompt-input {
          flex: 1;
          border: none;
          background: transparent;
          padding: 14px;
          font-size: 15px;
          outline: none;
          color: #111827;
        }

        .send-btn {
          border: none;
          background: transparent;
          color: #9ca3af;
          font-size: 24px;
          padding: 8px 14px;
          cursor: pointer;
        }

        .send-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .status {
          margin-top: 14px;
          color: #64748b;
          font-size: 14px;
          line-height: 1.5;
        }

        .error {
          margin-top: 16px;
          background: #fee2e2;
          color: #991b1b;
          border: 1px solid #fecaca;
          padding: 13px;
          border-radius: 8px;
        }

        .quiz-interactive {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .quiz-question-card {
          padding: 18px;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          background: #ffffff;
        }

        .quiz-question-card h3 {
          margin: 0 0 14px;
          font-size: 17px;
          font-weight: 800;
          color: #111827;
          line-height: 1.45;
        }

        .quiz-options {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .quiz-option {
          width: 100%;
          border: 1px solid #d1d5db;
          background: #ffffff;
          color: #111827;
          border-radius: 10px;
          padding: 11px 13px;
          text-align: left;
          display: flex;
          gap: 10px;
          cursor: pointer;
          transition: 0.2s ease;
        }

        .quiz-option:hover {
          border-color: #ff4b4b;
          background: #fff5f5;
        }

        .quiz-option.selected {
          border-color: #ff4b4b;
          background: #fff1f1;
        }

        .quiz-option.correct {
          border-color: #16a34a;
          background: #dcfce7;
        }

        .quiz-option.wrong {
          border-color: #dc2626;
          background: #fee2e2;
        }

        .quiz-option span {
          font-weight: 800;
        }

        .quiz-option p {
          margin: 0;
        }

        .answer-result {
          margin-top: 12px;
          padding: 12px;
          border-radius: 10px;
        }

        .correct-text {
          background: #dcfce7;
          color: #166534;
        }

        .wrong-text {
          background: #fee2e2;
          color: #991b1b;
        }

        .answer-explanation {
          margin: 8px 0 0;
          color: #374151;
        }

        .submit-answers-btn,
        .recommendation-link-btn {
          align-self: flex-start;
          border: none;
          color: white;
          padding: 12px 18px;
          border-radius: 8px;
          font-weight: 800;
          cursor: pointer;
        }

        .submit-answers-btn {
          background: #ff4b4b;
        }

        .recommendation-link-btn {
          background: #111827;
        }

        .submit-answers-btn:disabled {
          background: #9ca3af;
          cursor: not-allowed;
        }

        .quiz-hint {
          color: #64748b;
          margin-top: -8px;
        }

        .quiz-score {
          padding: 14px;
          background: #f3f4f6;
          border-radius: 10px;
          font-weight: 800;
        }

        .sources {
          margin-top: 18px;
          color: #64748b;
          font-size: 14px;
        }


        .quiz-page {
          overflow-x: hidden;
        }

        .quiz-page.dark-mode {
          background: #0f172a;
          color: #e5e7eb;
        }

        .quiz-page.dark-mode .streamlit-shell,
        .quiz-page.dark-mode .streamlit-topbar,
        .quiz-page.dark-mode .main-workspace,
        .quiz-page.dark-mode .chat-panel,
        .quiz-page.dark-mode .upload-card,
        .quiz-page.dark-mode .model-select,
        .quiz-page.dark-mode .prompt-row,
        .quiz-page.dark-mode .settings-dropdown {
          background: #111827;
          color: #e5e7eb;
        }

        .quiz-page.dark-mode .loaded-sidebar {
          background: #0b1220;
        }

        .quiz-page.dark-mode .page-title,
        .quiz-page.dark-mode .topbar-left,
        .quiz-page.dark-mode .upload-label,
        .quiz-page.dark-mode .model-label,
        .quiz-page.dark-mode .quiz-generator-title,
        .quiz-page.dark-mode .dropdown-title,
        .quiz-page.dark-mode .dropdown-item {
          color: #f8fafc;
        }

        .quiz-page.dark-mode .streamlit-topbar,
        .quiz-page.dark-mode .chat-panel,
        .quiz-page.dark-mode .pdf-preview-box,
        .quiz-page.dark-mode .settings-dropdown {
          border-color: #334155;
        }

        .quiz-page.dark-mode .dropdown-text,
        .quiz-page.dark-mode .status,
        .quiz-page.dark-mode .upload-sub-text {
          color: #cbd5e1;
        }

        .quiz-page.dark-mode .dropdown-item:hover {
          background: #1e293b;
        }

        .main-workspace {
          padding: 18px 32px 40px;
        }

        .chat-panel {
          height: 360px;
        }

        .pdf-preview-box {
          margin-top: 12px;
          height: 300px;
        }

        .topbar-actions {
          position: relative;
          display: flex;
          align-items: center;
          gap: 10px;
          color: #111827;
          font-size: 14px;
        }

        .settings-dropdown {
          position: absolute;
          top: 42px;
          right: 0;
          width: 260px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          box-shadow: 0 16px 35px rgba(15, 23, 42, 0.14);
          padding: 12px;
          z-index: 50;
        }

        .dropdown-title {
          font-weight: 800;
          color: #111827;
          margin-bottom: 6px;
        }

        .dropdown-text {
          font-size: 13px;
          color: #64748b;
          margin: 0 0 10px;
          line-height: 1.5;
        }

        .dropdown-item {
          width: 100%;
          border: none;
          background: transparent;
          color: #111827;
          text-align: left;
          padding: 10px;
          border-radius: 10px;
          font-weight: 600;
          cursor: pointer;
        }

        .dropdown-item:hover {
          background: #f1f5f9;
        }

        .sidebar-bottom-settings {
          margin-top: 22px;
          padding-top: 16px;
          border-top: 1px solid #d1d5db;
        }

        .sidebar-settings-btn {
          width: 100%;
          border: none;
          background: transparent;
          color: #475569;
          text-align: left;
          padding: 10px 0;
          font-weight: 700;
          cursor: pointer;
        }

        .sidebar-settings-btn:hover {
          color: #111827;
        }

        @media (max-width: 1100px) {
          .streamlit-body {
            grid-template-columns: 1fr;
          }

          .loaded-sidebar {
            display: none;
          }

          .main-workspace {
            padding: 24px 18px 60px;
          }

          .main-grid {
            grid-template-columns: 1fr;
          }

          .chat-panel {
            height: auto;
            min-height: 300px;
          }        }
      `} 
      </style>

      <div className="streamlit-shell">
        
<div className="streamlit-topbar">
  <div className="topbar-left">
    <button className="collapse-icon" type="button">›</button>
    <span>StudyFlow PDF Quiz</span>
  </div>

  <div className="topbar-actions">
  <button
    className="topbar-menu"
    type="button"
    onClick={() => setMenuOpen((prev) => !prev)}
  >
    ⋮
  </button>

  {menuOpen && (
    <div className="settings-dropdown">
      <div className="dropdown-title">About</div>
      <p className="dropdown-text">
        Generate a quiz from Jeneen and Rana.
      </p>

      <div className="dropdown-recorder">
  <ScreenRecorderMenu />
</div>
      <button className="dropdown-item" type="button" onClick={() => setThemeMode("light")}>
        Light mode
      </button>

      <button className="dropdown-item" type="button" onClick={() => setThemeMode("dark")}>
        Dark mode
      </button>
    </div>
  )}
</div>
</div>
        <div className="streamlit-body">
          <aside className="loaded-sidebar">
            <div className="sidebar-section-title">Loaded PDFs</div>

            <div className="metric-card">
              <div className="metric-label">Total PDFs</div>
              <div className="metric-value">{selectedFile ? 1 : 0}</div>
            </div>

            <div className="metric-card">
              <div className="metric-label">Total Chunks</div>
              <div className="metric-value">{sources.length || (selectedFile ? "..." : 0)}</div>
            </div>

            {selectedFile && (
              <div className="pdf-expander" title={selectedFile.name}>
                › {selectedFile.name}
              </div>
            )}

            <button
              className="delete-all-btn"
              type="button"
              onClick={() => {
                activeRequestIdRef.current = Date.now();
                setSelectedFile(null);
                setUploadedPdfId("");
                setQuizText("");
                setSources([]);
                setSelectedAnswers({});
                setSubmitted(false);
                setError("");
                setStatus("Upload a PDF file to get started.");
                setQuizPdfName("");
                setQuizCreatedAt("");
                try {
                  localStorage.removeItem(SAVED_QUIZ_KEY);
                } catch {
                  // ignore
                }
                if (fileInputRef.current) {
                  fileInputRef.current.value = "";
                }
              }}
            >
              Delete All PDFs
            </button>

            <div className="sidebar-bottom-settings">
              <button
                className="sidebar-settings-btn"
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                Settings
              </button>
            </div>
          </aside>

          <main className="main-workspace">
            <h1 className="page-title">Ollama PDF RAG playground</h1>

            <div className="main-grid">
              <section className="left-column">
                <div className="toggle-row">
                  <span className="fake-toggle"></span>
                  <span>Use sample PDF (Scammer Agent Paper)</span>
                </div>

                <label className="upload-label">Upload PDF files</label>

                <div
                  className="upload-card"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleFile(e.dataTransfer.files?.[0]);
                  }}
                >
                  <div className="cloud-icon">☁</div>

                  <div>
                    <div className="upload-main-text">
                      Drag and drop<br />files here
                    </div>
                    <div className="upload-sub-text">
                      Limit 200MB per file • PDF
                    </div>
                  </div>

                  <button className="browse-btn" type="button">
                    Browse files
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    style={{ display: "none" }}
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                </div>

                {selectedFile ? (
                  <>
                    <div className="file-pill">
                      <div className="file-icon">▣</div>
                      <div>
                        <strong>{selectedFile.name}</strong>
                        <small>{(selectedFile.size / (1024 * 1024)).toFixed(1)}MB</small>
                      </div>
                    </div>

                    <div className="plus-line">＋</div>
                  </>
                ) : (
                  <div className="info-box">
                    Upload PDF files to view them here.
                  </div>
                )}

                <button
                  className="delete-btn"
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setUploadedPdfId("");
                    setQuizText("");
                    setSources([]);
                    setSelectedAnswers({});
                    setSubmitted(false);
                    setError("");
                    setStatus("Upload a PDF file to get started.");
                    setQuizPdfName("");
                    setQuizCreatedAt("");
                    try {
                      localStorage.removeItem(SAVED_QUIZ_KEY);
                    } catch {
                      // ignore
                    }
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                >
                  Delete collection
                </button>

                {selectedFile && (
                  <>
                    <div className="zoom-row">
                      <div className="zoom-label">
                        <span>Zoom Level</span>
                        <span>700</span>
                      </div>
                      <input className="zoom-range" type="range" min="100" max="1000" value="700" readOnly />
                    </div>

                    <div className="pdf-preview-box">
                      {pdfPreviewUrl ? (
                        <iframe src={pdfPreviewUrl} title="PDF preview" />
                      ) : (
                        <div className="empty-preview">PDF preview will appear here.</div>
                      )}
                    </div>
                  </>
                )}
              </section>

              <section className="right-column">
                <label className="model-label">
                  Pick a model available locally on your system
                </label>

                <select
                  className="model-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={loading}
                >
                  <option value="qwen2.5:1.5b">qwen2.5:1.5b (Recommended)</option>
                  <option value="llama3.2:3b">llama3.2:3b</option>
                  <option value="qwen3:1.7b">qwen3:1.7b</option>
                  <option value="phi3:mini">phi3:mini</option>
                </select>

                <div className="chat-panel">
                  {loading ? (
                    <div className="chat-loading">
                      <span className="bot-icon">🤖</span>
                      <span>processing...</span>
                    </div>
                  ) : quizText ? (
                    <>
                      {hasValidQuiz ? (
                        <div className="quiz-interactive">
                          {parsedQuestions.map((q, index) => {
                            const selected = selectedAnswers[q.id];
                            const selectedLetter = normalizeAnswerLetter(
                              selected,
                              q.options
                            );
                            const correctLetter = normalizeAnswerLetter(
                              q.correctAnswer,
                              q.options
                            );
                            const isCorrect =
                              submitted &&
                              selectedLetter === correctLetter;

                            return (
                              <div className="quiz-question-card" key={q.id}>
                                <h3>
                                  Q{index + 1}: {q.question}
                                </h3>

                                <div className="quiz-options">
                                  {q.options.map((option) => {
                                    const isSelected =
                                      selectedLetter ===
                                      normalizeAnswerLetter(option.letter, q.options);

                                    const isCorrectOption =
                                      submitted &&
                                      normalizeAnswerLetter(option.letter, q.options) ===
                                      correctLetter;

                                    const isWrongSelected =
                                      submitted &&
                                      isSelected &&
                                      normalizeAnswerLetter(option.letter, q.options) !==
                                      correctLetter;

                                    return (
                                      <button
                                        type="button"
                                        key={option.letter}
                                        className={[
                                          "quiz-option",
                                          isSelected ? "selected" : "",
                                          isCorrectOption ? "correct" : "",
                                          isWrongSelected ? "wrong" : "",
                                        ].join(" ")}
                                        onClick={() =>
                                          handleSelectAnswer(q.id, option.letter)
                                        }
                                      >
                                        <span>{option.letter}.</span>
                                        <p>{option.text}</p>
                                      </button>
                                    );
                                  })}
                                </div>

                                {submitted && (
                                  <div
                                    className={
                                      isCorrect
                                        ? "answer-result correct-text"
                                        : "answer-result wrong-text"
                                    }
                                  >
                                    {isCorrect ? (
                                      <strong>Correct ✅</strong>
                                    ) : (
                                      <strong>
                                        Wrong ❌ Correct answer: {correctLetter}
                                      </strong>
                                    )}

                                    {isCorrect && (
                                      <p className="answer-explanation">
                                        Correct answer: {correctLetter}
                                      </p>
                                    )}

                                    {q.explanation && (
                                      <p className="answer-explanation">
                                        {q.explanation}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {!submitted && (
                            <button
                              type="button"
                              className="submit-answers-btn"
                              onClick={handleSubmitAnswers}
                              disabled={!hasValidQuiz || answeredCount !== parsedQuestions.length}
                            >
                              Submit Answers
                            </button>
                          )}

                          {!submitted && answeredCount !== parsedQuestions.length && (
                            <p className="quiz-hint">
                              Answer all questions before submitting.
                            </p>
                          )}

                          {submitted && (
                            <>
                              <div className="quiz-score">
                                Score:{" "}
                                {
                                  parsedQuestions.filter(
                                    (q) =>
                                      normalizeAnswerLetter(selectedAnswers[q.id], q.options) ===
                                      normalizeAnswerLetter(q.correctAnswer, q.options)
                                  ).length
                                }
                                /{parsedQuestions.length}
                              </div>

                              <button
                                type="button"
                                className="recommendation-link-btn"
                                onClick={() => {
                                  navigate("/recommendations");
                                }}
                              >
                                View Study Recommendations
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="warning-box">
                          <span className="bot-icon">🤖</span>
                          <span>
                            Quiz generated, but the format was invalid. Please click Regenerate Quiz.
                          </span>
                        </div>
                      )}

                      {sources.length > 0 && (
                        <div className="sources">
                          Sources used: {sources.length} chunk(s)
                        </div>
                      )}
                    </>
                  ) : selectedFile ? (
                    <div className="chat-empty">
                      <div className="warning-box">
                        <span className="bot-icon">🤖</span>
                        <span>Click Generate Quiz to create 5 MCQs from the uploaded PDF.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="chat-empty">
                      <div className="warning-box">
                        <span className="bot-icon">🤖</span>
                        <span>Please upload PDF files first.</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="quiz-generator-section">
                  <h2 className="quiz-generator-title">Quiz Generator</h2>

                  <button
                    className="generate-btn"
                    type="button"
                    onClick={generateQuiz}
                    disabled={loading || !selectedFile}
                  >
                    {loading ? "Generating..." : quizText ? "Regenerate Quiz" : "Generate 5 MCQs"}
                  </button>

                  <div className="prompt-row">
                    <input
                      className="prompt-input"
                      type="text"
                      placeholder="Enter a prompt here..."
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && selectedFile && !loading) {
                          generateQuiz();
                        }
                      }}
                      disabled={loading}
                    />

                    <button
                      className="send-btn"
                      type="button"
                      onClick={generateQuiz}
                      disabled={loading || !selectedFile}
                      title="Generate quiz"
                    >
                      ↑
                    </button>
                  </div>

                  <div className="status">{status}</div>

                  {error && <div className="error">{error}</div>}
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
