import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import ChatMessage, { TypingIndicator } from "../components/ChatMessage.jsx";
import { PageSpinner } from "../components/Spinner.jsx";

function AiThinking({ label = "AI is thinking" }) {
    return (
        <span className="ai-thinking">
            <span className="ai-thinking-icon">✦</span>
            {label}
            <span className="ai-thinking-dots">
                <span />
                <span />
                <span />
            </span>
        </span>
    );
}

export default function NoteDetailsPage() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [note, setNote] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const [summary, setSummary] = useState("");
    const [summaryFilename, setSummaryFilename] = useState("");
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryTime, setSummaryTime] = useState(null);

    const [aiError, setAiError] = useState("");

    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const [chatLoading, setChatLoading] = useState(false);

    const chatEndRef = useRef(null);

    useEffect(() => {
        let mounted = true;

        const load = async () => {
            setLoading(true);
            setError("");

            try {
                const res = await axiosClient.get(`/notes/${id}`);
                if (!mounted) return;
                setNote(res.data?.data || null);
            } catch (err) {
                setError(
                    err?.response?.data?.message || "Failed to load note."
                );
            } finally {
                if (mounted) setLoading(false);
            }
        };

        load();

        return () => {
            mounted = false;
        };
    }, [id]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatMessages]);

    const download = async () => {
        setBusy(true);

        try {
            const res = await axiosClient.get(`/notes/${id}/download`, {
                responseType: "blob",
            });

            const blob = new Blob([res.data]);
            const url = window.URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = note?.original_filename || `note-${id}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();

            window.URL.revokeObjectURL(url);
        } catch {
            setError("Download failed.");
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!window.confirm("Delete this note?")) return;

        setBusy(true);

        try {
            await axiosClient.delete(`/notes/${id}`);
            navigate("/notes", { replace: true });
        } catch {
            setError("Delete failed.");
        } finally {
            setBusy(false);
        }
    };

    const generateSummary = async () => {
        if (!note?.has_file) {
            setAiError("This note has no PDF file attached.");
            return;
        }

        try {
            setSummaryLoading(true);
            setAiError("");
            setSummary("");
            setSummaryFilename("");
            setSummaryTime(null);

            const startTime = performance.now();

            const response = await axiosClient.post("/ai/summarize", {
                note_id: Number(id),
            });

            const endTime = performance.now();
            const timeTaken = ((endTime - startTime) / 1000).toFixed(2);
            setSummaryTime(timeTaken);

            const ok = response.data?.success;
            const returnedSummary = response.data?.summary || "";
            const returnedFilename =
                response.data?.filename || note?.original_filename || "";

            if (ok === false) {
                setAiError(
                    response.data?.message || "Failed to generate summary."
                );
                return;
            }

            if (!returnedSummary) {
                setAiError("Summary service returned an empty result.");
                return;
            }

            setSummary(returnedSummary);
            setSummaryFilename(returnedFilename);
        } catch (err) {
            console.error(err?.response?.data || err.message);
            setAiError(
                err?.response?.data?.message || "Failed to generate summary."
            );
        } finally {
            setSummaryLoading(false);
        }
    };

    const downloadSummary = () => {
        if (!summary) return;

        const rawBase = (note?.title || "").trim();
        const rawFilename = (
            summaryFilename ||
            note?.original_filename ||
            ""
        ).trim();

        const withoutExt = rawFilename
            ? rawFilename.replace(/\.[^/.]+$/, "")
            : "";
        const base = rawBase || withoutExt || `note-${id}`;

        const safeBase = base
            .replace(/[<>:"/\\|?*]/g, "")
            .split("")
            .filter((ch) => ch.charCodeAt(0) >= 32)
            .join("")
            .replace(/\s+/g, " ")
            .trim();

        const outputName = `Summary_of_${safeBase || `note-${id}`}.txt`;

        const blob = new Blob([summary], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = outputName;
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);
    };

    const handleOpenQuizPage = () => navigate(`/quiz/${id}`);

    const sendChat = async () => {
        const message = chatInput.trim();
        if (!message || chatLoading) return;

        setChatLoading(true);
        setChatInput("");
        setAiError("");

        setChatMessages((prev) => [
            ...prev,
            { role: "user", content: message },
        ]);

        try {
            const res = await axiosClient.post("/ai/chat", {
                note_id: Number(id),
                message,
            });

            const reply = res.data?.data?.reply || "";

            setChatMessages((prev) => [
                ...prev,
                { role: "ai", content: reply },
            ]);
        } catch {
            setAiError("Failed to send message.");
        } finally {
            setChatLoading(false);
        }
    };

    if (loading) return <PageSpinner />;

    if (!note) {
        return (
            <div className="dashboard-page">
                <div className="section-card">
                    <p>{error || "Note not found."}</p>
                    <Link className="btn btn-primary" to="/notes">
                        Back to Notes
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="dashboard-page">
            <Link to="/notes" className="back-link">
                ← Back to Notes
            </Link>

            <div className="section-card">
                <h1>{note.title}</h1>

                <div style={{ display: "flex", gap: 10 }}>
                    <button
                        className="btn btn-secondary"
                        onClick={download}
                        disabled={busy || !note.has_file}
                    >
                        Download
                    </button>

                    <button
                        className="btn btn-danger"
                        onClick={remove}
                        disabled={busy}
                    >
                        Delete
                    </button>
                </div>
            </div>

            <div className="section-card">
                <h2>AI Tools</h2>

                <div
                    className="ai-action-btns"
                    style={{ display: "flex", gap: 12, flexWrap: "wrap" }}
                >
                    <button
                        className="btn btn-primary"
                        onClick={generateSummary}
                        disabled={summaryLoading || !note?.has_file}
                    >
                        {summaryLoading ? (
                            <AiThinking label="Summarizing" />
                        ) : (
                            "Generate Summary"
                        )}
                    </button>

                    <button
                        className="btn btn-primary"
                        onClick={handleOpenQuizPage}
                    >
                        Generate Quiz
                    </button>
                </div>

                {!note?.has_file && (
                    <div
                        style={{
                            marginTop: 10,
                            color: "var(--color-muted)",
                            fontSize: 13,
                        }}
                    >
                        Upload a PDF to enable summaries.
                    </div>
                )}

                {aiError && (
                    <div
                        style={{
                            marginTop: 12,
                            color: "#dc2626",
                            fontWeight: 500,
                        }}
                    >
                        {aiError}
                    </div>
                )}

                {summary && (
                    <div
                        style={{
                            marginTop: 20,
                            padding: "16px 18px",
                            borderRadius: "14px",
                            background: "#f8fafc",
                            border: "1px solid #e5e7eb",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                                marginBottom: 12,
                                flexWrap: "wrap",
                            }}
                        >
                            <h3 style={{ margin: 0 }}>
                                Summary of{" "}
                                {summaryFilename ||
                                    note?.original_filename ||
                                    "this file"}
                            </h3>

                            <button
                                className="btn btn-secondary"
                                onClick={downloadSummary}
                                disabled={!summary}
                            >
                                Download Summary
                            </button>
                        </div>

                        {summaryTime && (
                            <div
                                style={{
                                    marginBottom: 12,
                                    color: "#2563eb",
                                    fontWeight: 600,
                                    fontSize: "14px",
                                }}
                            >
                                ⏱️ Generated in {summaryTime} seconds
                            </div>
                        )}

                        <div
                            style={{
                                whiteSpace: "pre-wrap",
                                lineHeight: "1.9",
                                color: "#111827",
                                fontSize: "15px",
                            }}
                        >
                            {summary}
                        </div>
                    </div>
                )}
            </div>

            <div className="section-card">
                <h2>Ask about this note</h2>

                <div className="chat-container">
                    <div className="chat-messages">
                        {chatMessages.map((m, i) => (
                            <ChatMessage
                                key={i}
                                role={m.role}
                                content={m.content}
                            />
                        ))}

                        {chatLoading && <TypingIndicator />}

                        <div ref={chatEndRef} />
                    </div>

                    <div className="chat-input-area">
                        <input
                            className="input"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder="Ask about this note..."
                        />

                        <button className="btn btn-primary" onClick={sendChat}>
                            Send
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
