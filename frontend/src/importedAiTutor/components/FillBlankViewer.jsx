import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveRecommendationFromQuiz } from "../../utils/recommendationEngine";

function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isAnswerCorrect(userAnswer, question) {
  const user = normalizeAnswer(userAnswer);

  const acceptedAnswers = [
    question.answer,
    question.correct_answer,
    question.answer_text,
    ...(question.accepted_answers || []),
  ]
    .filter(Boolean)
    .map(normalizeAnswer);

  return acceptedAnswers.includes(user);
}

function getQuestionText(question) {
  return (
    question.question ||
    question.text ||
    question.prompt ||
    question.statement ||
    "Question"
  );
}

function getCorrectAnswer(question) {
  return (
    question.answer ||
    question.correct_answer ||
    question.answer_text ||
    question.model_answer ||
    ""
  );
}

function buildQuestionsForRecommendation(questions, answers, meta) {
  return questions.map((question, index) => {
    const userAnswer = answers[index] || "";
    const correct = isAnswerCorrect(userAnswer, question);

    return {
      ...question,
      id: question.id || index,
      question: getQuestionText(question),
      user_answer: userAnswer,
      is_correct: correct,
      correct_answer: getCorrectAnswer(question),

      topic:
        question.topic ||
        question.source_topic ||
        question.section ||
        question.category ||
        meta.chapterTitle ||
        "Current Quiz Topic",

      note_id: question.note_id || question.noteId || meta.noteId || "",
      note_title: question.note_title || question.noteTitle || meta.noteTitle || "",
      chapter_id: question.chapter_id || question.chapterId || meta.chapterId || "",
      chapter_title:
        question.chapter_title ||
        question.chapterTitle ||
        meta.chapterTitle ||
        "",

      page_start: question.page_start || question.pageStart || question.page || "",
      page_end: question.page_end || question.pageEnd || question.page || "",

      source_chunk_ids:
        question.source_chunk_ids ||
        question.sourceChunkIds ||
        meta.sourceChunkIds ||
        [],
    };
  });
}

export default function FillBlankViewer({
  quiz,
  onGenerateNew,

  noteId = "",
  noteTitle = "",
  chapterId = "",
  chapterTitle = "",
  sourceChunkIds = [],
}) {
  const navigate = useNavigate();
  const questions = quiz?.questions || [];

  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [recommendationData, setRecommendationData] = useState(null);

  const handleAnswerChange = (index, value) => {
    setAnswers((prev) => ({
      ...prev,
      [index]: value,
    }));
  };

  const score = questions.reduce((total, question, index) => {
    return total + (isAnswerCorrect(answers[index], question) ? 1 : 0);
  }, 0);

  const handleSubmit = () => {
    const meta = {
      noteId,
      noteTitle,
      chapterId,
      chapterTitle,
      sourceChunkIds,
    };

    const recommendationQuestions = buildQuestionsForRecommendation(
      questions,
      answers,
      meta
    );

    const recommendation = saveRecommendationFromQuiz({
      questions: recommendationQuestions,
      userAnswers: answers,
      quizTitle: noteTitle || quiz?.title || "Fill in the Blank Quiz",
      chapterTitle: chapterTitle || noteTitle || "Current Chapter",
      quizType: "fill_blank",

      noteId,
      noteTitle,
      chapterId,
      sourceChunkIds,
    });

    recommendation.rawScore = score;
    recommendation.totalQuestions = questions.length;

    localStorage.setItem(
      "studyflow_recommendation",
      JSON.stringify(recommendation)
    );

    setRecommendationData(recommendation);
    setSubmitted(true);
  };

  const openRecommendations = () => {
    navigate("/recommendations", {
      state: {
        recommendation: recommendationData,
      },
    });
  };

  if (!questions.length) {
    return null;
  }

  return (
    <section className="fill-blank-quiz">
      <div className="fill-blank-header">
        <div>
          <h2>✅ Fill in the Blank Quiz</h2>
          <p>5 questions • Local Ollama selection with backend answer safety</p>
        </div>

        {onGenerateNew && (
          <button className="generate-fill-btn" onClick={onGenerateNew}>
            Generate New Fill in the Blank
          </button>
        )}
      </div>

      <div className="fill-blank-exam-card">
        <div className="exam-title-row">
          <h3>Exam Style Questions</h3>
          <span>{questions.length} Questions</span>
        </div>

        {questions.map((question, index) => {
          const userAnswer = answers[index] || "";
          const correct = isAnswerCorrect(userAnswer, question);

          return (
            <div className="fill-question-card" key={index}>
              <div className="fill-question-top">
                <h4>
                  Q{index + 1} ({question.difficulty || "Medium"})
                </h4>
                <span>Fill in the Blank</span>
              </div>

              <p className="fill-question-text">{getQuestionText(question)}</p>

              <label className="fill-answer-label">
                Your Answer
                <input
                  type="text"
                  value={userAnswer}
                  disabled={submitted}
                  placeholder="Write your answer here..."
                  onChange={(e) => handleAnswerChange(index, e.target.value)}
                />
              </label>

              {submitted && (
                <div
                  className={
                    correct ? "fill-result correct" : "fill-result wrong"
                  }
                >
                  <strong>{correct ? "✅ Correct" : "❌ Wrong"}</strong>

                  <p>
                    <b>Answer:</b> {getCorrectAnswer(question)}
                  </p>

                  {question.explanation && (
                    <p>
                      <b>Explanation:</b> {question.explanation}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!submitted ? (
          <button className="submit-fill-btn" onClick={handleSubmit}>
            Submit Answers
          </button>
        ) : (
          <div className="fill-score-box">
            <p>
              🎯 Your Score: {score} / {questions.length}
            </p>

            <button
              type="button"
              className="submit-fill-btn"
              onClick={openRecommendations}
            >
              View Smart Recommendations
            </button>
          </div>
        )}
      </div>
    </section>
  );
}