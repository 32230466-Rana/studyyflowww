import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./RecommendationPage.css";
import axiosClient from "../axiosClient";

function getSavedRecommendation(locationState) {
  if (locationState?.recommendation) return locationState.recommendation;

  try {
    const saved = localStorage.getItem("studyflow_recommendation");
    if (saved) return JSON.parse(saved);
  } catch {
    return null;
  }

  return null;
}

function StatCard({ icon, label, value, color }) {
  return (
    <article className="rec-stat-card">
      <div className={`rec-stat-icon ${color}`}>{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function PriorityBadge({ value }) {
  const type = String(value || "Medium").toLowerCase();
  return <span className={`priority-badge ${type}`}>{value}</span>;
}

function getNumber(value) {
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function uniqueNumbers(values = []) {
  return [...new Set(values.map(getNumber).filter((value) => value !== null))].sort(
    (a, b) => a - b
  );
}

function getQuestionSlides(question = {}) {
  const from =
    question.page_start ??
    question.pageStart ??
    question.page_from ??
    question.pageFrom ??
    question.slide_start ??
    question.slideStart ??
    question.slide_from ??
    question.slideFrom ??
    question.source_page ??
    question.sourcePage ??
    question.page ??
    question.slide ??
    question.slide_number ??
    question.slideNumber;

  const to =
    question.page_end ??
    question.pageEnd ??
    question.page_to ??
    question.pageTo ??
    question.slide_end ??
    question.slideEnd ??
    question.slide_to ??
    question.slideTo ??
    from;

  return uniqueNumbers([from, to]);
}

function getItemSlides(item = {}) {
  const directSlides = uniqueNumbers([
    ...(Array.isArray(item.slides) ? item.slides : []),
    ...(Array.isArray(item.slideNumbers) ? item.slideNumbers : []),
    ...(Array.isArray(item.slide_numbers) ? item.slide_numbers : []),

    item.pageFrom,
    item.pageTo,
    item.page_from,
    item.page_to,

    item.slideFrom,
    item.slideTo,
    item.slide_from,
    item.slide_to,

    item.slide_number,
    item.slideNumber,
    item.page_number,
    item.pageNumber,
    item.page,
    item.slide,
  ]);

  const wrongSlides = uniqueNumbers(
    (item.wrongQuestions || []).flatMap((question) => getQuestionSlides(question))
  );

  return wrongSlides.length ? wrongSlides : directSlides;
}

function areConsecutive(numbers = []) {
  if (numbers.length <= 1) return true;

  for (let i = 1; i < numbers.length; i += 1) {
    if (numbers[i] !== numbers[i - 1] + 1) return false;
  }

  return true;
}

function getReviewText(item = {}) {
  const slides = getItemSlides(item);

  if (slides.length === 1) return `Slide ${slides[0]}`;

  if (slides.length > 1 && areConsecutive(slides)) {
    return `Slides ${slides[0]}-${slides[slides.length - 1]}`;
  }

  if (slides.length > 1) return `Slides ${slides.join(", ")}`;

  if (item.reviewSource && !String(item.reviewSource).includes("Topic:")) {
    return item.reviewSource;
  }

  return "";
}

function getSourceText(data, item = {}) {
  const exactReview = getReviewText(item);

  if (exactReview) return exactReview;

  const noteTitle =
    item.noteTitle ||
    item.note_title ||
    data.noteTitle ||
    data.quizTitle ||
    "same uploaded note";

  return `Same note: ${noteTitle} • Topic: ${item.topic || "Current Topic"}`;
}

function getNoteId(data, item = {}) {
  return (
    item.noteId ||
    item.note_id ||
    data.noteId ||
    data.note_id ||
    data.weakTopics?.find((topic) => topic.noteId || topic.note_id)?.noteId ||
    data.weakTopics?.find((topic) => topic.noteId || topic.note_id)?.note_id ||
    ""
  );
}

function buildFocus(data, item = {}) {
  const noteId = getNoteId(data, item);
  const reviewText = getReviewText(item);
  const slides = getItemSlides(item);

  return {
    noteId,

    noteTitle:
      item.noteTitle ||
      item.note_title ||
      data.noteTitle ||
      data.quizTitle ||
      data.pdfTitle ||
      data.pdf_title ||
      "",

    focusTopic: item.topic || data.recommendedFocus || "Current Topic",

    reviewText,
    slides,

    reviewSource: reviewText || getSourceText(data, item),

    wrongQuestions: item.wrongQuestions || [],

    sourceChunkIds: item.sourceChunkIds || item.source_chunk_ids || [],

    quizType: item.recommendedQuizType || data.quizType || "mcq",

    askPdfPrompt:
      item.askPdfPrompt ||
      `Explain ${item.topic || data.recommendedFocus || "this topic"} from this uploaded note.`,

    recommendation: item,
  };
}

function getPdfPath(data = {}, item = {}) {
  return (
    item.pdfPath ||
    item.pdf_path ||
    item.filePath ||
    item.file_path ||
    item.noteFilePath ||
    item.note_file_path ||
    data.pdfPath ||
    data.pdf_path ||
    data.filePath ||
    data.file_path ||
    data.noteFilePath ||
    data.note_file_path ||
    null
  );
}

function saveLogoutRecommendationEmail(data, item = {}) {
  if (!data) return;

  const focus = buildFocus(data, item);

  const pdfTitle =
    focus.noteTitle ||
    data.noteTitle ||
    data.quizTitle ||
    data.pdfTitle ||
    data.pdf_title ||
    "Your uploaded PDF";

  const sourceText =
    focus.reviewSource ||
    focus.focusTopic ||
    data.recommendedFocus ||
    "Focus on the weak parts from your last recommendation.";

  const focusSource = `${sourceText}. Use StudyFlow Summary, Generate Quiz, Ask PDF, and Plan of Study to review this part.`;

  localStorage.setItem(
    "logoutRecommendationEmail",
    JSON.stringify({
      pdf_title: pdfTitle,
      focus_source: focusSource,
      pdf_path: getPdfPath(data, item),
    })
  );
}

function WeakTopicCard({ data, item, selected, onSelect }) {
  const score = Number(item.score || 0);
  const wrongCount = Number(item.wrongCount || 0);
  const total = Number(item.total || 0);
  const wrongQuestion = item.wrongQuestions?.[0]?.question || "";

  return (
    <article
      className={`weak-topic-card clean-rec-card ${
        selected ? "selected-rec-card" : ""
      }`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
    >
      <div className="weak-topic-top">
        <div>
          <span className="weak-label">Weak Area</span>
          <h3>{item.topic || "Current Topic"}</h3>

          <p>
            {total > 0
              ? `${wrongCount}/${total} wrong answer${
                  wrongCount === 1 ? "" : "s"
                }`
              : "Needs review based on your quiz result"}
          </p>
        </div>

        <div className="rec-badge-stack">
          {selected && <span className="selected-focus-badge">Selected</span>}
          <PriorityBadge value={item.priority || "Medium"} />
        </div>
      </div>

      <div className="topic-progress-block">
        <div className="topic-progress-row">
          <span>Performance</span>
          <strong>{score}%</strong>
        </div>

        <div className="topic-progress-track">
          <div
            className="topic-progress-fill"
            style={{ width: `${Math.max(0, Math.min(score, 100))}%` }}
          />
        </div>
      </div>

      <div className="compact-rec-grid">
        <div className="compact-rec-box">
          <span>Source</span>
          <p>{getSourceText(data, item)}</p>
        </div>

        <div className="compact-rec-box">
          <span>Why</span>
          <p>
            {item.reason || "You answered this part incorrectly in the quiz."}
          </p>
        </div>
      </div>

      {wrongQuestion && (
        <div className="wrong-question-line">
          <span>Wrong Answer Focus</span>
          <p>{wrongQuestion}</p>
        </div>
      )}
    </article>
  );
}

export default function RecommendationPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const data = getSavedRecommendation(location.state);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const weakTopics = data?.weakTopics || [];
  const selectedWeakTopic = weakTopics[selectedIndex] || weakTopics[0] || {};

  const saveRecommendationsForEmail = async (items = []) => {
    try {
      if (!data || !Array.isArray(items) || items.length === 0) return;

      const cleaned = items
        .map((item) => {
          const focus = buildFocus(data, item);
          const slides = getItemSlides(item);
          const firstSlide = slides.length > 0 ? slides[0] : null;

          return {
            note_id: focus.noteId || null,

            pdf_title:
              focus.noteTitle ||
              data.noteTitle ||
              data.quizTitle ||
              data.pdfTitle ||
              data.pdf_title ||
              "Your uploaded PDF",

            slide_number: firstSlide,
            page_number: firstSlide,

            slide_title:
              item.topic || data.recommendedFocus || "Recommended weak point",

            reason:
              item.reason ||
              `${getSourceText(
                data,
                item
              )}. You answered this part incorrectly, so StudyFlow recommends reviewing it.`,

            action_url: focus.noteId
              ? `${window.location.origin}/notes/${focus.noteId}`
              : `${window.location.origin}`,
          };
        })
        .filter((item) => {
          return (
            item.slide_number ||
            item.page_number ||
            item.slide_title ||
            item.reason
          );
        });

      if (cleaned.length === 0) return;

      console.log("Saving recommendations for email:", cleaned);

      await axiosClient.post("/study-recommendations", {
        recommendations: cleaned,
      });
    } catch (error) {
      console.error("Failed to save recommendations for email:", error);
    }
  };

  useEffect(() => {
    if (data && selectedWeakTopic) {
      saveLogoutRecommendationEmail(data, selectedWeakTopic);
      saveRecommendationsForEmail([selectedWeakTopic]);
    }
  }, [data, selectedIndex]);

  if (!data) {
    return (
      <main className="recommendations-page">
        <section className="recommendations-shell">
          <article className="empty-recommendation panel">
            <h1>No Quiz Result Yet</h1>

            <p>
              Complete a quiz first, submit your answers, then StudyFlow will
              generate smart recommendations based on your real quiz result.
            </p>

            <button
              type="button"
              className="primary-action"
              onClick={() => navigate("/quiz")}
            >
              Go to Quiz
            </button>
          </article>
        </section>
      </main>
    );
  }

  const improvement =
    data.improvement ??
    Number(data.latestScore || 0) - Number(data.previousScore || 0);

  const improvementText = `${improvement >= 0 ? "+" : ""}${improvement}%`;

  async function handleReviewSummary(item) {
    const focus = buildFocus(data, item);

    localStorage.setItem("studyflow_summary_focus", JSON.stringify(focus));

    saveLogoutRecommendationEmail(data, item);
    await saveRecommendationsForEmail([item]);

    if (focus.noteId) {
      navigate(`/notes/${focus.noteId}`, {
        state: {
          ...focus,
          openSummary: true,
          scrollToSummary: true,
        },
      });
      return;
    }

    navigate("/summaries", { state: focus });
  }

  async function handleGenerateQuiz(item) {
    const focus = buildFocus(data, item);

    const focusedRequest = {
      ...focus,
      mode: "focused_recommendation_quiz",
      recommendedQuizType: focus.quizType,
    };

    localStorage.setItem(
      "studyflow_focused_quiz_request",
      JSON.stringify(focusedRequest)
    );

    saveLogoutRecommendationEmail(data, item);
    await saveRecommendationsForEmail([item]);

    if (focus.noteId) {
      navigate(`/quiz/${focus.noteId}`, {
        state: focusedRequest,
      });
      return;
    }

    navigate("/quiz", {
      state: focusedRequest,
    });
  }

  async function handleAskPdf(item) {
    const focus = buildFocus(data, item);

    localStorage.setItem("studyflow_askpdf_focus", JSON.stringify(focus));

    saveLogoutRecommendationEmail(data, item);
    await saveRecommendationsForEmail([item]);

    if (focus.noteId) {
      navigate(`/notes/${focus.noteId}`, {
        state: {
          ...focus,
          openAskPdf: true,
          scrollToAskPdf: true,
        },
      });
      return;
    }

    navigate("/ask-pdf", {
      state: focus,
    });
  }

  return (
    <main className="recommendations-page">
      <section className="recommendations-shell">
        <header className="recommendations-header">
          <div>
            <span className="studyflow-badge">StudyFlow</span>
            <h1>Smart Study Recommendations</h1>

            <p>
              Based on your latest quiz performance and the note you studied.
            </p>
          </div>
        </header>

        <section className="score-summary-card">
          <div
            className="score-ring"
            style={{ "--score": `${Number(data.latestScore || 0)}%` }}
          >
            <div>
              <strong>{data.latestScore}%</strong>
            </div>
          </div>

          <div className="summary-grid">
            <div>
              <span>Latest Quiz Result</span>
              <strong>{data.latestScore}%</strong>
            </div>

            <div>
              <span>Previous</span>
              <strong>{data.previousScore}%</strong>
            </div>

            <div>
              <span>Improvement</span>
              <strong className="positive">{improvementText}</strong>
            </div>

            <div>
              <span>Recommended Focus</span>
              <strong className="focus-text">
                {selectedWeakTopic.topic ||
                  data.recommendedFocus ||
                  "Current Quiz Topic"}
              </strong>
            </div>
          </div>
        </section>

        <section className="rec-stats-grid">
          <StatCard
            icon="☰"
            label="Weak Areas"
            value={weakTopics.length || 0}
            color="blue"
          />

          <StatCard
            icon="⚑"
            label="High Priority"
            value={data.highPriority || 0}
            color="red"
          />

          <StatCard
            icon="✓"
            label="Correct Answers"
            value={data.completed || 0}
            color="green"
          />

          <StatCard
            icon="⌁"
            label="Avg Score"
            value={`${data.averageScore || data.latestScore || 0}%`}
            color="purple"
          />
        </section>

        <section className="recommendations-main-grid">
          <article className="panel weak-topics-panel">
            <h2>What You Should Review</h2>

            <div className="weak-topic-list">
              {weakTopics.map((item, index) => (
                <WeakTopicCard
                  key={`${item.topic}-${item.score}-${item.priority}-${index}`}
                  data={data}
                  item={item}
                  selected={index === selectedIndex}
                  onSelect={() => setSelectedIndex(index)}
                />
              ))}
            </div>
          </article>

          <article className="panel ai-advice-panel">
            <h2>Selected Weak Point</h2>

            <div className="selected-focus-box">
              <span>Topic</span>
              <strong>{selectedWeakTopic.topic || "Current Topic"}</strong>
            </div>

            <div className="selected-focus-box">
              <span>Source</span>
              <strong>{getSourceText(data, selectedWeakTopic)}</strong>
            </div>

            <div className="selected-focus-box">
              <span>Next Step</span>

              <p>
                Review this part from the same note, then generate a focused
                quiz only for this weak topic.
              </p>
            </div>

            <div className="single-actions">
              <button
                type="button"
                onClick={() => handleReviewSummary(selectedWeakTopic)}
              >
                Review Summary
              </button>

              <button
                type="button"
                className="primary-action"
                onClick={() => handleGenerateQuiz(selectedWeakTopic)}
              >
                Generate Quiz
              </button>

              <button
                type="button"
                onClick={() => handleAskPdf(selectedWeakTopic)}
              >
                Ask PDF
              </button>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}