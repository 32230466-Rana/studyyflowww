import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosClient from "../axiosClient";

// ─── Icons ──────────────────────────────────────────────────────────
function SummaryIcon() {
    return (
        <svg
            width="28"
            height="28"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
        </svg>
    );
}

function QuizIcon() {
    return (
        <svg
            width="28"
            height="28"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
        </svg>
    );
}

function AskAiIcon() {
    return (
        <svg
            width="28"
            height="28"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
        </svg>
    );
}

function LinkIcon() {
    return (
        <svg
            width="28"
            height="28"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
        </svg>
    );
}

function ArrowRightIcon() {
    return (
        <svg
            width="14"
            height="14"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.5"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
            />
        </svg>
    );
}

// ─── Tool card ───────────────────────────────────────────────────────
function ToolCard({
    icon,
    title,
    description,
    buttonLabel,
    gradient,
    iconBg,
    onClick,
    delay,
}) {
    return (
        <div className="ai-tool-card" style={{ animationDelay: `${delay}ms` }}>
            <div className="ai-tool-card-top" style={{ background: gradient }}>
                <div className="ai-tool-icon" style={{ background: iconBg }}>
                    {icon}
                </div>
            </div>

            <div className="ai-tool-card-body">
                <h3 className="ai-tool-title">{title}</h3>
                <p className="ai-tool-desc">{description}</p>

                <button type="button" className="ai-tool-btn" onClick={onClick}>
                    {buttonLabel} <ArrowRightIcon />
                </button>
            </div>
        </div>
    );
}

// ─── Page ────────────────────────────────────────────────────────────
export default function AiToolsPage() {
    const navigate = useNavigate();

    const [inputText, setInputText] = useState("");
    const [selectedFile, setSelectedFile] = useState(null);
    const [summary, setSummary] = useState("");
    const [generationTime, setGenerationTime] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [saveStatus, setSaveStatus] = useState("");
    const [quizType, setQuizType] = useState("mcq");
    const handleSummarizeText = async () => {
        try {
            setLoading(true);
            setError("");
            setSummary("");
            setGenerationTime(null);
            setSaveStatus("");

            const { data } = await axiosClient.post("/summary-service/text", {
                text: inputText,
            });

            const summaryText = data.result || data.summary || data.output;

            setSummary(summaryText || "No summary returned.");

            setGenerationTime({
                seconds: data.processing_time_seconds,
                minutes: data.processing_time_minutes,
            });

            setSaveStatus(
                data.saved_to_my_summaries
                    ? "Saved to My Summaries."
                    : "Generated, but not saved to My Summaries."
            );
        } catch (err) {
            console.error(err);
            let errMsg = "Failed to summarize text.";

            if (err.response?.data?.error) {
                try {
                    const parsedError = JSON.parse(err.response.data.error);
                    if (parsedError.detail) errMsg = parsedError.detail;
                } catch {
                    errMsg = err.response.data.error;
                }
            } else if (err.response?.data?.message) {
                errMsg = err.response.data.message;
            } else if (err.message) {
                errMsg = err.message;
            }

            setError(errMsg);
        } finally {
            setLoading(false);
        }
    };

    const handleSummarizeFile = async () => {
        try {
            setLoading(true);
            setError("");
            setSummary("");
            setGenerationTime(null);
            setSaveStatus("");

            const formData = new FormData();
            formData.append("uploaded_file", selectedFile);

            const { data } = await axiosClient.post(
                "/summary-service/upload",
                formData
            );

            const summaryText = data.result || data.summary || data.output;

            setSummary(summaryText || "No summary returned.");

            setGenerationTime({
                seconds: data.processing_time_seconds,
                minutes: data.processing_time_minutes,
            });

            setSaveStatus(
                data.saved_to_my_summaries
                    ? "Saved to My Summaries."
                    : "Generated, but not saved to My Summaries."
            );
        } catch (err) {
            console.error(err);
            let errMsg = "Failed to summarize file.";
            if (err.response?.data?.error) {
                try {
                    const parsedError = JSON.parse(err.response.data.error);
                    if (parsedError.detail) errMsg = parsedError.detail;
                } catch {
                    errMsg = err.response.data.error;
                }
            } else if (err.response?.data?.message) {
                errMsg = err.response.data.message;
            } else if (err.message) {
                errMsg = err.message;
            }
            setError(errMsg);
        } finally {
            setLoading(false);
        }
    };

    const tools = [
        {
            icon: <SummaryIcon />,
            title: "Generate Summary",
            description:
                "Create structured summaries from your lecture notes to study smarter and faster.",
            buttonLabel: "Start Summary",
            gradient: "linear-gradient(135deg, #eef2ff 0%, #c7d2fe 100%)",
            iconBg: "rgba(99,102,241,0.15)",
            color: "#6366f1",
            onClick: () => navigate("/notes"),
            delay: 0,
        },
        {
            icon: <QuizIcon />,
            title: "Generate Quiz",
            description:
                "Generate practice quiz questions from your notes and test your knowledge.",
            buttonLabel: "Start Quiz",
            gradient: "linear-gradient(135deg, #f0fdf4 0%, #bbf7d0 100%)",
            iconBg: "rgba(34,197,94,0.15)",
            color: "#22c55e",
            onClick: () => navigate(`/notes?tool=quiz&type=${quizType}`),
            delay: 80,
        },
        {
            icon: <AskAiIcon />,
            title: "Ask AI",
            description:
                "Open one of your uploaded notes and ask questions about it directly from the note details page.",
            buttonLabel: "Open Notes",
            gradient: "linear-gradient(135deg, #fdf4ff 0%, #e9d5ff 100%)",
            iconBg: "rgba(139,92,246,0.15)",
            color: "#8b5cf6",
            onClick: () => navigate("/notes"),
            delay: 160,
        },
        {
            icon: <LinkIcon />,
            title: "Link Summary",
            description:
                "Paste an article or webpage URL to instantly generate a concise summary and key takeaways.",
            buttonLabel: "Summarize Link",
            gradient: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)",
            iconBg: "rgba(249,115,22,0.15)",
            color: "#f97316",
            onClick: () => navigate("/link-summary"),
            delay: 240,
        },
    ];

    return (
        <div className="ai-tools-page dash-fade-in">
            <div className="ai-tools-header">
                <div className="ai-tools-header-badge">
                    <span>✦ Powered by AI</span>
                </div>

                <h1 className="ai-tools-title">AI Study Assistant</h1>

                <p className="ai-tools-subtitle">
                    Choose an AI tool to help you study smarter.
                </p>
            </div>

            <div
                style={{
                    maxWidth: "360px",
                    margin: "0 auto 24px",
                    padding: "16px",
                    background: "#ffffff",
                    borderRadius: "16px",
                    border: "1px solid #e5e7eb",
                    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
                }}
            >
                <label
                    style={{
                        display: "block",
                        marginBottom: "8px",
                        fontWeight: "700",
                        color: "#334155",
                    }}
                >
                    Choose Quiz Type
                </label>

                <select
                    value={quizType}
                    onChange={(e) => setQuizType(e.target.value)}
                    style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: "12px",
                        border: "1px solid #d1d5db",
                        fontFamily: "inherit",
                        fontWeight: "600",
                    }}
                >
                    <option value="mcq">MCQ</option>
                    <option value="true_false">True / False</option>
                    <option value="subjective">Subjective</option>
                </select>
            </div>

            <div className="ai-tools-grid">
                {tools.map((tool) => (
                    <ToolCard key={tool.title} {...tool} />
                ))}
            </div>
            <div
                style={{
                    marginTop: "32px",
                    padding: "24px",
                    background: "#ffffff",
                    borderRadius: "20px",
                    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
                    border: "1px solid #e5e7eb",
                }}
            >
                <h2 style={{ marginBottom: "12px", fontSize: "22px" }}>
                    Quick Summary Test
                </h2>

                <p style={{ marginBottom: "14px", color: "#64748b" }}>
                    Test the local Ollama summary connection using pasted text
                    or a PDF/TXT file.
                </p>

                <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Paste text here to summarize..."
                    rows="6"
                    style={{
                        width: "100%",
                        padding: "14px",
                        borderRadius: "12px",
                        border: "1px solid #d1d5db",
                        resize: "vertical",
                        marginBottom: "12px",
                        fontFamily: "inherit",
                    }}
                />

                <button
                    type="button"
                    onClick={handleSummarizeText}
                    disabled={loading || !inputText.trim()}
                    className="ai-tool-btn"
                    style={{ marginBottom: "18px" }}
                >
                    {loading ? "Summarizing..." : "Summarize Text"}
                </button>

                <div style={{ marginTop: "12px", marginBottom: "12px" }}>
                    <input
                        type="file"
                        accept=".pdf,.txt"
                        onChange={(e) => setSelectedFile(e.target.files[0])}
                    />
                </div>

                <button
                    type="button"
                    onClick={handleSummarizeFile}
                    disabled={loading || !selectedFile}
                    className="ai-tool-btn"
                >
                    {loading ? "Summarizing File..." : "Summarize File"}
                </button>

                {error && (
                    <p style={{ color: "#dc2626", marginTop: "16px" }}>
                        {error}
                    </p>
                )}

                {summary && (
                    <div
                        style={{
                            marginTop: "20px",
                            padding: "18px",
                            background: "#f8fafc",
                            borderRadius: "14px",
                            border: "1px solid #e2e8f0",
                        }}
                    >
                        <h3 style={{ marginBottom: "10px" }}>Summary Result</h3>

                        {generationTime?.seconds && (
                            <p
                                style={{
                                    marginBottom: "12px",
                                    color: "#64748b",
                                    fontSize: "14px",
                                    fontWeight: "600",
                                }}
                            >
                                Generated in {generationTime.seconds} seconds
                                {generationTime.minutes
                                    ? ` (${generationTime.minutes} minutes)`
                                    : ""}
                            </p>
                        )}

                        {saveStatus && (
                            <p
                                style={{
                                    marginBottom: "12px",
                                    color: saveStatus.includes("Saved")
                                        ? "#16a34a"
                                        : "#f97316",
                                    fontSize: "14px",
                                    fontWeight: "600",
                                }}
                            >
                                {saveStatus}
                            </p>
                        )}

                        <pre
                            style={{
                                whiteSpace: "pre-wrap",
                                fontFamily: "inherit",
                                lineHeight: "1.6",
                                margin: 0,
                            }}
                        >
                            {summary}
                        </pre>
                    </div>
                )}
            </div>

            <p className="ai-tools-hint">
                Open any note from{" "}
                <button
                    type="button"
                    className="ai-tools-hint-link"
                    onClick={() => navigate("/notes")}
                >
                    My Notes
                </button>{" "}
                to apply these tools.
            </p>
        </div>
    );
}
