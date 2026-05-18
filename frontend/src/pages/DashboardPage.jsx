import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../auth/AuthContext.jsx";
import { PageSpinner } from "../components/Spinner.jsx";

// ---- Icons -------------------------------------------------------
function NotesIcon() {
    return (
        <svg
            width="18"
            height="18"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
        </svg>
    );
}

function SparklesIcon() {
    return (
        <svg
            width="18"
            height="18"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
            />
        </svg>
    );
}

function FilesIcon() {
    return (
        <svg
            width="18"
            height="18"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
        </svg>
    );
}

function ArrowRightIcon() {
    return (
        <svg
            width="13"
            height="13"
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

function CloudUploadIcon() {
    return (
        <svg
            width="48"
            height="48"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.5"
            style={{ color: "var(--color-accent)" }}
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16v-8m0 0L9 11m3-3l3 3M6.5 19a4.5 4.5 0 01-1.41-8.775A5.5 5.5 0 0116.5 7H17a4 4 0 013.5 5.917A3.5 3.5 0 0117 19H6.5z"
            />
        </svg>
    );
}

function CheckCircleIcon() {
    return (
        <svg
            width="16"
            height="16"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
        </svg>
    );
}

function BrainIcon() {
    return (
        <svg
            width="18"
            height="18"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
        </svg>
    );
}

function SummaryActivityIcon() {
    return (
        <svg
            width="14"
            height="14"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
        </svg>
    );
}

// ---- Helpers -------------------------------------------------------
function useCountUp(target, duration = 900) {
    const [value, setValue] = useState(0);
    const raf = useRef(null);

    useEffect(() => {
        cancelAnimationFrame(raf.current);

        const start = performance.now();
        const startValue = 0;

        const tick = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);

            setValue(Math.round(startValue + eased * (target - startValue)));

            if (progress < 1) {
                raf.current = requestAnimationFrame(tick);
            }
        };

        raf.current = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(raf.current);
    }, [target, duration]);

    return value;
}

function StatCard({ icon, iconClass, value, label }) {
    const animated = useCountUp(Number(value) || 0);

    return (
        <div className="stat-card">
            <div className={`stat-icon ${iconClass}`}>{icon}</div>
            <div className="stat-value">{animated}</div>
            <div className="stat-label">{label}</div>
        </div>
    );
}

function formatPercent(n) {
    const num = Number(n);
    if (Number.isNaN(num)) return "0%";
    return `${Math.round(num)}%`;
}

function truncate(text, max = 88) {
    const t = String(text || "").trim();
    if (!t) return "";
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
}

function extractArrayFromApi(response) {
    const payload = response?.data;

    const data =
        payload?.data?.data ??
        payload?.data ??
        payload?.items ??
        payload ??
        [];

    return Array.isArray(data) ? data : [];
}

// ---- Main component ------------------------------------------------
export default function DashboardPage() {
    const { user } = useAuth();

    const [notes, setNotes] = useState([]);
    const [summaries, setSummaries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [file, setFile] = useState(null);
    const [text_content, setTextContent] = useState("");
    const [aiQuestion, setAiQuestion] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [uploadError, setUploadError] = useState("");

    const [weakTopics, setWeakTopics] = useState([]);
    const [dashboardStats, setDashboardStats] = useState({
        ai_usage_count: 0,
    });

    const fileInputRef = useRef(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const [notesResult, summariesResult] = await Promise.allSettled([
                axiosClient.get("/notes"),
                axiosClient.get("/summaries"),
            ]);

            if (notesResult.status === "fulfilled") {
                setNotes(extractArrayFromApi(notesResult.value));
            } else {
                const err = notesResult.reason;

                if (err?.response?.status !== 401) {
                    setError(
                        err?.response?.data?.message || "Failed to load notes."
                    );
                }

                setNotes([]);
            }

            if (summariesResult.status === "fulfilled") {
                setSummaries(extractArrayFromApi(summariesResult.value));
            } else {
                console.log(
                    "Summaries load error:",
                    summariesResult.reason?.response?.data ||
                        summariesResult.reason?.message
                );

                setSummaries([]);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    const loadInsights = useCallback(async () => {
        try {
            const rec = await axiosClient.get("/recommendations");
            setWeakTopics(rec.data?.data || []);
        } catch {
            // silent: dashboard should still load even if recommendations fail
        }
    }, []);

    const loadDashboardStats = useCallback(async () => {
        try {
            const res = await axiosClient.get("/dashboard");

            const payload = res.data?.data || res.data || {};
            const stats = payload.stats || payload;

            const usageValue =
                stats.ai_usage_count ??
                stats.aiUsageCount ??
                stats.ai_requests ??
                stats.aiRequests ??
                (typeof stats.ai_usage === "number" ? stats.ai_usage : 0);

            setDashboardStats({
                ai_usage_count: Number(usageValue || 0),
            });
        } catch (err) {
            console.log("Dashboard stats error:", err.response?.data || err.message);
            setDashboardStats({
                ai_usage_count: 0,
            });
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        loadInsights();
    }, [loadInsights]);

    useEffect(() => {
        loadDashboardStats();
    }, [loadDashboardStats]);

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);

        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile) {
            setFile(droppedFile);
        }
    };

    const handleDropZoneClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileInput = (e) => {
        if (e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleUpload = async (e) => {
        e.preventDefault();

        const trimmedTitle = title.trim();
        const trimmedDescription = description.trim();
        const trimmedText = text_content.trim();
        const trimmedQuestion = aiQuestion.trim();

        if (!trimmedTitle && !file) {
            setUploadError("Title is required.");
            return;
        }

        if (!file && !trimmedText) {
            setUploadError("Please drop a file or paste your notes.");
            return;
        }

        setUploading(true);
        setUploadError("");

        try {
            const formData = new FormData();

            formData.append("title", trimmedTitle || file?.name || "Untitled Note");

            if (trimmedDescription) {
                formData.append("description", trimmedDescription);
            }

            if (file) {
                formData.append("pdf", file);
            } else if (trimmedText) {
                formData.append("text_content", trimmedText);
            }

            if (trimmedQuestion) {
                formData.append("question", trimmedQuestion);
            }

            await axiosClient.post("/notes", formData);

            setUploadSuccess(true);
            setTitle("");
            setDescription("");
            setFile(null);
            setTextContent("");
            setAiQuestion("");

            await load();
            await loadDashboardStats();

            setTimeout(() => setUploadSuccess(false), 3000);
        } catch (err) {
            console.log("UPLOAD STATUS:", err.response?.status);
            console.log("UPLOAD DATA:", err.response?.data);
            console.log("UPLOAD ERRORS:", err.response?.data?.errors);

            const validationErrors = err?.response?.data?.errors;

            if (validationErrors) {
                const firstError = Object.values(validationErrors)[0]?.[0];
                setUploadError(firstError || "Validation failed.");
            } else {
                setUploadError(
                    err?.response?.data?.message ||
                        "Upload failed. Please try again."
                );
            }
        } finally {
            setUploading(false);
        }
    };

    const totalNotes = notes.length;
    const aiSummaries = summaries.length;
    const filesUploaded = notes.filter((n) => n.has_file || n.file_path || n.pdf_path).length;
    const aiUsage = dashboardStats.ai_usage_count || 0;

    const recentAiActivity = summaries
        .slice(0, 5)
        .map((summary) => ({
            id: summary.id,
            action: "Generated summary",
            title:
                summary.title ||
                summary.note?.title ||
                summary.note_title ||
                "Summary",
            date: summary.updated_at || summary.created_at,
        }));

    const firstName = user?.name?.split(" ")[0] || "there";

    if (loading) return <PageSpinner />;

    return (
        <div className="dashboard-page dash-fade-in">
            <div className="page-header">
                <h1>
                    Good day, {firstName} <span className="wave">👋</span>
                </h1>
                <p className="page-header-sub">
                    Upload study material or paste notes — your AI will handle
                    the rest.
                </p>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <div className="stats-grid">
                <StatCard
                    icon={<NotesIcon />}
                    iconClass="stat-icon-purple"
                    value={totalNotes}
                    label="Total Notes"
                />

                <StatCard
                    icon={<SparklesIcon />}
                    iconClass="stat-icon-blue"
                    value={aiSummaries}
                    label="AI Summaries"
                />

                <StatCard
                    icon={<FilesIcon />}
                    iconClass="stat-icon-green"
                    value={filesUploaded}
                    label="Files Uploaded"
                />

                <StatCard
                    icon={<BrainIcon />}
                    iconClass="stat-icon-orange"
                    value={aiUsage}
                    label="AI Usage"
                />
            </div>

            <div className="section-card" style={{ marginBottom: "24px" }}>
                <div
                    style={{
                        background:
                            "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                        borderRadius: "16px",
                        padding: "24px",
                        color: "white",
                        position: "relative",
                        overflow: "hidden",
                    }}
                >
                    <div style={{ position: "relative", zIndex: 2 }}>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                marginBottom: "16px",
                            }}
                        >
                            <div
                                style={{
                                    fontSize: "2rem",
                                    marginRight: "12px",
                                    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))",
                                }}
                            >
                                🧠
                            </div>

                            <div>
                                <h3
                                    style={{
                                        margin: "0",
                                        fontSize: "20px",
                                        fontWeight: "bold",
                                        textShadow: "0 1px 2px rgba(0,0,0,0.1)",
                                    }}
                                >
                                    Test Your Knowledge
                                </h3>

                                <p
                                    style={{
                                        margin: "0",
                                        opacity: "0.9",
                                        fontSize: "14px",
                                    }}
                                >
                                    Challenge yourself with our interactive quiz
                                </p>
                            </div>
                        </div>

                        <p
                            style={{
                                margin: "0 0 20px 0",
                                opacity: "0.95",
                                lineHeight: "1.5",
                            }}
                        >
                            Put your learning to the test! Choose from different
                            difficulty levels and track your progress with our
                            engaging quiz platform.
                        </p>

                        <Link
                            to="/quiz"
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                background: "rgba(255,255,255,0.2)",
                                color: "white",
                                padding: "12px 20px",
                                borderRadius: "10px",
                                textDecoration: "none",
                                fontWeight: "600",
                                backdropFilter: "blur(10px)",
                                border: "1px solid rgba(255,255,255,0.3)",
                                transition: "all 0.2s ease",
                                fontSize: "14px",
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background =
                                    "rgba(255,255,255,0.3)";
                                e.currentTarget.style.transform = "translateY(-1px)";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background =
                                    "rgba(255,255,255,0.2)";
                                e.currentTarget.style.transform = "translateY(0)";
                            }}
                        >
                            <span style={{ marginRight: "8px" }}>🚀</span>
                            Start Quiz Challenge
                        </Link>
                    </div>

                    <div
                        style={{
                            position: "absolute",
                            top: "-50px",
                            right: "-50px",
                            width: "120px",
                            height: "120px",
                            background: "rgba(255,255,255,0.1)",
                            borderRadius: "50%",
                            zIndex: 1,
                        }}
                    />

                    <div
                        style={{
                            position: "absolute",
                            bottom: "-30px",
                            left: "-30px",
                            width: "80px",
                            height: "80px",
                            background: "rgba(255,255,255,0.08)",
                            borderRadius: "50%",
                            zIndex: 1,
                        }}
                    />
                </div>
            </div>

            <div className="upload-card">
                <h2 className="upload-card-heading">Add Study Material</h2>

                <form onSubmit={handleUpload} className="upload-form">
                    <div className="upload-meta-row">
                        <div className="upload-field">
                            <label className="upload-label">
                                Title <span className="required">*</span>
                            </label>

                            <input
                                className="upload-input"
                                placeholder="e.g. Chapter 3 — Thermodynamics"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                            />
                        </div>

                        <div className="upload-field">
                            <label className="upload-label">
                                Description{" "}
                                <span className="optional">(optional)</span>
                            </label>

                            <input
                                className="upload-input"
                                placeholder="Brief description…"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>
                    </div>

                    <div
                        className={`drop-zone${
                            isDragging ? " drop-zone--active" : ""
                        }${file ? " drop-zone--has-file" : ""}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={handleDropZoneClick}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) =>
                            e.key === "Enter" && handleDropZoneClick()
                        }
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.txt,.ppt,.pptx"
                            style={{ display: "none" }}
                            onChange={handleFileInput}
                        />

                        {file ? (
                            <div className="drop-zone-file">
                                <FilesIcon />

                                <span className="drop-zone-filename">
                                    {file.name}
                                </span>

                                <button
                                    type="button"
                                    className="drop-zone-remove"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setFile(null);
                                    }}
                                >
                                    ✕ Remove
                                </button>
                            </div>
                        ) : (
                            <>
                                <CloudUploadIcon />

                                <p className="drop-zone-title">
                                    Upload your study material
                                </p>

                                <p className="drop-zone-sub">
                                    Drag &amp; drop files here or browse
                                </p>

                                <span className="drop-zone-btn">
                                    Browse files
                                </span>
                            </>
                        )}
                    </div>

                    <div className="upload-divider">
                        <span>or paste your notes</span>
                    </div>

                    <textarea
                        className="upload-textarea"
                        placeholder="Paste or write your study notes here…"
                        value={text_content}
                        onChange={(e) => setTextContent(e.target.value)}
                        rows={5}
                    />

                    <div className="upload-field">
                        <label className="upload-label">
                            Ask a question about your notes{" "}
                            <span className="optional">(optional)</span>
                        </label>

                        <input
                            className="upload-input"
                            placeholder="Example: What are the key concepts in this lecture?"
                            value={aiQuestion}
                            onChange={(e) => setAiQuestion(e.target.value)}
                        />
                    </div>

                    {uploadError && (
                        <div className="alert alert-error">{uploadError}</div>
                    )}

                    {uploadSuccess && (
                        <div className="alert alert-success">
                            <CheckCircleIcon /> Note uploaded successfully!
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary upload-submit"
                        disabled={uploading}
                    >
                        {uploading ? (
                            <span className="upload-spinner" />
                        ) : (
                            <SparklesIcon />
                        )}

                        {uploading ? "Uploading…" : "Upload Note"}
                    </button>
                </form>
            </div>

            {recentAiActivity.length > 0 && (
                <div className="section-card ai-activity-card">
                    <div className="section-card-header">
                        <div className="section-card-title">
                            Recent AI Activity
                        </div>

                        <Link to="/ai-tools" className="btn btn-sm btn-ghost">
                            AI Tools <ArrowRightIcon />
                        </Link>
                    </div>

                    <div className="ai-activity-list">
                        {recentAiActivity.map((item, i) => (
                            <div
                                key={item.id}
                                className="ai-activity-row"
                                style={{ animationDelay: `${i * 60}ms` }}
                            >
                                <div className="ai-activity-icon">
                                    <SummaryActivityIcon />
                                </div>

                                <div className="ai-activity-body">
                                    <span className="ai-activity-action">
                                        {item.action}
                                    </span>{" "}
                                    <span className="ai-activity-note">
                                        for &ldquo;{item.title}&rdquo;
                                    </span>
                                </div>

                                <div className="ai-activity-time">
                                    {item.date
                                        ? new Date(item.date).toLocaleDateString(
                                              "en-US",
                                              {
                                                  month: "short",
                                                  day: "numeric",
                                              }
                                          )
                                        : ""}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="section-card">
                <div className="section-card-header">
                    <div className="section-card-title">Weak Topics</div>

                    <Link to="/recommendations" className="btn btn-sm btn-ghost">
                        View all <ArrowRightIcon />
                    </Link>
                </div>

                {weakTopics.length === 0 ? (
                    <div className="empty-state">
                        <p>
                            No weak topics yet. Take a quiz to generate
                            recommendations.
                        </p>
                    </div>
                ) : (
                    weakTopics.slice(0, 4).map((t) => (
                        <div key={t.id} className="recent-note">
                            <div className="recent-note-left">🎯</div>

                            <div className="recent-note-content">
                                <div className="recent-note-title">
                                    {t.topic}
                                </div>

                                <div className="recent-note-meta">
                                    <span className="badge badge-accent">
                                        {formatPercent(t.weakness_percent)}
                                    </span>

                                    <span className="badge badge-default">
                                        {t.wrong_count}/{t.total_count}
                                    </span>

                                    <span className="badge badge-default">
                                        {truncate(
                                            t.recommendation ||
                                                "You need more revision in this topic."
                                        )}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}