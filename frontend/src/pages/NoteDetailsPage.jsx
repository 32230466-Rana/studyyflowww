import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import ChatMessage, { TypingIndicator } from "../components/ChatMessage.jsx";
import { PageSpinner } from "../components/Spinner.jsx";
import { summarizeText, summarizeFile } from "../services/localAiApi";
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

    const [chatSessions, setChatSessions] = useState([]);
    const [activeChatId, setActiveChatId] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const [chatLoading, setChatLoading] = useState(false);
    const [chatSessionsLoading, setChatSessionsLoading] = useState(false);

    const chatEndRef = useRef(null);

    const hasTextContent = Boolean(note?.text_content?.trim());
const [quizType, setQuizType] = useState("mcq");
const [questionsCount, setQuestionsCount] = useState(5);
const [difficulty, setDifficulty] = useState("Mixed");
const [quiz, setQuiz] = useState(null);
const [loadingQuiz, setLoadingQuiz] = useState(false);
const [quizError, setQuizError] = useState(null);
const hasRealFile =
    note?.has_file === true ||
    note?.has_file === 1 ||
    note?.has_file === "1";

const isPdfNote =
    note?.source_type === "pdf" ||
    note?.mime_type === "application/pdf" ||
    hasRealFile;

const canGenerateSummary = hasTextContent || isPdfNote;
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
    try {
        setAiError("");
        setSummary("");
        setSummaryTime(null);
        setSummaryLoading(true);

        if (!hasTextContent && !isPdfNote) {
            setAiError("No text or PDF found for this note.");
            return;
        }

        let res;

        if (hasTextContent) {
            res = await axiosClient.post("/local-ai/summary/text", {
                text: note.text_content,
                note_id: note.id,
                title: `Summary of ${note?.title || note?.original_filename || "this note"}`,
            });
        } else {
            res = await axiosClient.post("/ai/summarize", {
                note_id: note.id,
            });
        }

        const summaryText =
            res.data?.summary ||
            res.data?.output ||
            res.data?.answer ||
            res.data?.data?.summary ||
            res.data?.data?.output ||
            "";

        if (!summaryText) {
            setAiError("Summary service returned empty response.");
            return;
        }

        setSummary(summaryText);

        setSummaryFilename(
            note?.original_filename || note?.title || "this note"
        );

        const seconds =
            res.data?.processing_time_seconds ||
            res.data?.data?.processing_time_seconds ||
            null;

        if (seconds) {
            setSummaryTime(seconds);
        }
    } catch (err) {
        console.error("SUMMARY ERROR:", err?.response?.data || err.message);

        const errorMessage =
            err?.response?.data?.message ||
            err?.response?.data?.error ||
            "Summary service failed.";

        setAiError(errorMessage);
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

        const blob = new Blob([summary], {
            type: "text/plain;charset=utf-8",
        });

        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = outputName;
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);
    };

   const handleOpenQuizPage = () => {
    navigate(
        `/quiz/${id}?type=${quizType}&difficulty=${difficulty}&count=${questionsCount}`
    );
};

    const openChat = async (sessionId) => {
        try {
            setActiveChatId(sessionId);
            setChatMessages([]);
            setAiError("");

            const res = await axiosClient.get(
                `/chat-sessions/${sessionId}/messages`
            );

            const messages = res.data?.messages || [];

            setChatMessages(
                messages.map((m) => ({
                    role: m.role,
                    content: m.content,
                }))
            );
        } catch (err) {
            console.error("Failed to open chat:", err);
            setAiError("Failed to open chat.");
        }
    };

    const loadChatSessions = async () => {
        try {
            setChatSessionsLoading(true);
            setAiError("");

            const res = await axiosClient.get(`/notes/${id}/chat-sessions`);
            const sessions = res.data?.sessions || [];

            setChatSessions(sessions);

            if (sessions.length > 0) {
                await openChat(sessions[0].id);
            } else {
                setActiveChatId(null);
                setChatMessages([]);
            }
        } catch (err) {
            console.error("Failed to load chat sessions:", err);
            setAiError("Failed to load chats.");
        } finally {
            setChatSessionsLoading(false);
        }
    };

    const createNewChat = async ({ clearMessages = true } = {}) => {
        try {
            setAiError("");

            const res = await axiosClient.post(`/notes/${id}/chat-sessions`, {
                title: "New Chat",
            });

            const session = res.data?.session;

            if (!session) return null;

            setChatSessions((prev) => [session, ...prev]);
            setActiveChatId(session.id);

            if (clearMessages) {
                setChatMessages([]);
            }

            return session;
        } catch (err) {
            console.error("Failed to create chat:", err);
            setAiError("Failed to create new chat.");
            return null;
        }
    };

    const deleteChat = async (sessionId) => {
        if (!window.confirm("Delete this chat?")) return;

        try {
            await axiosClient.delete(`/chat-sessions/${sessionId}`);

            const remaining = chatSessions.filter((s) => s.id !== sessionId);
            setChatSessions(remaining);

            if (activeChatId === sessionId) {
                if (remaining.length > 0) {
                    await openChat(remaining[0].id);
                } else {
                    setActiveChatId(null);
                    setChatMessages([]);
                }
            }
        } catch (err) {
            console.error("Failed to delete chat:", err);
            setAiError("Failed to delete chat.");
        }
    };

    useEffect(() => {
        loadChatSessions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

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
            let sessionId = activeChatId;

            if (!sessionId) {
                const newSession = await createNewChat({
                    clearMessages: false,
                });

                if (!newSession) {
                    throw new Error("Could not create chat session.");
                }

                sessionId = newSession.id;
            }

           let res;

res = await axiosClient.post(
    `/auth/notes/${note.id}/ask-text`,
    {
        question: message,
        session_id: sessionId,
    }
);
            const reply =
                res.data?.answer ||
                res.data?.reply ||
                res.data?.message ||
                "No answer returned.";

            setChatMessages((prev) => [
                ...prev,
                { role: "ai", content: reply },
            ]);

            if (res.data?.session) {
                setChatSessions((prev) => {
                    const exists = prev.some(
                        (s) => s.id === res.data.session.id
                    );

                    const updated = exists
                        ? prev.map((s) =>
                              s.id === res.data.session.id
                                  ? res.data.session
                                  : s
                          )
                        : [res.data.session, ...prev];

                    return updated.sort(
                        (a, b) =>
                            new Date(b.updated_at).getTime() -
                            new Date(a.updated_at).getTime()
                    );
                });
            }
        } catch (err) {
            console.error("CHAT ERROR:", err?.response?.data || err.message);

            const errorMessage =
                err?.response?.data?.message ||
                err?.response?.data?.error ||
                "Failed to send message.";

            setAiError(errorMessage);

            setChatMessages((prev) => [
                ...prev,
                { role: "ai", content: errorMessage },
            ]);
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

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
        disabled={summaryLoading || !canGenerateSummary}
    >
        {summaryLoading ? (
            <AiThinking label="Summarizing" />
        ) : (
            "Generate Summary"
        )}
    </button>

    {/* حطي menu هون */}
    <div
        style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            width: "100%",
            marginTop: 8,
        }}
    >
        <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Quiz Type
            </label>

            <select
                value={quizType}
                onChange={(e) => setQuizType(e.target.value)}
                className="input"
                style={{ minWidth: 150 }}
            >
                <option value="mcq">MCQ</option>
                <option value="true_false">True / False</option>
                <option value="subjective">Subjective</option>
            </select>
        </div>

        <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Difficulty
            </label>

            <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="input"
                style={{ minWidth: 130 }}
            >
                <option value="Mixed">Mixed</option>
                <option value="Hard">Hard</option>
                <option value="Medium">Medium</option>
            </select>
        </div>

        <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Questions
            </label>

            <input
                type="number"
                min="1"
                max="10"
                value={questionsCount}
                onChange={(e) => setQuestionsCount(e.target.value)}
                className="input"
                style={{ width: 100 }}
            />
        </div>
    </div>

    <button
        className="btn btn-primary"
        onClick={handleOpenQuizPage}
    >
        Generate Quiz
    </button>
</div>
                {!canGenerateSummary && (
                    <div
                        style={{
                            marginTop: 10,
                            color: "var(--color-muted)",
                            fontSize: 13,
                        }}
                    >
                        Add text or upload a PDF to enable summaries.
                    </div>
                )}

                {hasTextContent && !isPdfNote && (
                    <div
                        style={{
                            marginTop: 10,
                            color: "var(--color-muted)",
                            fontSize: 13,
                        }}
                    >
                        This is a text note. Summary, quiz, and chat will use
                        the written note text.
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
                                    "this note"}
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
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                        marginBottom: 14,
                    }}
                >
                    <h2 style={{ margin: 0 }}>Ask about this note</h2>

                    <button
                        className="btn btn-secondary"
                        onClick={() => createNewChat()}
                        disabled={chatLoading}
                    >
                        + New Chat
                    </button>
                </div>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(180px, 220px) 1fr",
                        gap: 16,
                        alignItems: "start",
                    }}
                >
                    <div
                        style={{
                            border: "1px solid #e5e7eb",
                            borderRadius: 14,
                            padding: 10,
                            background: "#f8fafc",
                            maxHeight: 420,
                            overflowY: "auto",
                        }}
                    >
                        <div
                            style={{
                                fontWeight: 700,
                                marginBottom: 10,
                                fontSize: 14,
                            }}
                        >
                            Chats
                        </div>

                        {chatSessionsLoading && (
                            <div style={{ fontSize: 13, color: "#6b7280" }}>
                                Loading chats...
                            </div>
                        )}

                        {!chatSessionsLoading && chatSessions.length === 0 && (
                            <div style={{ fontSize: 13, color: "#6b7280" }}>
                                No chats yet.
                            </div>
                        )}

                        {chatSessions.map((session) => (
                            <div
                                key={session.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 8,
                                    marginBottom: 8,
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={() => openChat(session.id)}
                                    style={{
                                        flex: 1,
                                        textAlign: "left",
                                        border:
                                            activeChatId === session.id
                                                ? "1px solid #2563eb"
                                                : "1px solid #e5e7eb",
                                        background:
                                            activeChatId === session.id
                                                ? "#eff6ff"
                                                : "#ffffff",
                                        borderRadius: 10,
                                        padding: "8px 10px",
                                        cursor: "pointer",
                                        fontSize: 13,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                    title={session.title}
                                >
                                    {session.title || "New Chat"}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => deleteChat(session.id)}
                                    style={{
                                        border: "none",
                                        background: "transparent",
                                        color: "#dc2626",
                                        cursor: "pointer",
                                        fontSize: 16,
                                    }}
                                    title="Delete chat"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="chat-container">
                        <div className="chat-messages">
                            {chatMessages.length === 0 && (
                                <div
                                    style={{
                                        color: "#6b7280",
                                        fontSize: 14,
                                        padding: 12,
                                    }}
                                >
                                    Start a new chat about this note.
                                </div>
                            )}

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
                                onChange={(e) =>
                                    setChatInput(e.target.value)
                                }
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        sendChat();
                                    }
                                }}
                                placeholder="Ask about this note..."
                                disabled={chatLoading}
                            />

                            <button
                                className="btn btn-primary"
                                onClick={sendChat}
                                disabled={chatLoading}
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}