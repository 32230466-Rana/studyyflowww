import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import axiosClient from "../api/axiosClient";

export default function QuizPage() {
    const { id } = useParams();
    const [searchParams] = useSearchParams();

    const initialType = searchParams.get("type") || "mcq";
    const initialDifficulty = searchParams.get("difficulty") || "Mixed";
    const initialCount = Number(searchParams.get("count") || 5);

    const [note, setNote] = useState(null);
    const [quizType, setQuizType] = useState(initialType);
    const [difficulty, setDifficulty] = useState(initialDifficulty);
    const [questionsCount, setQuestionsCount] = useState(initialCount);

    const [quiz, setQuiz] = useState(null);
    const [answers, setAnswers] = useState({});
    const [subjectiveAnswers, setSubjectiveAnswers] = useState({});
    const [submittedSubjective, setSubmittedSubjective] = useState(false);

    const [loadingNote, setLoadingNote] = useState(true);
    const [loadingQuiz, setLoadingQuiz] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const loadNote = async () => {
            try {
                setLoadingNote(true);
                setError("");

                const res = await axiosClient.get(`/notes/${id}`);
                setNote(res.data?.data || null);
            } catch (err) {
                setError(
                    err?.response?.data?.message ||
                        "Failed to load this note."
                );
            } finally {
                setLoadingNote(false);
            }
        };

        loadNote();
    }, [id]);

    const getNoteContent = () => {
        return (
            note?.text_content ||
            note?.content ||
            note?.body ||
            note?.description ||
            ""
        ).trim();
    };

    const generateQuiz = async () => {
        try {
            setLoadingQuiz(true);
            setError("");
            setQuiz(null);
            setAnswers({});
            setSubjectiveAnswers({});
            setSubmittedSubjective(false);

            const content = getNoteContent();

            if (!content || content.length < 200) {
                throw new Error(
                    "This note does not have enough extracted text for quiz generation. Use a text note or make sure the PDF text was extracted and saved."
                );
            }

            const res = await axiosClient.post(
                "/ai-tutor/generate-quiz",
                {
                    title:
                        note?.title ||
                        note?.original_filename ||
                        "StudyFlow Quiz",
                    content: content,
                    quiz_type: quizType,
                    difficulty: difficulty,
                    questions_count: Number(questionsCount),
                },
                {
                    timeout: 700000,
                }
            );

            setQuiz(res.data);
        } catch (err) {
            setError(
                err?.response?.data?.message ||
                    err?.response?.data?.error ||
                    err?.response?.data?.detail ||
                    err.message ||
                    "Failed to generate quiz."
            );
        } finally {
            setLoadingQuiz(false);
        }
    };

    const normalizeMcqOptions = (q) => {
        return {
            A: q.option_a || q.options?.A || "",
            B: q.option_b || q.options?.B || "",
            C: q.option_c || q.options?.C || "",
            D: q.option_d || q.options?.D || "",
        };
    };

    const handleMcqAnswer = (questionIndex, selectedLetter) => {
        if (answers[questionIndex]) return;

        const q = quiz.questions[questionIndex];
        const correct = (q.correct_answer || "").toUpperCase();

        setAnswers((prev) => ({
            ...prev,
            [questionIndex]: {
                selected: selectedLetter,
                isCorrect: selectedLetter === correct,
            },
        }));
    };

    const handleTrueFalseAnswer = (questionIndex, selectedAnswer) => {
        if (answers[questionIndex]) return;

        const q = quiz.questions[questionIndex];
        const correct = q.correct_answer;

        setAnswers((prev) => ({
            ...prev,
            [questionIndex]: {
                selected: selectedAnswer,
                isCorrect: selectedAnswer === correct,
            },
        }));
    };

    const getAnswerStyle = (questionIndex, optionValue) => {
        const answer = answers[questionIndex];
        const q = quiz?.questions?.[questionIndex];

        const base = {
            width: "100%",
            textAlign: "left",
            padding: "12px 14px",
            borderRadius: "12px",
            border: "1px solid #ddd",
            background: "#fff",
            color: "#222",
            fontSize: "15px",
            cursor: answer ? "default" : "pointer",
            marginBottom: "10px",
        };

        if (!answer || !q) return base;

        const correct = q.correct_answer;
        const isSelected = answer.selected === optionValue;
        const isCorrect = correct === optionValue;

        if (isSelected && isCorrect) {
            return {
                ...base,
                background: "#e8f8ec",
                border: "1px solid #32a852",
                color: "#1f7a36",
                fontWeight: "bold",
            };
        }

        if (isSelected && !isCorrect) {
            return {
                ...base,
                background: "#fdeaea",
                border: "1px solid #d93025",
                color: "#b42318",
                fontWeight: "bold",
            };
        }

        if (isCorrect) {
            return {
                ...base,
                background: "#e8f8ec",
                border: "1px solid #32a852",
                color: "#1f7a36",
                fontWeight: "bold",
            };
        }

        return {
            ...base,
            opacity: 0.85,
        };
    };

    const currentQuizType = quiz?.quiz_type || quizType;

    const quizTitle =
        quizType === "mcq"
            ? "MCQ Quiz"
            : quizType === "true_false"
              ? "True / False Quiz"
              : "Subjective Quiz";

    if (loadingNote) {
        return (
            <div style={{ padding: 40 }}>
                <p>Loading note...</p>
            </div>
        );
    }

    return (
        <div
            style={{
                minHeight: "100vh",
                background: "#f8f5ff",
                padding: "40px 20px",
                fontFamily: "Arial, sans-serif",
            }}
        >
            <div
                style={{
                    maxWidth: "950px",
                    margin: "0 auto",
                    background: "#ffffff",
                    borderRadius: "20px",
                    padding: "30px",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
                }}
            >
                <Link
                    to={`/notes/${id}`}
                    style={{
                        display: "inline-block",
                        marginBottom: 18,
                        color: "#4b2aad",
                        textDecoration: "none",
                        fontWeight: "bold",
                    }}
                >
                    ← Back to Note
                </Link>

                <h1 style={{ marginBottom: "10px", color: "#4b2aad" }}>
                    Generate {quizTitle}
                </h1>

                <p style={{ marginBottom: "25px", color: "#666" }}>
                    This quiz will be generated from:{" "}
                    <strong>
                        {note?.title || note?.original_filename || "this note"}
                    </strong>
                </p>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns:
                            "repeat(auto-fit, minmax(180px, 1fr))",
                        gap: "15px",
                        marginBottom: "22px",
                    }}
                >
                    <div>
                        <label
                            style={{
                                display: "block",
                                marginBottom: "8px",
                                fontWeight: "bold",
                            }}
                        >
                            Quiz Type
                        </label>

                        <select
                            value={quizType}
                            onChange={(e) => setQuizType(e.target.value)}
                            disabled={loadingQuiz}
                            style={{
                                width: "100%",
                                padding: "12px",
                                borderRadius: "10px",
                                border: "1px solid #ccc",
                                fontSize: "16px",
                                background: "#fff",
                            }}
                        >
                            <option value="mcq">MCQ</option>
                            <option value="true_false">True / False</option>
                            <option value="subjective">Subjective</option>
                        </select>
                    </div>

                    <div>
                        <label
                            style={{
                                display: "block",
                                marginBottom: "8px",
                                fontWeight: "bold",
                            }}
                        >
                            Difficulty
                        </label>

                        <select
                            value={difficulty}
                            onChange={(e) => setDifficulty(e.target.value)}
                            disabled={loadingQuiz}
                            style={{
                                width: "100%",
                                padding: "12px",
                                borderRadius: "10px",
                                border: "1px solid #ccc",
                                fontSize: "16px",
                                background: "#fff",
                            }}
                        >
                            <option value="Mixed">Mixed</option>
                            <option value="Hard">Hard</option>
                            <option value="Medium">Medium</option>
                        </select>
                    </div>

                    <div>
                        <label
                            style={{
                                display: "block",
                                marginBottom: "8px",
                                fontWeight: "bold",
                            }}
                        >
                            Questions
                        </label>

                        <input
                            type="number"
                            min="1"
                            max="10"
                            value={questionsCount}
                            onChange={(e) =>
                                setQuestionsCount(e.target.value)
                            }
                            disabled={loadingQuiz}
                            style={{
                                width: "100%",
                                padding: "12px",
                                borderRadius: "10px",
                                border: "1px solid #ccc",
                                fontSize: "16px",
                                background: "#fff",
                            }}
                        />
                    </div>
                </div>

                <button
                    onClick={generateQuiz}
                    disabled={loadingQuiz}
                    style={{
                        padding: "12px 18px",
                        border: "none",
                        borderRadius: "10px",
                        background: loadingQuiz ? "#999" : "#6c3bff",
                        color: "#fff",
                        fontSize: "16px",
                        fontWeight: "bold",
                        cursor: loadingQuiz ? "not-allowed" : "pointer",
                        marginBottom: "20px",
                    }}
                >
                    {loadingQuiz ? "Generating..." : "Generate Quiz"}
                </button>

                {error && (
                    <div
                        style={{
                            background: "#ffe6e6",
                            color: "#b30000",
                            padding: "12px",
                            borderRadius: "10px",
                            marginBottom: "20px",
                            lineHeight: 1.6,
                        }}
                    >
                        {error}
                    </div>
                )}

                {loadingQuiz && (
                    <div
                        style={{
                            background: "#f3edff",
                            color: "#5a31cc",
                            padding: "14px",
                            borderRadius: "10px",
                            marginBottom: "20px",
                        }}
                    >
                        AI is generating your quiz...
                    </div>
                )}

                {quiz?.questions?.length > 0 && (
                    <div>
                        <div
                            style={{
                                background: "#f7f3ff",
                                padding: "16px",
                                borderRadius: "12px",
                                marginBottom: "20px",
                            }}
                        >
                            <p>
                                <strong>Quiz Type:</strong> {currentQuizType}
                            </p>
                            <p>
                                <strong>Difficulty:</strong>{" "}
                                {quiz.difficulty || difficulty}
                            </p>
                            <p>
                                <strong>Total Questions:</strong>{" "}
                                {quiz.questions.length}
                            </p>
                            {quiz.model && (
                                <p>
                                    <strong>Model:</strong> {quiz.model}
                                </p>
                            )}
                        </div>

                        {quiz.questions.map((q, index) => {
                            const answerState = answers[index];
                            const type = q.type || currentQuizType;
                            const options = normalizeMcqOptions(q);

                            return (
                                <div
                                    key={index}
                                    style={{
                                        border: "1px solid #e3d9ff",
                                        borderRadius: "14px",
                                        padding: "20px",
                                        marginBottom: "18px",
                                        background: "#fff",
                                    }}
                                >
                                    <h3
                                        style={{
                                            color: "#4b2aad",
                                            marginBottom: "10px",
                                        }}
                                    >
                                        Question {index + 1}
                                        {q.difficulty
                                            ? ` - ${q.difficulty}`
                                            : ""}
                                    </h3>

                                    <p
                                        style={{
                                            fontSize: "17px",
                                            fontWeight: "bold",
                                            marginBottom: "15px",
                                            lineHeight: 1.6,
                                        }}
                                    >
                                        {q.question}
                                    </p>

                                    {type === "mcq" && (
                                        <>
                                            {["A", "B", "C", "D"].map(
                                                (letter) => (
                                                    <button
                                                        key={letter}
                                                        onClick={() =>
                                                            handleMcqAnswer(
                                                                index,
                                                                letter
                                                            )
                                                        }
                                                        disabled={
                                                            Boolean(
                                                                answerState
                                                            )
                                                        }
                                                        style={getAnswerStyle(
                                                            index,
                                                            letter
                                                        )}
                                                    >
                                                        <strong>
                                                            {letter}:
                                                        </strong>{" "}
                                                        {options[letter]}
                                                    </button>
                                                )
                                            )}

                                            {answerState && (
                                                <div
                                                    style={{
                                                        marginTop: "14px",
                                                    }}
                                                >
                                                    <p
                                                        style={{
                                                            fontWeight: "bold",
                                                            color: answerState.isCorrect
                                                                ? "#1f7a36"
                                                                : "#b42318",
                                                            marginBottom: "8px",
                                                        }}
                                                    >
                                                        {answerState.isCorrect
                                                            ? "Correct answer ✅"
                                                            : "Wrong answer ❌"}
                                                    </p>

                                                    <p style={{ color: "#555" }}>
                                                        <strong>
                                                            Correct:
                                                        </strong>{" "}
                                                        {q.correct_answer}
                                                    </p>

                                                    <p style={{ color: "#555" }}>
                                                        <strong>
                                                            Explanation:
                                                        </strong>{" "}
                                                        {q.explanation}
                                                    </p>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {type === "true_false" && (
                                        <>
                                            <button
                                                onClick={() =>
                                                    handleTrueFalseAnswer(
                                                        index,
                                                        "True"
                                                    )
                                                }
                                                disabled={Boolean(answerState)}
                                                style={getAnswerStyle(
                                                    index,
                                                    "True"
                                                )}
                                            >
                                                True
                                            </button>

                                            <button
                                                onClick={() =>
                                                    handleTrueFalseAnswer(
                                                        index,
                                                        "False"
                                                    )
                                                }
                                                disabled={Boolean(answerState)}
                                                style={getAnswerStyle(
                                                    index,
                                                    "False"
                                                )}
                                            >
                                                False
                                            </button>

                                            {answerState && (
                                                <div
                                                    style={{
                                                        marginTop: "14px",
                                                    }}
                                                >
                                                    <p
                                                        style={{
                                                            fontWeight: "bold",
                                                            color: answerState.isCorrect
                                                                ? "#1f7a36"
                                                                : "#b42318",
                                                            marginBottom: "8px",
                                                        }}
                                                    >
                                                        {answerState.isCorrect
                                                            ? "Correct answer ✅"
                                                            : "Wrong answer ❌"}
                                                    </p>

                                                    <p style={{ color: "#555" }}>
                                                        <strong>
                                                            Correct:
                                                        </strong>{" "}
                                                        {q.correct_answer}
                                                    </p>

                                                    <p style={{ color: "#555" }}>
                                                        <strong>
                                                            Explanation:
                                                        </strong>{" "}
                                                        {q.explanation}
                                                    </p>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {type === "subjective" && (
                                        <>
                                            <textarea
                                                value={
                                                    subjectiveAnswers[index] ||
                                                    ""
                                                }
                                                onChange={(e) =>
                                                    setSubjectiveAnswers(
                                                        (prev) => ({
                                                            ...prev,
                                                            [index]:
                                                                e.target.value,
                                                        })
                                                    )
                                                }
                                                placeholder="Write your answer here..."
                                                rows="4"
                                                disabled={submittedSubjective}
                                                style={{
                                                    width: "100%",
                                                    padding: "12px",
                                                    borderRadius: "10px",
                                                    border: "1px solid #ccc",
                                                    fontSize: "15px",
                                                    marginBottom: "12px",
                                                    resize: "vertical",
                                                    background:
                                                        submittedSubjective
                                                            ? "#f3f4f6"
                                                            : "#fff",
                                                }}
                                            />

                                            {submittedSubjective && (
                                                <div
                                                    style={{
                                                        marginTop: "14px",
                                                        padding: "14px",
                                                        borderRadius: "10px",
                                                        background: "#f7f3ff",
                                                        color: "#333",
                                                        lineHeight: 1.7,
                                                    }}
                                                >
                                                    <strong>
                                                        Model Answer:
                                                    </strong>{" "}
                                                    {q.answer}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}

                        {currentQuizType === "subjective" && (
                            <div
                                style={{
                                    marginTop: "24px",
                                    paddingTop: "20px",
                                    borderTop: "1px solid #e5e7eb",
                                    display: "flex",
                                    justifyContent: "flex-end",
                                }}
                            >
                                {!submittedSubjective ? (
                                    <button
                                        onClick={() =>
                                            setSubmittedSubjective(true)
                                        }
                                        style={{
                                            padding: "12px 20px",
                                            border: "none",
                                            borderRadius: "10px",
                                            background: "#6c3bff",
                                            color: "#fff",
                                            fontSize: "16px",
                                            fontWeight: "bold",
                                            cursor: "pointer",
                                        }}
                                    >
                                        Submit Written Answers
                                    </button>
                                ) : (
                                    <div
                                        style={{
                                            padding: "12px 16px",
                                            borderRadius: "10px",
                                            background: "#e8f8ec",
                                            color: "#1f7a36",
                                            fontWeight: "bold",
                                        }}
                                    >
                                        Submitted ✅ Model answers are now shown.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}