import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import Spinner, { PageSpinner } from "../components/Spinner.jsx";
import { formatStudySheetAsText } from "../components/StudySheetSummaryCard.jsx";

function SearchIcon() {
    return (
        <svg
            width="15"
            height="15"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
        </svg>
    );
}

function FileIcon() {
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
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
        </svg>
    );
}

function CopyIcon() {
    return (
        <svg
            width="13"
            height="13"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
        </svg>
    );
}

function EyeIcon() {
    return (
        <svg
            width="13"
            height="13"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg
            width="13"
            height="13"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
        </svg>
    );
}

function previewText(text, maxLen = 220) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen - 1) + "…";
}

function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
    });
}

async function copyToClipboard(text) {
    const value = String(text || "");
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        try {
            const ta = document.createElement("textarea");
            ta.value = value;
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
            return true;
        } catch {
            return false;
        }
    }
}

export default function SummariesPage() {
    const [summaries, setSummaries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [search, setSearch] = useState("");
    const [sort, setSort] = useState("newest");

    const [deletingId, setDeletingId] = useState(null);
    const [copiedId, setCopiedId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await axiosClient.get("/summaries", {
                params: {
                    search: search || undefined,
                    sort: sort || undefined,
                },
            });
            setSummaries(res.data?.data || []);
        } catch (err) {
            const status = err?.response?.status;
            if (status !== 401) {
                setError(
                    err?.response?.data?.message ||
                        "Failed to load summaries."
                );
            }
        } finally {
            setLoading(false);
        }
    }, [search, sort]);

    useEffect(() => {
        const t = setTimeout(() => {
            load();
        }, 250);
        return () => clearTimeout(t);
    }, [load]);

    const headerDesc = useMemo(() => {
        const n = summaries.length;
        return `${n} saved ${n === 1 ? "summary" : "summaries"}`;
    }, [summaries.length]);

    const handleDelete = async (summary) => {
        if (!confirm(`Delete "${summary.title}"?`)) return;
        setDeletingId(summary.id);
        try {
            await axiosClient.delete(`/summaries/${summary.id}`);
            setSummaries((prev) => prev.filter((s) => s.id !== summary.id));
        } catch (err) {
            alert(err?.response?.data?.message || "Delete failed.");
        } finally {
            setDeletingId(null);
        }
    };

    const handleCopy = async (summary) => {
        const ok = await copyToClipboard(
            formatStudySheetAsText(summary.summary_text, {
                title: summary.title,
                sourceType: summary.source_type,
            })
        );
        if (!ok) {
            alert("Copy failed.");
            return;
        }
        setCopiedId(summary.id);
        setTimeout(() => setCopiedId(null), 900);
    };

    const showControls = !loading && (summaries.length > 0 || search !== "");

    return (
        <div className="page-enter">
            <div
                className="page-header"
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                }}
            >
                <div>
                    <h1 className="page-title">My Summaries</h1>
                    <p className="page-desc">{headerDesc}</p>
                </div>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {/* Search + sort */}
            {showControls && (
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 12,
                        alignItems: "center",
                        marginBottom: 20,
                    }}
                >
                    <div
                        style={{
                            position: "relative",
                            maxWidth: 360,
                            flex: "1 1 260px",
                        }}
                    >
                        <span
                            style={{
                                position: "absolute",
                                left: 11,
                                top: "50%",
                                transform: "translateY(-50%)",
                                color: "var(--color-muted)",
                                pointerEvents: "none",
                            }}
                        >
                            <SearchIcon />
                        </span>
                        <input
                            className="input"
                            style={{ paddingLeft: 34 }}
                            placeholder="Search summaries…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <select
                        className="input"
                        style={{ width: 180 }}
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                    >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="title">Title (A–Z)</option>
                    </select>
                </div>
            )}

            {loading ? (
                <PageSpinner />
            ) : summaries.length === 0 ? (
                <div className="section-card">
                    <div className="empty-state">
                        <div className="empty-state-icon">
                            <svg
                                width="48"
                                height="48"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth="1.2"
                                opacity="0.3"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                />
                            </svg>
                        </div>
                        <div className="empty-state-title">
                            {search
                                ? "No summaries match your search"
                                : "No summaries yet"}
                        </div>
                        <div className="empty-state-desc">
                            {search
                                ? "Try a different search term."
                                : "Generate a summary from any note to save it here automatically."}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="notes-grid">
                    {summaries.map((s, i) => (
                        <div
                            key={s.id}
                            className="note-card"
                            style={{ animationDelay: `${i * 40}ms` }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    gap: 10,
                                    alignItems: "flex-start",
                                }}
                            >
                                <div className="note-card-icon">
                                    <FileIcon />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="note-card-title">
                                        {s.title}
                                    </div>
                                    <div
                                        className="note-card-desc"
                                        style={{ marginTop: 6 }}
                                    >
                                        {previewText(
                                            formatStudySheetAsText(
                                                s.summary_text,
                                                {
                                                    title: s.title,
                                                    sourceType: s.source_type,
                                                }
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="note-card-meta">
                                <span className="badge badge-info">
                                    {(s.source_type || "").toUpperCase() ||
                                        "TEXT"}
                                </span>
                                {s.created_at && (
                                    <span className="badge badge-default">
                                        {formatDate(s.created_at)}
                                    </span>
                                )}
                                {s.note_id && (
                                    <span className="badge badge-accent">
                                        Note #{s.note_id}
                                    </span>
                                )}
                            </div>

                            <div className="note-card-actions">
                                <Link
                                    to={`/summaries/${s.id}`}
                                    className="btn btn-sm btn-secondary"
                                    style={{ gap: 4 }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <EyeIcon /> Open
                                </Link>

                                <button
                                    className="btn btn-sm btn-secondary"
                                    style={{ gap: 4 }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleCopy(s);
                                    }}
                                >
                                    <CopyIcon />
                                    {copiedId === s.id ? "Copied" : "Copy"}
                                </button>

                                <button
                                    className="btn btn-sm btn-danger"
                                    style={{ gap: 4, marginLeft: "auto" }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(s);
                                    }}
                                    disabled={deletingId === s.id}
                                >
                                    {deletingId === s.id ? (
                                        <Spinner size="sm" />
                                    ) : (
                                        <TrashIcon />
                                    )}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
