import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { saveRecommendationFromQuiz } from "../../utils/recommendationEngine";

const API_BASE =
  import.meta.env.VITE_AI_TUTOR_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://127.0.0.1:8001";

function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getQuestionText(question) {
  return (
    question?.question ||
    question?.question_text ||
    question?.text ||
    question?.prompt ||
    ""
  );
}

function getCorrectAnswer(question) {
  return (
    question?.answer ||
    question?.answer_text ||
    question?.correct_answer ||
    question?.correctAnswer ||
    question?.model_answer ||
    question?.modelAnswer ||
    ""
  );
}

function getQuestionType(question, quizMode) {
  const rawType = String(
    question?.type || question?.question_type || quizMode || ""
  ).toLowerCase();

  if (
    rawType.includes("fill") ||
    rawType.includes("blank") ||
    String(question?.question || "").includes("________")
  ) {
    return "fill_blank";
  }

  if (rawType.includes("true") || rawType.includes("false")) {
    return "true_false";
  }

  if (rawType.includes("mcq") || question?.options?.length) {
    return "mcq";
  }

  return rawType || "written";
}

function getOptions(question) {
  if (Array.isArray(question?.options) && question.options.length) {
    return question.options;
  }

  return [
    question?.option_a,
    question?.option_b,
    question?.option_c,
    question?.option_d,
  ].filter(Boolean);
}

function getBookTitle(book) {
  if (!book) return "Latest Quiz";
  if (typeof book === "string") return book;

  return (
    book.title ||
    book.name ||
    book.book_title ||
    book.note_title ||
    book.fileName ||
    "Latest Quiz"
  );
}

function getOptionText(option) {
  if (typeof option === "string") return option;

  return (
    option?.text ||
    option?.label ||
    option?.answer ||
    option?.value ||
    String(option || "")
  );
}

function normalizeOption(value) {
  return normalizeAnswer(value)
    .replace(/^[a-f]\s*[\.\)]\s*/i, "")
    .trim();
}

function isFillBlankCorrect(userAnswer, question) {
  const user = normalizeAnswer(userAnswer);

  const acceptedAnswers = [
    question?.answer,
    question?.answer_text,
    question?.correct_answer,
    question?.correctAnswer,
    ...(question?.accepted_answers || []),
  ]
    .filter(Boolean)
    .map(normalizeAnswer);

  return acceptedAnswers.includes(user);
}

function isNormalAnswerCorrect(userAnswer, question) {
  const user = normalizeAnswer(userAnswer);
  const correct = normalizeAnswer(getCorrectAnswer(question));

  if (!user || !correct) return false;
  if (user === correct) return true;

  const options = getOptions(question).map(getOptionText);
  const letters = ["a", "b", "c", "d", "e", "f"];

  const userLetterIndex = letters.indexOf(user);
  const correctLetterIndex = letters.indexOf(correct);

  if (correctLetterIndex !== -1 && options[correctLetterIndex]) {
    return normalizeAnswer(options[correctLetterIndex]) === user;
  }

  if (userLetterIndex !== -1 && options[userLetterIndex]) {
    return normalizeAnswer(options[userLetterIndex]) === correct;
  }

  return normalizeOption(userAnswer) === normalizeOption(getCorrectAnswer(question));
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") || "";
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function getPageStart(question) {
  return firstValue(
    question?.page_start,
    question?.pageStart,
    question?.page_from,
    question?.pageFrom,
    question?.review_from,
    question?.reviewFrom,
    question?.source_page,
    question?.sourcePage,
    question?.page
  );
}

function getPageEnd(question) {
  return firstValue(
    question?.page_end,
    question?.pageEnd,
    question?.page_to,
    question?.pageTo,
    question?.review_to,
    question?.reviewTo,
    question?.source_page,
    question?.sourcePage,
    question?.page,
    getPageStart(question)
  );
}

function getSourceChunkIds(question, fallback = []) {
  if (Array.isArray(question?.source_chunk_ids)) return question.source_chunk_ids;
  if (Array.isArray(question?.sourceChunkIds)) return question.sourceChunkIds;
  if (question?.source_chunk_id) return [question.source_chunk_id];
  if (question?.sourceChunkId) return [question.sourceChunkId];
  if (question?.chunk_id) return [question.chunk_id];
  if (question?.chunkId) return [question.chunkId];

  return fallback;
}

function getQuestionTopic(question, fallbackTopic) {
  return (
    question?.topic ||
    question?.source_topic ||
    question?.sourceTopic ||
    question?.section ||
    question?.source_section ||
    question?.sourceSection ||
    question?.category ||
    question?.concept ||
    question?.skill ||
    fallbackTopic ||
    "Current Quiz Topic"
  );
}

function getFocusedQuizRequest(locationState) {
  if (locationState?.mode === "focused_recommendation_quiz") {
    return locationState;
  }

  try {
    const saved = localStorage.getItem("studyflow_focused_quiz_request");
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export default function QuizViewer({
  quiz,
  chapterNumber,
  book,
  quizType,
  onQuizGenerated,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const focusedRequest = getFocusedQuizRequest(location.state);

  const noteId = firstValue(
    focusedRequest?.noteId,
    focusedRequest?.note_id,
    location.state?.noteId,
    location.state?.note_id,
    location.state?.id,
    params.noteId,
    params.id,
    quiz?.note_id,
    quiz?.noteId,
    quiz?.document_id,
    quiz?.documentId,
    book?.id,
    book?.note_id,
    book?.noteId
  );

  const noteTitle = firstValue(
    focusedRequest?.noteTitle,
    focusedRequest?.note_title,
    location.state?.noteTitle,
    location.state?.note_title,
    location.state?.title,
    quiz?.note_title,
    quiz?.noteTitle,
    quiz?.title,
    quiz?.fileName,
    getBookTitle(book)
  );

  const chapterId = firstValue(
    focusedRequest?.chapterId,
    focusedRequest?.chapter_id,
    location.state?.chapterId,
    location.state?.chapter_id,
    quiz?.chapter_id,
    quiz?.chapterId,
    chapterNumber
  );

  const chapterTitle = firstValue(
    focusedRequest?.chapterTitle,
    focusedRequest?.chapter_title,
    location.state?.chapterTitle,
    location.state?.chapter_title,
    quiz?.chapter_title,
    quiz?.chapterTitle,
    chapterNumber !== null && chapterNumber !== undefined
      ? `Chapter ${chapterNumber}`
      : "",
    "Current Chapter"
  );

  const baseSourceChunkIds = uniqueValues(
    focusedRequest?.sourceChunkIds ||
      focusedRequest?.source_chunk_ids ||
      location.state?.sourceChunkIds ||
      location.state?.source_chunk_ids ||
      quiz?.sourceChunkIds ||
      quiz?.source_chunk_ids ||
      []
  );

  const [visibleQuestions, setVisibleQuestions] = useState([]);
  const [userAnswers, setUserAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [score, setScore] = useState(0);
  const [recommendationData, setRecommendationData] = useState(null);
  const [loadingNewQuiz, setLoadingNewQuiz] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    let timer;

    if (loadingNewQuiz) {
      setElapsedTime(0);

      timer = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedTime(0);
    }

    return () => clearInterval(timer);
  }, [loadingNewQuiz]);

  const detectedQuizMode = useMemo(() => {
    const mode = String(
      quiz?.quiz_mode || quiz?.model || quizType || focusedRequest?.quizType || ""
    ).toLowerCase();

    if (mode.includes("fill") || mode.includes("blank")) {
      return "fill_blank";
    }

    const firstQuestion = quiz?.questions?.[0];

    if (firstQuestion) {
      return getQuestionType(firstQuestion, mode);
    }

    return quizType || focusedRequest?.quizType || "mcq";
  }, [quiz, quizType, focusedRequest?.quizType]);

  const isFillBlankQuiz = detectedQuizMode === "fill_blank";

  useEffect(() => {
    if (quiz?.questions?.length) {
      pickRandomFive(quiz.questions);
    }
  }, [quiz]);

  const pickRandomFive = (allQuestions) => {
    const selected =
      allQuestions.length <= 5
        ? [...allQuestions]
        : [...allQuestions].sort(() => 0.5 - Math.random()).slice(0, 5);

    setVisibleQuestions(selected);
    setUserAnswers({});
    setSubmitted(false);
    setScore(0);
    setRecommendationData(null);
    setError(null);
  };

  const handleAnswerChange = (questionIdx, value) => {
    setUserAnswers((prev) => ({
      ...prev,
      [questionIdx]: value,
    }));
  };

  const checkAnswer = (question, index) => {
    const userAnswer = userAnswers[index] || "";
    const type = getQuestionType(question, detectedQuizMode);

    if (type === "fill_blank") {
      return isFillBlankCorrect(userAnswer, question);
    }

    return isNormalAnswerCorrect(userAnswer, question);
  };

  const buildQuestionsForRecommendation = () => {
    return visibleQuestions.map((question, index) => {
      const isCorrect = checkAnswer(question, index);
      const pageStart = getPageStart(question);
      const pageEnd = getPageEnd(question) || pageStart;
      const sourceChunkIds = uniqueValues(getSourceChunkIds(question, baseSourceChunkIds));

      return {
        ...question,
        id: question?.id || question?.question_id || index,
        question: getQuestionText(question),
        user_answer: userAnswers[index] || "",
        is_correct: isCorrect,
        correct_answer: getCorrectAnswer(question),

        topic: getQuestionTopic(
          question,
          focusedRequest?.focusTopic ||
            focusedRequest?.focus_topic ||
            chapterTitle ||
            "Current Quiz Topic"
        ),

        note_id: firstValue(
          question?.note_id,
          question?.noteId,
          question?.document_id,
          question?.documentId,
          noteId
        ),
        note_title: firstValue(
          question?.note_title,
          question?.noteTitle,
          question?.document_title,
          question?.documentTitle,
          noteTitle
        ),
        chapter_id: firstValue(question?.chapter_id, question?.chapterId, chapterId),
        chapter_title: firstValue(
          question?.chapter_title,
          question?.chapterTitle,
          question?.chapter,
          chapterTitle
        ),

        page_start: pageStart,
        page_end: pageEnd,
        source_chunk_ids: sourceChunkIds,
      };
    });
  };

  const createRecommendation = (calculatedScore) => {
    const recommendationQuestions = buildQuestionsForRecommendation();

    const recommendation = saveRecommendationFromQuiz({
      questions: recommendationQuestions,
      userAnswers: userAnswers,
      quizTitle: noteTitle || getBookTitle(book),
      chapterTitle,
      quizType: detectedQuizMode || quizType || "Quiz",

      noteId,
      noteTitle,
      chapterId,
      sourceChunkIds: baseSourceChunkIds,
    });

    recommendation.noteId = noteId;
    recommendation.noteTitle = noteTitle;
    recommendation.chapterId = chapterId;
    recommendation.chapterTitle = chapterTitle;
    recommendation.rawScore = calculatedScore;
    recommendation.totalQuestions = visibleQuestions.length;

    recommendation.weakTopics = (recommendation.weakTopics || []).map((item) => ({
      ...item,
      noteId: item.noteId || noteId,
      noteTitle: item.noteTitle || noteTitle,
      chapterId: item.chapterId || chapterId,
      chapterTitle: item.chapterTitle || chapterTitle,
      askPdfPrompt:
        item.askPdfPrompt ||
        `Explain ${item.topic} from the uploaded note "${noteTitle}". Focus only on this note content.`,
    }));

    localStorage.setItem(
      "studyflow_recommendation",
      JSON.stringify(recommendation)
    );

    setRecommendationData(recommendation);

    return recommendation;
  };

  const handleSubmit = () => {
    setSubmitting(true);

    let calculatedScore = 0;

    visibleQuestions.forEach((question, index) => {
      if (checkAnswer(question, index)) {
        calculatedScore += 1;
      }
    });

    setScore(calculatedScore);
    setSubmitted(true);
    createRecommendation(calculatedScore);
    setSubmitting(false);
  };

  const openRecommendations = () => {
    const recommendation = recommendationData || createRecommendation(score);

    navigate("/recommendations", {
      state: {
        recommendation,
      },
    });
  };

  const regenerateQuiz = async () => {
    if (!book && !noteTitle) return;

    setError(null);

    try {
      setLoadingNewQuiz(true);

      const latestFocusedRequest = getFocusedQuizRequest(location.state);
      const bookParam = noteTitle || getBookTitle(book);

      let url = `${API_BASE}/generate-quiz/?book=${encodeURIComponent(
        bookParam
      )}&chapter_number=${chapterNumber || chapterId || 1}`;

      if (isFillBlankQuiz || quizType === "fill_blank") {
        url = `${API_BASE}/api/quiz/fill-blank/chapter?book=${encodeURIComponent(
          bookParam
        )}&chapter_number=${chapterNumber || chapterId || 1}`;
      }

      const payload = {
        note_id: noteId || "",
        note_title: noteTitle || "",
        chapter_id: chapterId || "",
        chapter_title: chapterTitle || "",
        quiz_type: detectedQuizMode || quizType || "mcq",
        questions_count: 5,
        total_questions: 5,

        mode: latestFocusedRequest
          ? "focused_recommendation_quiz"
          : "normal_quiz",

        focus_topic:
          latestFocusedRequest?.focusTopic ||
          latestFocusedRequest?.focus_topic ||
          "",

        page_from:
          latestFocusedRequest?.pageFrom ||
          latestFocusedRequest?.page_from ||
          "",

        page_to:
          latestFocusedRequest?.pageTo ||
          latestFocusedRequest?.page_to ||
          "",

        source_chunk_ids:
          latestFocusedRequest?.sourceChunkIds ||
          latestFocusedRequest?.source_chunk_ids ||
          baseSourceChunkIds,

        wrong_questions:
          latestFocusedRequest?.wrongQuestions ||
          latestFocusedRequest?.wrong_questions ||
          [],
      };

      const res = await axios.post(url, payload);

      pickRandomFive(res.data.questions || []);

      if (latestFocusedRequest) {
        localStorage.removeItem("studyflow_focused_quiz_request");
      }

      if (onQuizGenerated) {
        onQuizGenerated(res.data);
      }
    } catch (err) {
      const detail =
        err.response?.data?.detail ||
        err.response?.data?.error ||
        "Failed to regenerate quiz.";

      setError(detail);
    } finally {
      setLoadingNewQuiz(false);
    }
  };

  if (!visibleQuestions.length) {
    return null;
  }

  return (
    <section className="mt-8 w-full">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {isFillBlankQuiz
              ? "📝 Fill in the Blank Quiz"
              : "🧠 Generated Quiz"}
          </h2>

          <p className="mt-1 text-sm text-gray-500">
            {focusedRequest?.focusTopic ? (
              <>
                Focused on: <b>{focusedRequest.focusTopic}</b>
              </>
            ) : isFillBlankQuiz ? (
              "5 questions • Exam style • Backend answer safety"
            ) : (
              "5 questions • Local quiz generation"
            )}
          </p>
        </div>

        <button
          onClick={regenerateQuiz}
          disabled={loadingNewQuiz}
          className="min-w-[200px] rounded-lg bg-purple-600 px-5 py-2.5 font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingNewQuiz
            ? `Generating... (${elapsedTime}s)`
            : focusedRequest
            ? "Generate From This Note"
            : isFillBlankQuiz
            ? "Generate New Fill in the Blank"
            : "Generate New Quiz"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          ⚠️ {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-col gap-2 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-bold text-gray-900">Exam Questions</h3>

          <span className="w-fit rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-700">
            {visibleQuestions.length} Questions
          </span>
        </div>

        <ul className="space-y-5">
          {visibleQuestions.map((question, index) => {
            const questionType = getQuestionType(question, detectedQuizMode);
            const options = getOptions(question).map(getOptionText);
            const userAnswer = userAnswers[index] || "";
            const correctAnswer = getCorrectAnswer(question);
            const isCorrect = submitted && checkAnswer(question, index);

            return (
              <li
                key={index}
                className={`rounded-xl border p-4 transition sm:p-5 ${
                  submitted
                    ? isCorrect
                      ? "border-green-400 bg-green-50"
                      : "border-red-400 bg-red-50"
                    : "border-gray-200 bg-gray-50"
                }`}
              >
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <p className="font-bold leading-relaxed text-gray-900">
                    Q{index + 1} ({question.difficulty || "Medium"}):{" "}
                    {getQuestionText(question)}
                  </p>

                  <span className="w-fit rounded-md bg-purple-100 px-2.5 py-1 text-xs font-bold text-purple-700">
                    {questionType === "fill_blank"
                      ? "Fill in the Blank"
                      : questionType.toUpperCase()}
                  </span>
                </div>

                {questionType === "fill_blank" ? (
                  <div className="mt-4">
                    <label className="block text-sm font-bold text-gray-700">
                      Your Answer
                    </label>

                    <input
                      type="text"
                      placeholder="Write your answer here..."
                      value={userAnswer}
                      disabled={submitted}
                      onChange={(e) =>
                        handleAnswerChange(index, e.target.value)
                      }
                      className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                    />
                  </div>
                ) : options.length ? (
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                    {options.map((option, optionIndex) => (
                      <li key={optionIndex}>
                        <label
                          className={`flex cursor-pointer items-center rounded-lg border bg-white px-4 py-3 text-sm font-medium transition ${
                            userAnswers[index] === option
                              ? "border-blue-500 ring-2 ring-blue-100"
                              : "border-gray-200 hover:border-blue-300"
                          } ${
                            submitted ? "cursor-not-allowed opacity-90" : ""
                          }`}
                        >
                          <input
                            type="radio"
                            name={`question-${index}`}
                            value={option}
                            disabled={submitted}
                            checked={userAnswers[index] === option}
                            onChange={() => handleAnswerChange(index, option)}
                            className="mr-3"
                          />
                          {option}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <textarea
                    rows={3}
                    placeholder="Type your answer here..."
                    value={userAnswer}
                    disabled={submitted}
                    onChange={(e) => handleAnswerChange(index, e.target.value)}
                    className="mt-3 w-full rounded-lg border border-gray-300 bg-white p-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                  />
                )}

                {submitted && (
                  <div
                    className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                      isCorrect
                        ? "border-green-200 bg-green-100 text-green-800"
                        : "border-red-200 bg-red-100 text-red-800"
                    }`}
                  >
                    <p className="font-bold">
                      {isCorrect ? "✅ Correct" : "❌ Wrong"}
                    </p>

                    <p className="mt-2">
                      <span className="font-bold">Answer:</span> {correctAnswer}
                    </p>

                    {question.explanation && (
                      <p className="mt-2 leading-relaxed">
                        <span className="font-bold">Explanation:</span>{" "}
                        {question.explanation}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {!submitted ? (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-6 rounded-lg bg-blue-600 px-6 py-3 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Submit Answers"}
          </button>
        ) : (
          <div className="mt-6 rounded-xl bg-indigo-50 px-5 py-4 text-center">
            <p className="text-xl font-extrabold text-indigo-700">
              🎯 Your Score: {score} / {visibleQuestions.length}
            </p>

            <button
              type="button"
              onClick={openRecommendations}
              className="mt-4 rounded-lg bg-blue-600 px-6 py-3 font-bold text-white transition hover:bg-blue-700"
            >
              View Smart Recommendations
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
