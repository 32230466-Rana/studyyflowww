import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ScreenRecorderMenu from "../components/ScreenRecorderMenu";

const PDF_RAG_URL = import.meta.env.VITE_PDF_RAG_URL || "http://127.0.0.1:8003";

const cleanPdfArtifacts = (value) => {
    return String(value || "")
        .replace(/\bflowa\b/gi, "flow")
        .replace(/\bdiagrama\b/gi, "diagram")
        .replace(/\bDFDa\b/g, "DFD")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
};

const normalizeForCompare = (value) => {
    return cleanPdfArtifacts(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
};

const hasUnsafeQuestionWording = (question) => {
    const q = normalizeForCompare(question);

    const unsafePatterns = [
        /\bpurpose\b/,
        /\bwhy\b/,
        /\bbenefit\b/,
        /\badvantage\b/,
        /\bafter\b/,
        /\bbefore\b/,
        /\bnext step\b/,
        /\bcomes after\b/,
        /\bsequence\b/,
        /\border\b/,
        /\bstage\b/,
        /\brepresent\b/,
        /\brepresents\b/,
        /\bmean\b/,
        /\bmeans\b/,
        /\bprocess\b.*\bstep\b/,
        /\bmodern structured analysis process\b/,
    ];

    return unsafePatterns.some((pattern) => pattern.test(q));
};

const getWords = (text) =>
    normalizeForCompare(text).split(/\s+/).filter(Boolean);

const looksLikeTermAnswer = (text) => {
    const normalized = normalizeForCompare(text);
    const words = getWords(text);

    if (words.length < 1 || words.length > 7) return false;

    const sentenceStarts = [
        "to ",
        "a ",
        "an ",
        "the ",
        "data ",
        "drawing ",
        "creating ",
        "merging ",
        "defining ",
        "showing ",
    ];

    if (sentenceStarts.some((start) => normalized.startsWith(start)))
        return false;

    const sentenceWords = [
        "because",
        "when",
        "where",
        "which",
        "that",
        "must",
        "can",
        "should",
        "moving",
        "showing",
        "defining",
        "drawing",
        "creating",
        "merging",
        "establish",
        "establishing",
    ];

    if (words.some((word) => sentenceWords.includes(word))) return false;

    return true;
};

const isTermQuestion = (question) => {
    const q = normalizeForCompare(question);

    return (
        q.startsWith("what is the term for") ||
        q.startsWith("which term describes") ||
        q.startsWith("which concept describes") ||
        q.startsWith("which type of") ||
        q.startsWith("which type describes") ||
        q.startsWith("which of the following terms") ||
        q.startsWith("which of the following concepts")
    );
};

const getConceptFamily = (text) => {
    const normalized = normalizeForCompare(text);

    if (/\bdata flow\b/.test(normalized)) return "data-flow-family";
    if (/\bdfd\b|\bdata flow diagram\b/.test(normalized)) return "dfd-family";
    if (/\bevent\b/.test(normalized)) return "event-family";
    if (/\bdecomposition\b/.test(normalized)) return "decomposition-family";

    return normalized;
};

const questionAnswerAreAligned = (question, correctText) => {
    if (!isTermQuestion(question)) return false;
    return looksLikeTermAnswer(correctText);
};

const parsedQuestionIsSafe = (
    q,
    usedCorrectAnswers = new Set(),
    usedConceptFamilies = new Map()
) => {
    if (!q?.question || !Array.isArray(q.options)) return false;
    if (q.options.length !== 4) return false;
    if (!/^[A-D]$/.test(q.correctAnswer || "")) return false;
    if (hasUnsafeQuestionWording(q.question)) return false;

    const bannedText = [
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

    const joined = normalizeForCompare(
        [
            q.question,
            q.explanation,
            ...q.options.map((option) => option.text),
        ].join(" ")
    );

    if (bannedText.some((phrase) => joined.includes(phrase))) return false;

    const optionTexts = q.options.map((option) =>
        normalizeForCompare(option.text)
    );
    if (new Set(optionTexts).size !== 4) return false;

    if (!q.options.every((option) => looksLikeTermAnswer(option.text)))
        return false;

    const correctOption = q.options.find(
        (option) => option.letter === q.correctAnswer
    );

    if (!correctOption?.text) return false;

    const correctText = cleanPdfArtifacts(correctOption.text);
    const normalizedCorrect = normalizeForCompare(correctText);

    if (!questionAnswerAreAligned(q.question, correctText)) return false;

    if (usedCorrectAnswers.has(normalizedCorrect)) return false;

    const conceptFamily = getConceptFamily(correctText);
    const usedFamilyCount = usedConceptFamilies.get(conceptFamily) || 0;

    if (conceptFamily === "data-flow-family" && usedFamilyCount >= 2)
        return false;
    if (conceptFamily !== "data-flow-family" && usedFamilyCount >= 1)
        return false;

    const explanation = normalizeForCompare(q.explanation);
    const correctWords = normalizedCorrect
        .split(/\s+/)
        .filter((word) => word.length > 3);

    if (
        q.explanation &&
        correctWords.length > 0 &&
        !correctWords.some((word) => explanation.includes(word))
    ) {
        return false;
    }

    return true;
};

const formatQuestionsAsQuiz = (questions) => {
    return questions
        .map((q, index) => {
            const difficulty = index < 3 ? "Hard" : "Medium";

            const options = ["A", "B", "C", "D"]
                .map((letter) => {
                    const option = q.options.find(
                        (item) => item.letter === letter
                    );
                    return `${letter}. ${cleanPdfArtifacts(
                        option?.text || ""
                    )}`;
                })
                .join("\n");

            return [
                `Q${index + 1} (${difficulty}): ${cleanPdfArtifacts(
                    q.question
                )}`,
                options,
                `Correct answer: ${q.correctAnswer}`,
                `Explanation: ${cleanPdfArtifacts(q.explanation)}`,
            ].join("\n");
        })
        .join("\n\n");
};

const selectSafeQuizText = (candidateText) => {
    const parsed = parseMcqQuiz(candidateText);
    const usedCorrectAnswers = new Set();
    const usedConceptFamilies = new Map();
    const selected = [];

    for (const question of parsed) {
        if (
            parsedQuestionIsSafe(
                question,
                usedCorrectAnswers,
                usedConceptFamilies
            )
        ) {
            const correctOption = question.options.find(
                (option) => option.letter === question.correctAnswer
            );

            const correctText = cleanPdfArtifacts(correctOption?.text || "");
            const conceptFamily = getConceptFamily(correctText);

            usedCorrectAnswers.add(normalizeForCompare(correctText));
            usedConceptFamilies.set(
                conceptFamily,
                (usedConceptFamilies.get(conceptFamily) || 0) + 1
            );
            selected.push(question);
        }

        if (selected.length === 5) break;
    }

    if (selected.length < 5) {
        return {
            quizText: "",
            selectedCount: selected.length,
            totalCandidates: parsed.length,
        };
    }

    return {
        quizText: formatQuestionsAsQuiz(selected),
        selectedCount: selected.length,
        totalCandidates: parsed.length,
    };
};

const extractChunkText = (value) => {
    if (!value) return "";

    if (typeof value === "string") {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(extractChunkText).filter(Boolean).join("\n\n");
    }

    if (typeof value === "object") {
        return (
            value.text ||
            value.content ||
            value.page_content ||
            value.chunk ||
            value.document ||
            value.summary ||
            extractChunkText(value.chunks) ||
            extractChunkText(value.data) ||
            extractChunkText(value.result) ||
            extractChunkText(value.documents) ||
            ""
        );
    }

    return "";
};

const parseMcqQuiz = (text) => {
    const raw = cleanPdfArtifacts(text);

    const cleaned = raw.replace(/\*\*/g, "").replace(/\r/g, "").trim();

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

            const questionText = cleanPdfArtifacts(
                qMatch[2].replace(/\((Hard|Medium|Easy)\)/gi, "")
            );

            const options = [];
            const optionRegex =
                /^\s*([A-D])\.\s*([\s\S]*?)(?=\n\s*[A-D]\.|\n\s*Correct answer\s*:|\n\s*Explanation\s*:|$)/gim;

            let optionMatch;

            while ((optionMatch = optionRegex.exec(block)) !== null) {
                options.push({
                    letter: optionMatch[1].toUpperCase(),
                    text: cleanPdfArtifacts(optionMatch[2]),
                });
            }

            const answerMatch = block.match(/Correct answer\s*:\s*([A-D])/i);
            const correctAnswer = answerMatch
                ? answerMatch[1].toUpperCase()
                : "";

            const explanationMatch = block.match(
                /Explanation\s*:\s*([\s\S]*)/i
            );
            const explanation = explanationMatch
                ? cleanPdfArtifacts(explanationMatch[1])
                : "";

            if (!questionText || options.length < 2 || !correctAnswer)
                return null;

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
                    throw new Error(
                        "PDF uploaded, but no doc_id/docId was returned."
                    );
                }

                setUploadedPdfId(pdfId);
            }

            const getPdfContext = async () => {
                try {
                    const chunksResponse = await fetchWithTimeout(
                        `${PDF_RAG_URL}/get_chunks`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                                docId: pdfId,
                                doc_id: pdfId,
                                document_id: pdfId,
                            }),
                        }
                    );

                    if (!chunksResponse.ok) {
                        return "";
                    }

                    const chunksData = await chunksResponse.json();
                    const text = cleanPdfArtifacts(
                        extractChunkText(chunksData)
                    );

                    return text.slice(0, 7000);
                } catch {
                    return "";
                }
            };

            const pdfContext = await getPdfContext();

            const buildPrompt = (attemptNumber, previousIssue = "") =>
                `
You are generating reliable exam MCQs from the uploaded PDF only.

Generate 12 candidate MCQs so the app can keep the safest 5.

Use ONLY term-identification questions. This avoids answer mismatch.

Allowed question wording only:
- "What is the term for ...?"
- "Which term describes ...?"
- "Which concept describes ...?"
- "Which type of ... describes ...?"

Do NOT use these question types:
- Do NOT ask "What does X mean?"
- Do NOT ask "What is the definition of X?"
- Do NOT ask what something represents.
- Do NOT ask about purpose, benefits, advantages, or why.
- Do NOT ask about next step, previous step, order, sequence, or process flow.
- Do NOT ask broad questions where more than one option can be true.

Answer rules:
- The correct option must be a short TERM or CONCEPT name only.
- All four options must be short TERM names, not sentence descriptions.
- Bad option example: "Data flows from multiple sources into a single packet".
- Good option example: "Converging data flow".
- Exactly ONE option must be correct.
- Correct answer must be one letter only.
- Do not repeat the same correct term.
- Use at most two questions from the same concept family such as data flows.
- Wrong options must be related but clearly incorrect.
- No All/None of the above.
- No Both A and B.
- Fix PDF extraction artifacts. Write "data flow", not "data flowa".
- Explanation must directly say why the selected term matches the definition.
- Output only the quiz. No JSON. No intro.

${customPrompt.trim() ? `Focus topic: ${customPrompt.trim()}` : ""}

${
    previousIssue
        ? `Previous output problem: ${previousIssue}. Regenerate from scratch and avoid that problem.`
        : ""
}

${
    pdfContext
        ? `SOURCE CONTEXT:
${pdfContext}`
        : ""
}

Format exactly:
Q1 (Hard): Which term describes ...?
A. Term one
B. Term two
C. Term three
D. Term four
Correct answer: A
Explanation: The PDF describes [correct term] as ...

Continue until Q12.
`.trim();

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
                        return cleanPdfArtifacts(value);
                    }

                    if (typeof value === "object") {
                        return cleanPdfArtifacts(
                            JSON.stringify(value, null, 2)
                        );
                    }

                    return cleanPdfArtifacts(value);
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
                        !lower.includes(
                            "could you ask about something shown"
                        ) &&
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
                            message: prompt,

                            model: selectedModel,
                            questions_count: 12,
                            total_questions: 12,
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

            setStatus("Generating reliable term-based MCQs from the PDF...");

            const attempts = [
                buildPrompt(1),
                buildPrompt(
                    2,
                    "Use term-identification questions only; avoid represent/meaning/purpose/step questions and duplicate concepts"
                ),
            ];

            let bestQuizText = "";
            let bestQuizData = null;
            let bestSelectedCount = 0;
            let bestTotalCandidates = 0;

            for (const prompt of attempts) {
                const result = await askRagForQuiz(prompt);

                if (activeRequestIdRef.current !== requestId) {
                    return;
                }

                const selected = selectSafeQuizText(result.generatedQuiz);

                if (selected.selectedCount > bestSelectedCount) {
                    bestSelectedCount = selected.selectedCount;
                    bestTotalCandidates = selected.totalCandidates;
                    bestQuizText = selected.quizText;
                    bestQuizData = result.quizData;
                }

                if (selected.quizText) {
                    break;
                }
            }

            if (activeRequestIdRef.current !== requestId) {
                return;
            }

            if (!bestQuizText) {
                throw new Error(
                    `I could not build 5 reliable term-based MCQs from this output. Reliable questions found: ${bestSelectedCount}/${bestTotalCandidates}. Try a more specific focus topic or use a PDF section with more definitions.`
                );
            }

            setQuizText(bestQuizText);
            setSources(
                bestQuizData?.sources || bestQuizData?.result?.sources || []
            );

            setStatus(
                bestSelectedCount === 5
                    ? "Reliable quiz generated successfully."
                    : "Quiz generated, but review carefully."
            );

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
                setError(
                    err.message ||
                        "Something went wrong while generating the quiz."
                );
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
                        <h1 className="quiz-title">
                            ðŸ“š AI Tutor â€“ Smart Quiz Generator
                        </h1>
                        <ScreenRecorderMenu />
                    </div>

                    <p className="quiz-subtitle">
                        Upload a PDF and generate 5 exam-style MCQs using your
                        local PDF RAG.
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
                        <div className="upload-icon">ðŸ“</div>

                        <strong>
                            Drag & drop a PDF file here, or click to upload
                        </strong>

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
                            <option value="phi4-mini:latest">
                                phi4-mini:latest
                            </option>
                            <option value="llama3.2-3b-2k:latest">
                                llama3.2-3b-2k:latest
                            </option>
                            <option value="qwen3:1.7b">qwen3:1.7b</option>
                            <option value="phi3:mini">phi3:mini</option>
                        </select>

                        <div className="prompt-row">
                            <input
                                className="prompt-input"
                                type="text"
                                placeholder="Optional: focus MCQs on a topic..."
                                value={customPrompt}
                                onChange={(e) =>
                                    setCustomPrompt(e.target.value)
                                }
                                onKeyDown={(e) => {
                                    if (
                                        e.key === "Enter" &&
                                        selectedFile &&
                                        !loading
                                    ) {
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
                                {loading ? "..." : "âž¤"}
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
                                        const isCorrect =
                                            selected === q.correctAnswer;

                                        return (
                                            <div
                                                className="quiz-question-card"
                                                key={q.id}
                                            >
                                                <h3>
                                                    Q{index + 1}: {q.question}
                                                </h3>

                                                <div className="quiz-options">
                                                    {q.options.map((option) => {
                                                        const isSelected =
                                                            selected ===
                                                            option.letter;

                                                        const isCorrectOption =
                                                            submitted &&
                                                            option.letter ===
                                                                q.correctAnswer;

                                                        const isWrongSelected =
                                                            submitted &&
                                                            isSelected &&
                                                            option.letter !==
                                                                q.correctAnswer;

                                                        return (
                                                            <button
                                                                type="button"
                                                                key={
                                                                    option.letter
                                                                }
                                                                className={[
                                                                    "quiz-option",
                                                                    isSelected
                                                                        ? "selected"
                                                                        : "",
                                                                    isCorrectOption
                                                                        ? "correct"
                                                                        : "",
                                                                    isWrongSelected
                                                                        ? "wrong"
                                                                        : "",
                                                                ].join(" ")}
                                                                onClick={() =>
                                                                    handleSelectAnswer(
                                                                        q.id,
                                                                        option.letter
                                                                    )
                                                                }
                                                            >
                                                                <span>
                                                                    {
                                                                        option.letter
                                                                    }
                                                                    .
                                                                </span>
                                                                <p>
                                                                    {
                                                                        option.text
                                                                    }
                                                                </p>
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
                                                            <strong>
                                                                Correct âœ…
                                                            </strong>
                                                        ) : (
                                                            <strong>
                                                                Wrong âŒ Correct
                                                                answer:{" "}
                                                                {
                                                                    q.correctAnswer
                                                                }
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
                                            disabled={
                                                answeredCount !==
                                                parsedQuestions.length
                                            }
                                        >
                                            Submit Answers
                                        </button>
                                    )}

                                    {!submitted &&
                                        answeredCount !==
                                            parsedQuestions.length && (
                                            <p className="quiz-hint">
                                                Answer all questions before
                                                submitting.
                                            </p>
                                        )}

                                    {submitted && (
                                        <>
                                            <div className="quiz-score">
                                                Score:{" "}
                                                {
                                                    parsedQuestions.filter(
                                                        (q) =>
                                                            selectedAnswers[
                                                                q.id
                                                            ] ===
                                                            q.correctAnswer
                                                    ).length
                                                }
                                                /{parsedQuestions.length}
                                            </div>

                                            <button
                                                type="button"
                                                className="recommendation-link-btn"
                                                onClick={() => {
                                                    const saved =
                                                        localStorage.getItem(
                                                            "studyflow_latest_quiz_recommendation"
                                                        );

                                                    const recommendation = saved
                                                        ? JSON.parse(saved)
                                                        : null;

                                                    navigate(
                                                        "/recommendations",
                                                        {
                                                            state: {
                                                                recommendation,
                                                            },
                                                        }
                                                    );
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
