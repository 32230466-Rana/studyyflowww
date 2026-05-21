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
    <div className="quiz-page">
      <style>{`
        .quiz-page {
          width: 100%;
          min-height: 100vh;
          background: #f7f7fb;
          padding: 28px;
          color: #111827;
        }

        .quiz-shell {
          max-width: 950px;
          margin: 0 auto;
        }

        .quiz-card {
          background: #ffffff;
          border-radius: 18px;
          padding: 28px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
          border: 1px solid #e5e7eb;
        }

        .quiz-header-row {
          position: relative;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .quiz-title {
          text-align: center;
          font-size: 28px;
          font-weight: 800;
          margin-bottom: 8px;
        }

        .quiz-subtitle {
          text-align: center;
          color: #6b7280;
          margin-bottom: 24px;
        }

        .drop-box {
          border: 2px dashed #111827;
          border-radius: 16px;
          background: #fafafa;
          padding: 28px;
          text-align: center;
          cursor: pointer;
          transition: 0.2s ease;
        }

        .drop-box:hover {
          background: #f1f5f9;
        }

        .upload-icon {
          font-size: 36px;
          margin-bottom: 10px;
        }

        .file-name {
          margin-top: 14px;
          font-weight: 700;
          color: #4f46e5;
        }

        .actions {
          display: flex;
          justify-content: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 22px;
        }

        .btn {
          border: none;
          border-radius: 12px;
          padding: 12px 18px;
          font-weight: 700;
          cursor: pointer;
        }

        .btn-primary {
          background: #4f46e5;
          color: white;
        }

        .btn-secondary {
          background: #e5e7eb;
          color: #111827;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .quiz-extra-panel {
          max-width: 520px;
          margin: 22px auto 0;
        }

        .model-label {
          display: block;
          font-size: 14px;
          color: #374151;
          font-weight: 600;
          margin-bottom: 8px;
        }

        .model-select {
          width: 100%;
          border: none;
          background: #eef0f5;
          border-radius: 10px;
          padding: 13px 14px;
          font-size: 15px;
          color: #1f2937;
          outline: none;
          margin-bottom: 14px;
        }

        .prompt-row {
          display: flex;
          align-items: center;
          background: #eef0f5;
          border-radius: 10px;
          overflow: hidden;
        }

        .prompt-input {
          flex: 1;
          border: none;
          background: transparent;
          padding: 13px 14px;
          font-size: 15px;
          outline: none;
          color: #111827;
        }

        .send-btn {
          border: none;
          background: transparent;
          color: #9ca3af;
          font-size: 23px;
          padding: 8px 14px;
          cursor: pointer;
        }

        .send-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .upload-warning {
          margin-top: 14px;
          background: #fff8db;
          color: #92400e;
          border-radius: 10px;
          padding: 16px;
          text-align: left;
          font-size: 14px;
        }

        .status {
          text-align: center;
          color: #6b7280;
          margin-top: 16px;
        }

        .error {
          margin-top: 18px;
          background: #fee2e2;
          color: #991b1b;
          border: 1px solid #fecaca;
          padding: 12px;
          border-radius: 12px;
        }

        .quiz-result {
          margin-top: 26px;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 22px;
        }

        .quiz-result h2 {
          margin-bottom: 14px;
          font-size: 22px;
        }

        .quiz-output {
          white-space: pre-wrap;
          line-height: 1.7;
          font-size: 15px;
          color: #111827;
        }

        .sources {
          margin-top: 18px;
          color: #6b7280;
          font-size: 14px;
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
          margin-bottom: 14px;
          font-size: 18px;
          font-weight: 700;
          color: #111827;
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
          border-radius: 12px;
          padding: 12px 14px;
          text-align: left;
          display: flex;
          gap: 10px;
          cursor: pointer;
          transition: 0.2s ease;
        }

        .quiz-option:hover {
          border-color: #6366f1;
          background: #f8f7ff;
        }

        .quiz-option.selected {
          border-color: #4f46e5;
          background: #eef2ff;
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
          font-weight: 700;
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
          border-radius: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .submit-answers-btn {
          background: #4f46e5;
        }

        .recommendation-link-btn {
          background: #111827;
        }

        .submit-answers-btn:disabled {
          background: #9ca3af;
          cursor: not-allowed;
        }

        .quiz-hint {
          color: #6b7280;
          margin-top: -8px;
        }

        .quiz-score {
          padding: 14px;
          background: #f3f4f6;
          border-radius: 12px;
          font-weight: 700;
        }

        @media (max-width: 768px) {
          .quiz-page {
            padding: 16px;
          }

          .quiz-card {
            padding: 18px;
          }

          .quiz-title {
            font-size: 23px;
            padding-right: 42px;
          }
        }
      `}</style>

      <div className="quiz-shell">
        <div className="quiz-card">
          <div className="quiz-header-row">
            <h1 className="quiz-title">📚 AI Tutor – Smart Quiz Generator</h1>
            <ScreenRecorderMenu />
          </div>

          <p className="quiz-subtitle">
            Upload a PDF and generate 5 exam-style MCQs using your local PDF RAG.
          </p>

          <div
            className="drop-box"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFile(e.dataTransfer.files?.[0]);
            }}
          >
            <div className="upload-icon">📁</div>

            <strong>Drag & drop a PDF file here, or click to upload</strong>

            <p>Use your uploaded PDF content only.</p>

            {selectedFile && (
              <div className="file-name">{selectedFile.name}</div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>

          <div className="actions">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              Choose PDF
            </button>

            <button
              className="btn btn-primary"
              type="button"
              onClick={generateQuiz}
              disabled={loading || !selectedFile}
            >
              {loading ? "Generating..." : "Generate 5 MCQs"}
            </button>
          </div>

          <div className="quiz-extra-panel">
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

            <div className="prompt-row">
              <input
                className="prompt-input"
                type="text"
                placeholder="Optional: focus MCQs on a topic..."
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
                {loading ? "..." : "➤"}
              </button>
            </div>

            {!selectedFile && (
              <div className="upload-warning">
                Upload a PDF file to get started.
              </div>
            )}
          </div>

          <div className="status">{status}</div>

          {error && <div className="error">{error}</div>}

          {quizText && (
            <div className="quiz-result">
              <h2>Generated Quiz</h2>

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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}