import React, { useMemo, useState } from "react";

import {
    Bookmark,
    ChevronDown,
    Clock3,
    Copy,
    Download,
    FileText,
    Globe2,
    History,
    Instagram,
    Link2,
    ListChecks,
    MoreVertical,
    RotateCcw,
    Save,
    Sparkles,
    Youtube,
    Zap,
} from "lucide-react";
import axiosClient from "../api/axiosClient";
import {
    formatStudySheetAsText,
    normalizeStudySheetSummary,
    serializeStudySheetSummary,
} from "../components/StudySheetSummaryCard.jsx";
import "./LinkSummaryPage.css";
import { useNavigate } from "react-router-dom";

const SOURCE_TABS = [
    {
        id: "instagram",
        label: "Instagram",
        Icon: Instagram,
        placeholder: "Paste Instagram Reel, YouTube link, or article URL...",
    },
    {
        id: "youtube",
        label: "YouTube",
        Icon: Youtube,
        placeholder: "Paste YouTube video URL...",
    },
    {
        id: "web",
        label: "Web URL",
        Icon: Globe2,
        placeholder: "Paste webpage or article URL...",
    },
];

const SUMMARY_STATS = [
    {
        label: "Total Summaries",
        value: "38",
        helper: "All time",
        Icon: FileText,
        tone: "purple",
    },
    {
        label: "Instagram",
        value: "16",
        helper: "Reels & Posts",
        Icon: Instagram,
        tone: "pink",
    },
    {
        label: "Web Links",
        value: "15",
        helper: "Articles & Pages",
        Icon: Globe2,
        tone: "blue",
    },
    {
        label: "Recently Generated",
        value: "7",
        helper: "In the last 7 days",
        Icon: Clock3,
        tone: "amber",
    },
];

const RECENT_SUMMARIES = [
    {
        title: "The 5 AM Mindset That Changed My Life",
        date: "May 18, 2025",
        source: "Instagram",
        Icon: Instagram,
        tone: "instagram",
    },
    {
        title: "How AI Will Change The Future of Work",
        date: "May 17, 2025",
        source: "YouTube",
        Icon: Youtube,
        tone: "youtube",
    },
    {
        title: "The Science of Habit Formation",
        date: "May 16, 2025",
        source: "Web",
        Icon: Globe2,
        tone: "web",
    },
    {
        title: "3 Productivity Hacks For Students",
        date: "May 15, 2025",
        source: "Instagram",
        Icon: Instagram,
        tone: "instagram",
    },
    {
        title: "Build a Second Brain (PARA Method)",
        date: "May 14, 2025",
        source: "YouTube",
        Icon: Youtube,
        tone: "youtube",
    },
];

const SAVED_LINKS = [
    {
        title: "Atomic Habits Summary Article",
        url: "example.com/atomic-habits",
        Icon: Globe2,
        tone: "web",
    },
    {
        title: "Deep Work by Cal Newport",
        url: "youtube.com/watch?v=example",
        Icon: Youtube,
        tone: "youtube",
    },
    {
        title: "Minimalism in 2025",
        url: "instagram.com/p/example",
        Icon: Instagram,
        tone: "instagram",
    },
];

const FALLBACK_SUMMARY = {
    title: "The 5 AM Mindset That Changed My Life",
    source: "Instagram Reel",
    generatedAt: "May 18, 2025",
    mainIdea:
        "Waking up at 5 AM creates a peaceful head start that improves focus, productivity, and overall well-being.",
    keyPoints: [
        "Early mornings reduce distractions and noise.",
        "Time before the world wakes up is powerful.",
        "Use the first hour for yourself, not your phone.",
        "Build routines that support long-term goals.",
        "Consistency is more important than intensity.",
    ],
    importantDetails: [
        "Suggested routine: Hydrate, move, plan, focus.",
        "Benefits: mental clarity, better planning, reduced stress.",
        "Best for students, entrepreneurs, and anyone seeking growth.",
        "Start small: 15-30 minutes earlier each day.",
    ],
    shortSummary:
        "The reel explains how waking up at 5 AM gives you quiet, distraction-free time to focus on yourself, plan your day, and build habits that lead to personal growth and success.",
};

function getNestedValue(source, keys) {
    if (!source || typeof source !== "object") {
        return "";
    }

    for (const key of keys) {
        if (source[key]) {
            return source[key];
        }
    }

    if (source.data && typeof source.data === "object") {
        for (const key of keys) {
            if (source.data[key]) {
                return source.data[key];
            }
        }
    }

    return "";
}

function asText(value, fallback = "") {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }

    if (Array.isArray(value)) {
        return value.filter(Boolean).join(" ").trim() || fallback;
    }

    return fallback;
}

function asList(value, fallback = []) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }

    if (typeof value === "string" && value.trim()) {
        return value
            .split(/\n|•|-/)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 6);
    }

    return fallback;
}

function getSourceFromUrl(link) {
    const lowerUrl = String(link || "").toLowerCase();

    if (lowerUrl.includes("instagram.com")) {
        return "instagram";
    }

    if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
        return "youtube";
    }

    return "web";
}

function getTodayLabel() {
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(new Date());
}

function getTimeLabel() {
    return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date());
}

function SourceMark({ source, className = "" }) {
    const activeSource = SOURCE_TABS.find((tab) => tab.id === source) || SOURCE_TABS[2];
    const Icon = activeSource.Icon;

    return (
        <span className={`link-summary-source-mark ${source} ${className}`}>
            <Icon size={16} aria-hidden="true" />
        </span>
    );
}

function SummarySection({ title, Icon, tone, children }) {
    return (
        <section className="link-summary-section">
            <div className="link-summary-section-title">
                <span className={`link-summary-section-icon ${tone}`}>
                    <Icon size={14} aria-hidden="true" />
                </span>
                <h3>{title}</h3>
            </div>
            {children}
        </section>
    );
}

export default function LinkSummaryPage() {
    const [url, setUrl] = useState("");
    const [sourceType, setSourceType] = useState("instagram");
    const [summaryType, setSummaryType] = useState("Detailed");
    const [language, setLanguage] = useState("English");
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [summary, setSummary] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState("");
    const [copyMessage, setCopyMessage] = useState("");
    const [showSavedLinksPanel, setShowSavedLinksPanel] = useState(false);
    const navigate = useNavigate();
    const activeTab = SOURCE_TABS.find((tab) => tab.id === sourceType) || SOURCE_TABS[0];
    const summaryTitle = summary?.title || "Link Study Summary";
    const summarySourceUrl = summary?.url || url;
    const summaryContext = useMemo(
        () => ({
            title: summaryTitle,
            sourceType: "link",
            url: summarySourceUrl,
        }),
        [summarySourceUrl, summaryTitle],
    );

    const normalizedSummary = useMemo(() => {
        if (!summary) {
            return FALLBACK_SUMMARY;
        }

        return normalizeStudySheetSummary(summary, summaryContext);
    }, [summary, summaryContext]);

    const detectedSource = summary ? getSourceFromUrl(url) : sourceType;
    const sourceLabel = SOURCE_TABS.find((tab) => tab.id === detectedSource)?.label || "Web URL";
    const sourceBadgeLabel = sourceLabel === "Web URL" ? "Web URL" : `${sourceLabel} URL`;
    const displayTitle =
        asText(
            getNestedValue(summary, ["title", "summary_title", "topic", "page_title"]),
            normalizedSummary.title || FALLBACK_SUMMARY.title,
        ) || FALLBACK_SUMMARY.title;
    const sourceName =
        asText(
            getNestedValue(summary, ["source", "source_type", "platform"]),
            sourceLabel === "Web URL" ? "Web Link" : `${sourceLabel} Link`,
        ) || "Link";
    const generatedDate =
        asText(getNestedValue(summary, ["date", "generatedAt", "generated_at"]), "") ||
        (summary ? getTodayLabel() : FALLBACK_SUMMARY.generatedAt);
    const generatedTime =
        asText(getNestedValue(summary, ["time", "generated_time"]), "") || (summary ? getTimeLabel() : "12:45 PM");
    const mainIdea = asText(
        getNestedValue(summary, ["mainIdea", "main_idea", "overview", "summary"]),
        normalizedSummary.mainIdea || FALLBACK_SUMMARY.mainIdea,
    );
    const keyPoints = asList(
        getNestedValue(summary, ["keyPoints", "key_points", "key_takeaways", "takeaways"]),
        normalizedSummary.keyPoints?.length ? normalizedSummary.keyPoints : FALLBACK_SUMMARY.keyPoints,
    );
    const importantDetails = asList(
        getNestedValue(summary, ["importantDetails", "important_details", "details", "actionItems"]),
        normalizedSummary.importantDetails?.length
            ? normalizedSummary.importantDetails
            : FALLBACK_SUMMARY.importantDetails,
    );
    const shortSummary = asText(
        getNestedValue(summary, ["shortSummary", "short_summary", "brief", "conclusion"]),
        normalizedSummary.shortSummary || FALLBACK_SUMMARY.shortSummary,
    );
    const canUseSummaryActions = Boolean(summary);

    const runGenerateSummary = async () => {
        setError("");
        setSummary(null);
        setSaveMessage("");
        setCopyMessage("");

        const trimmedUrl = url.trim();
        if (!trimmedUrl) {
            setError("Please paste a URL first.");
            return;
        }

        setLoading(true);

        try {
            const { data } = await axiosClient.post("/ai/link-summary", { url: trimmedUrl });
            setSummary(data);
            setSourceType(getSourceFromUrl(trimmedUrl));
        } catch (err) {
            console.error("Error fetching link summary:", err);
            const message =
                err.response?.data?.message ||
                err.response?.data?.error ||
                "Unable to summarize this link right now. Please try again.";
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateSummary = async (event) => {
        event.preventDefault();
        await runGenerateSummary();
    };

    const handleSaveSummary = async () => {
        if (!summary) {
            return;
        }

        setSaving(true);
        setSaveMessage("");

        try {
            await axiosClient.post("/summaries", {
                title: summaryTitle,
                source_type: "text",
                summary_text: serializeStudySheetSummary(summary, summaryContext),
            });
            setSaveMessage("Saved to My Summaries.");
        } catch (err) {
            const message =
                err.response?.data?.message ||
                err.response?.data?.error ||
                "Summary generated, but could not be saved.";
            setSaveMessage(message);
        } finally {
            setSaving(false);
        }
    };

    const handleCopySummary = async () => {
        if (!summary) {
            return;
        }

        try {
            await navigator.clipboard.writeText(formatStudySheetAsText(summary, summaryContext));
            setCopyMessage("Copied study sheet.");
            setTimeout(() => setCopyMessage(""), 1000);
        } catch {
            setCopyMessage("Copy failed.");
        }
    };

    const handleExportSummary = () => {
        if (!summary) {
            return;
        }

        const blob = new Blob([formatStudySheetAsText(summary, summaryContext)], {
            type: "text/plain;charset=utf-8",
        });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = "link-summary.txt";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);
    };

    return (
        <div className="link-summary-page">
            <header className="link-summary-header">
                <div>
                    <h1>Smart Link Summary</h1>
                    <p>Paste an Instagram, YouTube, or webpage URL to generate a clean AI summary.</p>
                </div>

                <button className="link-summary-history-button" type="button">
                    <History size={18} aria-hidden="true" />
                    <span>Summary History</span>
                </button>
            </header>

            <div className="link-summary-layout">
                <main className="link-summary-main">
                    <form className="link-summary-input-card" onSubmit={handleGenerateSummary}>
                        <div className="link-summary-tabs" role="tablist" aria-label="Summary source">
                            {SOURCE_TABS.map(({ id, label, Icon }) => (
                                <button
                                    aria-selected={sourceType === id}
                                    className={`link-summary-tab ${sourceType === id ? "active" : ""}`}
                                    key={id}
                                    onClick={() => setSourceType(id)}
                                    role="tab"
                                    type="button"
                                >
                                    <Icon size={18} aria-hidden="true" />
                                    <span>{label}</span>
                                </button>
                            ))}
                        </div>

                        <div className="link-summary-url-row">
                            <div className="link-summary-url-field">
                                <Link2 size={22} aria-hidden="true" />
                                <input
                                    aria-label="URL"
                                    onChange={(event) => setUrl(event.target.value)}
                                    placeholder={activeTab.placeholder}
                                    type="url"
                                    value={url}
                                />
                            </div>

                            <button className="link-summary-generate-button" disabled={loading} type="submit">
                                <Sparkles size={18} aria-hidden="true" />
                                <span>{loading ? "Generating..." : "Generate Summary"}</span>
                            </button>
                        </div>

                        <div className="link-summary-controls">
                            <label className="link-summary-select">
                                <span>Summary Type:</span>
                                <select value={summaryType} onChange={(event) => setSummaryType(event.target.value)}>
                                    <option>Detailed</option>
                                    <option>Quick</option>
                                    <option>Study Notes</option>
                                    <option>Key Points</option>
                                </select>
                                <ChevronDown size={16} aria-hidden="true" />
                            </label>

                            <label className="link-summary-select">
                                <span>Language:</span>
                                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                                    <option>English</option>
                                    <option>Arabic</option>
                                    <option>French</option>
                                    <option>Spanish</option>
                                </select>
                                <ChevronDown size={16} aria-hidden="true" />
                            </label>

                            <button
                                aria-expanded={advancedOpen}
                                className="link-summary-advanced-button"
                                onClick={() => setAdvancedOpen((current) => !current)}
                                type="button"
                            >
                                <Zap size={17} aria-hidden="true" />
                                <span>Advanced Options</span>
                            </button>
                        </div>

                        {advancedOpen && (
                            <div className="link-summary-advanced-panel">
                                <label>
                                    <input type="checkbox" defaultChecked />
                                    Include key points
                                </label>
                                <label>
                                    <input type="checkbox" defaultChecked />
                                    Include important details
                                </label>
                                <label>
                                    <input type="checkbox" />
                                    Shorter output
                                </label>
                            </div>
                        )}

                        {error && <p className="link-summary-error">{error}</p>}
                    </form>

                    <section className="link-summary-stats" aria-label="Summary statistics">
                        {SUMMARY_STATS.map(({ label, value, helper, Icon, tone }) => (
                            <article className="link-summary-stat-card" key={label}>
                                <span className={`link-summary-stat-icon ${tone}`}>
                                    <Icon size={26} aria-hidden="true" />
                                </span>
                                <div>
                                    <p>{label}</p>
                                    <strong>{value}</strong>
                                    <span>{helper}</span>
                                </div>
                            </article>
                        ))}
                    </section>

                    <section className="link-summary-result-card" aria-label="Summary result">
                        <div className="link-summary-result-top">
                            <div className="link-summary-thumbnail">
                                <SourceMark source={detectedSource} />
                                <span>{sourceLabel}</span>
                            </div>

                            <div className="link-summary-result-heading">
                                <h2>{displayTitle}</h2>
                                <div className="link-summary-meta">
                                    <SourceMark source={detectedSource} className="small" />
                                    <span>{sourceName}</span>
                                    <span aria-hidden="true">•</span>
                                    <span>{generatedDate}</span>
                                    <span aria-hidden="true">•</span>
                                    <span>{generatedTime}</span>
                                </div>

                                <div className="link-summary-badges">
                                    <span className="link-summary-source-badge">Source: {sourceBadgeLabel}</span>
                                    {summaryType && <span className="link-summary-soft-badge">{summaryType}</span>}
                                </div>
                            </div>

                            <div className="link-summary-card-actions">
                                <button aria-label="Bookmark summary" type="button">
                                    <Bookmark size={20} aria-hidden="true" />
                                </button>
                                <button aria-label="More summary actions" type="button">
                                    <MoreVertical size={20} aria-hidden="true" />
                                </button>
                            </div>
                        </div>

                        <div className="link-summary-content-grid">
                            <div className="link-summary-content-column">
                                <SummarySection Icon={FileText} title="Main Idea" tone="purple">
                                    <p>{mainIdea}</p>
                                </SummarySection>

                                <SummarySection Icon={ListChecks} title="Key Points" tone="purple">
                                    <ul>
                                        {keyPoints.map((point, index) => (
                                            <li key={`${point}-${index}`}>{point}</li>
                                        ))}
                                    </ul>
                                </SummarySection>
                            </div>

                            <div className="link-summary-content-column">
                                <SummarySection Icon={Clock3} title="Important Details" tone="blue">
                                    <ul>
                                        {importantDetails.map((detail, index) => (
                                            <li key={`${detail}-${index}`}>{detail}</li>
                                        ))}
                                    </ul>
                                </SummarySection>

                                <SummarySection Icon={Bookmark} title="Short Summary" tone="green">
                                    <p>{shortSummary}</p>
                                </SummarySection>
                            </div>
                        </div>

                        <div className="link-summary-result-footer">
                            <div className="link-summary-result-buttons">
                                <button
                                    className="link-summary-primary-action"
                                    disabled={!canUseSummaryActions || saving}
                                    onClick={handleSaveSummary}
                                    type="button"
                                >
                                    <Save size={17} aria-hidden="true" />
                                    <span>{saving ? "Saving..." : "Save"}</span>
                                </button>

                                <button disabled={!canUseSummaryActions} onClick={handleCopySummary} type="button">
                                    <Copy size={17} aria-hidden="true" />
                                    <span>Copy</span>
                                </button>

                                <button disabled={loading || !url.trim()} onClick={runGenerateSummary} type="button">
                                    <RotateCcw size={17} aria-hidden="true" />
                                    <span>Regenerate</span>
                                </button>

                                <button disabled={!canUseSummaryActions} onClick={handleExportSummary} type="button">
                                    <Download size={17} aria-hidden="true" />
                                    <span>Export</span>
                                    <ChevronDown size={15} aria-hidden="true" />
                                </button>
                            </div>

                            {(saveMessage || copyMessage) && (
                                <p className="link-summary-action-message">{saveMessage || copyMessage}</p>
                            )}
                        </div>
                    </section>
                </main>

                <aside className="link-summary-side" aria-label="Summary sidebar">
                    <section className="link-summary-side-card">
                        <div className="link-summary-side-header">
                            <h2>Recent Summaries</h2>
                           <button
  className="link-summary-link-button"
  type="button"
  onClick={() => setShowSavedLinksPanel(true)}
>
  <span>Manage saved links</span>
  <span aria-hidden="true">→</span>
</button>
                        </div>

                        <div className="link-summary-recent-list">
                            {RECENT_SUMMARIES.map(({ title, date, source, Icon, tone }) => (
                                <article className="link-summary-recent-item" key={title}>
                                    <div className={`link-summary-mini-thumb ${tone}`}>
                                        <Icon size={18} aria-hidden="true" />
                                    </div>
                                    <div>
                                        <h3>{title}</h3>
                                        <p>
                                            <Icon size={13} aria-hidden="true" />
                                            <span>{source}</span>
                                            <span>{date}</span>
                                        </p>
                                    </div>
                                </article>
                            ))}
                        </div>

                        <button
                            className="link-summary-link-button"
                            type="button"
                            onClick={() => navigate("/summaries")}
                        >
                            <span>View all summaries</span>
                            <span aria-hidden="true">→</span>
                        </button>
                    </section>

                    <section className="link-summary-side-card">
                        <div className="link-summary-side-header">
                            <h2>Saved Links</h2>
                            <button type="button" onClick={() => navigate("/link-summary?saved=1")}>
                                View all
                            </button>
                        </div>

                        <div className="link-summary-saved-list">
                            {SAVED_LINKS.map(({ title, url: savedUrl, Icon, tone }) => (
                                <article className="link-summary-saved-item" key={title}>
                                    <div className={`link-summary-saved-icon ${tone}`}>
                                        <Icon size={17} aria-hidden="true" />
                                    </div>
                                    <div>
                                        <h3>{title}</h3>
                                        <p>{savedUrl}</p>
                                    </div>
                                    <button aria-label={`Bookmark ${title}`} type="button">
                                        <Bookmark size={17} aria-hidden="true" />
                                    </button>
                                </article>
                            ))}
                        </div>

                        <button
                            className="link-summary-link-button"
                            type="button"
                            onClick={() => navigate("/link-summary?saved=1")}
                        >
                            <span>Manage saved links</span>
                            <span aria-hidden="true">→</span>
                        </button>
                    </section>
                </aside>
            </div>
            {showSavedLinksPanel && (
  <div className="saved-links-panel">
    <div className="saved-links-panel-card">
      <div className="saved-links-panel-header">
        <h2>Saved Links</h2>
        <button type="button" onClick={() => setShowSavedLinksPanel(false)}>
          ×
        </button>
      </div>

      {SAVED_LINKS.map(({ title, url: savedUrl, Icon, tone }) => (
        <article className="link-summary-saved-item" key={title}>
          <div className={`link-summary-saved-icon ${tone}`}>
            <Icon size={17} aria-hidden="true" />
          </div>
          <div>
            <h3>{title}</h3>
            <p>{savedUrl}</p>
          </div>
          <button aria-label={`Bookmark ${title}`} type="button">
            <Bookmark size={17} aria-hidden="true" />
          </button>
        </article>
      ))}
    </div>
  </div>
)}
        </div>
    );
}
