import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ScreenRecorderMenu from "../components/ScreenRecorderMenu";
const PDF_RAG_URL =
  import.meta.env.VITE_PDF_RAG_URL || "http://127.0.0.1:8003";

const parseMcqQuiz = (text) => {
  const raw = String(text || "");

  const cleaned = raw
    .replace(/\*\*/g, "")
    .replace(/\r/g, "")
    .trim();

  const questionBlocks = cleaned
    .split(/\n(?=Q\d+\s*(?:\([^)]+\))?\s*:)/i)
    .filter((block) => /^Q\d+\s*(?:\([^)]+\))?\s*:/i.test(block.trim()));

  return questionBlocks
    .map((block, index) => {
      const qMatch = block.match(
        /^Q(\d+)\s*(?:\([^)]+\))?\s*:\s*([\s\S]*?)(?=\n\s*A\.)/i
      );

      if (!qMatch) return null;

      const questionNumber = qMatch[1] || String(index + 1);

      const questionText = qMatch[2]
        .replace(/\((Hard|Medium|Easy)\)/gi, "")
        .trim();

      const options = [];
      const optionRegex =
        /^\s*([A-D])\.\s*([\s\S]*?)(?=\n\s*[A-D]\.|\n\s*Correct answer\s*:|\n\s*Explanation\s*:|$)/gim;

      let optionMatch;

      while ((optionMatch = optionRegex.exec(block)) !== null) {
        options.push({
          letter: optionMatch[1].toUpperCase(),
          text: optionMatch[2].trim(),
        });
      }

      const answerMatch = block.match(/Correct answer\s*:\s*([A-D])/i);
      const correctAnswer = answerMatch ? answerMatch[1].toUpperCase() : "";

      const explanationMatch = block.match(/Explanation\s*:\s*([\s\S]*)/i);
      const explanation = explanationMatch ? explanationMatch[1].trim() : "";

      if (!questionText || options.length < 2 || !correctAnswer) return null;

      return {
        id: `q-${questionNumber}-${index}`,
        number: questionNumber,
        question: questionText,
        options,
        correctAnswer,
        explanation,
      };
    })
    .filter(Boolean);
};

export default function QuizPage() {
  const fileInputRef = useRef(null);
  const activeRequestIdRef = useRef(0);
  const navigate = useNavigate();

  const REQUEST_TIMEOUT_MS = 8 * 60 * 1000;

  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedModel, setSelectedModel] = useState("llama3.2:3b");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [quizText, setQuizText] = useState("");
  const [sources, setSources] = useState([]);
  const [uploadedPdfId, setUploadedPdfId] = useState("");
  const [status, setStatus] = useState("Upload a PDF file to get started.");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeMode, setThemeMode] = useState("light");

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
    if (answeredCount !== parsedQuestions.length) return;

    const total = parsedQuestions.length;
    const correct = parsedQuestions.filter(
      (q) => selectedAnswers[q.id] === q.correctAnswer
    ).length;

    const wrongQuestions = parsedQuestions
      .map((q, index) => {
        const selectedLetter = selectedAnswers[q.id];

        const selectedOption = q.options.find(
          (option) => option.letter === selectedLetter
        );

        const correctOption = q.options.find(
          (option) => option.letter === q.correctAnswer
        );

        return {
          number: index + 1,
          question: q.question,
          selectedAnswer: selectedLetter,
          selectedAnswerText: selectedOption?.text || "",
          correctAnswer: q.correctAnswer,
          correctAnswerText: correctOption?.text || "",
          explanation: q.explanation,
          isWrong: selectedLetter !== q.correctAnswer,
        };
      })
      .filter((item) => item.isWrong);

    const percentage = total ? Math.round((correct / total) * 100) : 0;

    const recommendationPayload = {
      type: "quiz",
      title: selectedFile?.name || "Generated Quiz",
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
      "studyflow_latest_quiz_recommendation",
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
    setStatus(`Selected: ${file.name}`);
  }

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

    const fetchWithTimeout = async (
      url,
      options = {},
      timeoutMs = REQUEST_TIMEOUT_MS
    ) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        return await fetch(url, {
          ...options,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    };

    try {
      let pdfId = uploadedPdfId;

      if (!pdfId) {
        const formData = new FormData();
        formData.append("file", selectedFile);

        console.log("PDF_RAG_URL =", PDF_RAG_URL);
        console.log("PROCESS URL =", `${PDF_RAG_URL}/process`);

        const uploadResponse = await fetchWithTimeout(
          `${PDF_RAG_URL}/process`,
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
        console.log("UPLOAD DATA:", uploadData);

        pdfId =
          uploadData.doc_id ||
          uploadData.pdf_id ||
          uploadData.docId ||
          uploadData.document_id ||
          uploadData.id;

        if (!pdfId) {
          throw new Error("PDF uploaded, but no doc_id/docId was returned.");
        }

        setUploadedPdfId(pdfId);
      }

     const promptText = `
Generate exactly 5 high-quality MCQs from the uploaded PDF content only.

Strict rules:
- Use only facts clearly found in the uploaded PDF.
- Create exactly 5 questions: 3 Hard + 2 Medium.
- Each question must have exactly 4 options: A, B, C, D.
- Correct answer must be one letter only: A, B, C, or D.
- Never use "All of the above".
- Never use "None of the above".
- Never use "Both A and B" or combined options.
- Each question must have only ONE clearly correct answer.
- Do not make options where A, B, and C are all true.
- Avoid vague questions like "What benefit..." if multiple benefits are correct.
- Ask specific questions about one concept, definition, relationship, actor, or diagram label.
- Wrong options must be related to the same topic but clearly incorrect.
- Keep options short.
- Add a short explanation.
- Output only the quiz. No intro sentence.

${customPrompt.trim() ? `Focus topic: ${customPrompt.trim()}` : ""}

Format exactly:
Q1 (Hard): ...
A. ...
B. ...
C. ...
D. ...
Correct answer: A
Explanation: ...

Q2 (Hard): ...
A. ...
B. ...
C. ...
D. ...
Correct answer: B
Explanation: ...

Q3 (Hard): ...
A. ...
B. ...
C. ...
D. ...
Correct answer: C
Explanation: ...

Q4 (Medium): ...
A. ...
B. ...
C. ...
D. ...
Correct answer: D
Explanation: ...

Q5 (Medium): ...
A. ...
B. ...
C. ...
D. ...
Correct answer: A
Explanation: ...
`.trim();

      const isValidQuiz = (text) => {
        const parsed = parseMcqQuiz(text);

        if (parsed.length !== 5) {
          return false;
        }

        const bannedPhrases = [
          "all of the above",
          "none of the above",
          "both a and b",
          "both b and c",
          "both c and d",
          "a and b",
          "b and c",
          "c and d",
          "all options",
        ];

        const allText = text.toLowerCase();

        const hasBannedPhrase = bannedPhrases.some((phrase) =>
          allText.includes(phrase)
        );

        if (hasBannedPhrase) {
          return false;
        }

        return parsed.every((q) => {
          const hasQuestion = q.question && q.question.trim().length > 10;

          const hasFourOptions =
            Array.isArray(q.options) && q.options.length === 4;

          const optionsAreFilled =
            hasFourOptions &&
            q.options.every(
              (option) => option.text && option.text.trim().length >= 3
            );

          const hasCorrectAnswer = /^[A-D]$/.test(q.correctAnswer || "");

          const duplicateOptions =
            new Set(
              q.options.map((option) => option.text.trim().toLowerCase())
            ).size !== q.options.length;

          return (
            hasQuestion &&
            hasFourOptions &&
            optionsAreFilled &&
            hasCorrectAnswer &&
            !duplicateOptions
          );
        });
      };

      const extractQuizText = (quizData) => {
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

          if (typeof value === "string") {
            return value.trim();
          }

          if (typeof value === "object") {
            return JSON.stringify(value, null, 2);
          }

          return String(value).trim();
        };

        const texts = candidates.map(normalizeText).filter(Boolean);

        const mcqText = texts.find((text) => {
          return (
            /Q1\s*(?:\([^)]+\))?\s*:/i.test(text) &&
            /\n\s*A\./i.test(text) &&
            /Correct answer\s*:/i.test(text)
          );
        });

        if (mcqText) {
          return mcqText
            .replace(/^.*?(?=Q1\s*(?:\([^)]+\))?\s*:)/is, "")
            .trim();
        }

        const nonFallbackText = texts.find((text) => {
          const lower = text.toLowerCase();

          return (
            !lower.includes("i couldn't find this information") &&
            !lower.includes("could you ask about something shown") &&
            !lower.includes("i could not find this information")
          );
        });

        return nonFallbackText || texts[0] || "";
      };

      const askRagForQuiz = async (prompt) => {
        console.log("GENERATE URL =", `${PDF_RAG_URL}/generate`);

        const quizResponse = await fetchWithTimeout(
          `${PDF_RAG_URL}/generate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              doc_id: pdfId,
              pdf_id: pdfId,
              docId: pdfId,
              document_id: pdfId,

              prompt,
              question: prompt,
              query: prompt,

              model: selectedModel,
              questions_count: 5,
              total_questions: 5,
            }),
          }
        );

        if (!quizResponse.ok) {
          const text = await quizResponse.text();
          throw new Error(`Quiz generation failed: ${text}`);
        }

        const quizData = await quizResponse.json();

        return {
          quizData,
          generatedQuiz: extractQuizText(quizData),
        };
      };

      setStatus("Generating 5 MCQs from the PDF...");

      const result = await askRagForQuiz(promptText);

      if (activeRequestIdRef.current !== requestId) {
        return;
      }

      if (!result.generatedQuiz) {
        throw new Error("The backend returned an empty quiz. Please try again.");
      }

      setQuizText(result.generatedQuiz);
      setSources(result.quizData.sources || result.quizData.result?.sources || []);

      if (isValidQuiz(result.generatedQuiz)) {
        setStatus("Quiz generated successfully.");
      } else {
        setStatus(
          "Quiz generated, but the format was not perfect. Review the output and try again if needed."
        );
      }

      return;
    } catch (err) {
      if (activeRequestIdRef.current !== requestId) {
        return;
      }

      console.error(err);

      if (err.name === "AbortError") {
        setError(
          "The request took too long. The PDF may be large or Ollama is still busy. Please try again, or use qwen3:1.7b."
        );
      } else {
        setError(err.message || "Something went wrong while generating the quiz.");
      }

      setStatus("Failed to generate quiz.");
    } finally {
      if (activeRequestIdRef.current === requestId) {
        setLoading(false);
      }
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

        .quiz-output {
          white-space: pre-wrap;
          line-height: 1.7;
          font-size: 15px;
          color: #111827;
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
                      {parsedQuestions.length > 0 ? (
                        <div className="quiz-interactive">
                          {parsedQuestions.map((q, index) => {
                            const selected = selectedAnswers[q.id];
                            const isCorrect = selected === q.correctAnswer;

                            return (
                              <div className="quiz-question-card" key={q.id}>
                                <h3>
                                  Q{index + 1}: {q.question}
                                </h3>

                                <div className="quiz-options">
                                  {q.options.map((option) => {
                                    const isSelected = selected === option.letter;

                                    const isCorrectOption =
                                      submitted && option.letter === q.correctAnswer;

                                    const isWrongSelected =
                                      submitted &&
                                      isSelected &&
                                      option.letter !== q.correctAnswer;

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
                                        Wrong ❌ Correct answer: {q.correctAnswer}
                                      </strong>
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
                              disabled={answeredCount !== parsedQuestions.length}
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
                                    (q) => selectedAnswers[q.id] === q.correctAnswer
                                  ).length
                                }
                                /{parsedQuestions.length}
                              </div>

                              <button
                                type="button"
                                className="recommendation-link-btn"
                                onClick={() => {
                                  const saved = localStorage.getItem(
                                    "studyflow_latest_quiz_recommendation"
                                  );

                                  const recommendation = saved ? JSON.parse(saved) : null;

                                  navigate("/recommendations", {
                                    state: {
                                      recommendation,
                                    },
                                  });
                                }}
                              >
                                View Study Recommendations
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="quiz-output">{quizText}</div>
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
