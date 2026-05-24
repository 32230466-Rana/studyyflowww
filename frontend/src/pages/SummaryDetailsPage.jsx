import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import Spinner, { PageSpinner } from "../components/Spinner.jsx";
import StudySheetSummaryCard, {
    formatStudySheetAsText,
} from "../components/StudySheetSummaryCard.jsx";

function ArrowLeftIcon() {
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
                d="M15 19l-7-7 7-7"
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

function formatDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
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

export default function SummaryDetailsPage() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let mounted = true;

        (async () => {
            setLoading(true);
            setError("");
            try {
                const res = await axiosClient.get(`/summaries/${id}`);
                if (!mounted) return;
                setSummary(res.data?.data || null);
            } catch (err) {
                const status = err?.response?.status;
                if (status === 404) {
                    setError("Summary not found.");
                } else if (status !== 401) {
                    setError(
                        err?.response?.data?.message ||
                            "Failed to load summary."
                    );
                }
            } finally {
                if (mounted) setLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [id]);

    const handleDelete = async () => {
        if (!summary) return;
        if (!confirm(`Delete "${summary.title}"?`)) return;

        setDeleting(true);
        try {
            await axiosClient.delete(`/summaries/${summary.id}`);
            navigate("/summaries");
        } catch (err) {
            alert(err?.response?.data?.message || "Delete failed.");
        } finally {
            setDeleting(false);
        }
    };

    const handleCopy = async () => {
        if (!summary) return;
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
        setCopied(true);
        setTimeout(() => setCopied(false), 900);
    };

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
                <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
                    <Link
                        to="/summaries"
                        className="btn btn-secondary"
                        style={{ gap: 6, height: 36 }}
                    >
                        <ArrowLeftIcon /> Back
                    </Link>
                    <div>
                        <h1 className="page-title">Summary Details</h1>
                        {summary?.created_at && (
                            <p className="page-desc">
                                Saved {formatDateTime(summary.created_at)}
                            </p>
                        )}
                    </div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button
                        className="btn btn-secondary"
                        style={{ gap: 6, height: 36 }}
                        onClick={handleCopy}
                        disabled={!summary}
                        type="button"
                    >
                        <CopyIcon /> {copied ? "Copied" : "Copy"}
                    </button>

                    <button
                        className="btn btn-danger"
                        style={{ gap: 6, height: 36 }}
                        onClick={handleDelete}
                        disabled={!summary || deleting}
                        type="button"
                    >
                        {deleting ? <Spinner size="sm" /> : <TrashIcon />}
                        Delete
                    </button>
                </div>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {loading ? (
                <PageSpinner />
            ) : !summary ? (
                <div className="section-card">
                    <div className="empty-state">
                        <div className="empty-state-title">Summary not found</div>
                        <div className="empty-state-desc">
                            Go back to your summaries list.
                        </div>
                        <Link className="btn btn-primary btn-sm" to="/summaries">
                            Back to My Summaries
                        </Link>
                    </div>
                </div>
            ) : (
                <div className="section-card">
                    <div
                        className="section-card-title"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                        }}
                    >
                        <span style={{ minWidth: 0 }}>{summary.title}</span>
                        <div
                            className="note-card-meta"
                            style={{ marginTop: 0 }}
                        >
                            <span className="badge badge-info">
                                {(summary.source_type || "").toUpperCase() ||
                                    "TEXT"}
                            </span>
                            {summary.note_id && (
                                <Link
                                    to={`/notes/${summary.note_id}`}
                                    className="badge badge-accent"
                                    style={{ textDecoration: "none" }}
                                >
                                    Note #{summary.note_id}
                                </Link>
                            )}
                        </div>
                    </div>

                    <StudySheetSummaryCard
                        summary={summary.summary_text}
                        title={summary.title}
                        sourceLabel={
                            (summary.source_type || "").toUpperCase() || "TEXT"
                        }
                        generatedAt={
                            summary.created_at
                                ? `Saved ${formatDateTime(summary.created_at)}`
                                : ""
                        }
                    />
                </div>
            )}
        </div>
    );
}
