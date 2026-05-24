/* eslint-disable react-refresh/only-export-components */
import {
    AlignLeft,
    BookOpenText,
    CheckCircle2,
    FileText,
    Lightbulb,
    ListChecks,
    Quote,
    Sparkles,
    Target,
} from "lucide-react";

import "./StudySheetSummaryCard.css";

const STUDY_SHEET_FORMAT = "studyflow.study-sheet.v1";

const SECTION_CONFIG = [
    {
        key: "summary",
        title: "Summary",
        Icon: BookOpenText,
        tone: "purple",
        size: "tall",
        type: "paragraph",
    },
    {
        key: "expectation",
        title: "Expectation",
        Icon: Target,
        tone: "pink",
        type: "list",
    },
    {
        key: "mainIdea",
        title: "Main Idea",
        Icon: Lightbulb,
        tone: "yellow",
        type: "paragraph",
    },
    {
        key: "shortSummary",
        title: "Short Summary",
        Icon: AlignLeft,
        tone: "blue",
        size: "wide",
        type: "paragraph",
    },
    {
        key: "revision",
        title: "Revision / Key Points",
        Icon: ListChecks,
        tone: "green",
        type: "ordered",
    },
    {
        key: "impliedIdea",
        title: "Implied Idea",
        Icon: Sparkles,
        tone: "rose",
        type: "list",
    },
    {
        key: "theme",
        title: "Theme",
        Icon: FileText,
        tone: "violet",
        type: "paragraph",
    },
    {
        key: "importantQuotes",
        title: "Important Quotes",
        Icon: Quote,
        tone: "sky",
        size: "full",
        type: "quotes",
    },
];

const FIELD_ALIASES = {
    summary: [
        "summary",
        "summaryText",
        "summary_text",
        "overview",
        "fullSummary",
        "full_summary",
        "output",
        "result",
        "answer",
    ],
    expectation: [
        "expectation",
        "expectations",
        "expected",
        "predictions",
        "prediction",
    ],
    mainIdea: [
        "mainIdea",
        "main_idea",
        "centralIdea",
        "central_idea",
        "mainPoint",
        "main_point",
    ],
    shortSummary: [
        "shortSummary",
        "short_summary",
        "briefSummary",
        "brief_summary",
        "quickSummary",
        "quick_summary",
    ],
    revision: [
        "revision",
        "keyPoints",
        "key_points",
        "revisionKeyPoints",
        "revision_key_points",
        "importantDetails",
        "important_details",
        "takeaways",
    ],
    impliedIdea: [
        "impliedIdea",
        "implied_idea",
        "hiddenMeaning",
        "hidden_meaning",
        "deeperMeaning",
        "deeper_meaning",
    ],
    theme: ["theme", "themes", "topic", "mainTheme", "main_theme"],
    importantQuotes: [
        "importantQuotes",
        "important_quotes",
        "quotes",
        "quote",
        "sourceQuotes",
        "source_quotes",
    ],
};

const LIST_KEYS = new Set([
    "expectation",
    "revision",
    "impliedIdea",
    "importantQuotes",
]);

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value) {
    if (value === null || value === undefined) return "";

    if (Array.isArray(value)) {
        return value.map(cleanText).filter(Boolean).join("\n");
    }

    if (isPlainObject(value)) {
        const direct =
            value.text ||
            value.content ||
            value.value ||
            value.label ||
            value.title ||
            "";

        return cleanText(direct);
    }

    return String(value)
        .replace(/\r/g, "\n")
        .replace(/\t/g, " ")
        .replace(/[ \u00a0]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function compactText(value) {
    return cleanText(value).replace(/\s+/g, " ").trim();
}

function limitText(value, maxLength = 260) {
    const text = compactText(value);

    if (text.length <= maxLength) return text;

    const clipped = text.slice(0, maxLength - 3);
    const withoutPartialWord = clipped.replace(/\s+\S*$/, "").trim();

    return `${withoutPartialWord || clipped.trim()}...`;
}

function splitSentences(value) {
    const text = compactText(value);
    if (!text) return [];

    const matches =
        text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [text];

    return matches
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 2);
}

function splitList(value, maxItems = 6) {
    if (Array.isArray(value)) {
        return value
            .flatMap((item) => splitList(item, 1))
            .filter(Boolean)
            .slice(0, maxItems);
    }

    const text = cleanText(value);
    if (!text) return [];

    const lines = text
        .split(/\n+/)
        .map((line) =>
            line
                .replace(/^\s*(?:[-*]|\d+[.)])\s+/, "")
                .replace(/^["']|["']$/g, "")
                .trim()
        )
        .filter(Boolean);

    if (lines.length > 1) {
        return lines.map((line) => limitText(line, 220)).slice(0, maxItems);
    }

    return splitSentences(text)
        .map((sentence) => limitText(sentence, 220))
        .slice(0, maxItems);
}

function firstAvailable(...values) {
    for (const value of values) {
        if (Array.isArray(value) && value.length > 0) return value;
        if (cleanText(value)) return value;
    }

    return "";
}

function getNestedValue(source, aliases) {
    if (!isPlainObject(source)) return "";

    for (const alias of aliases) {
        if (Object.prototype.hasOwnProperty.call(source, alias)) {
            return source[alias];
        }
    }

    return "";
}

function looksLikeStudySheetObject(value) {
    if (!isPlainObject(value)) return false;

    if (value.format === STUDY_SHEET_FORMAT) return true;
    if (isPlainObject(value.sections)) return true;
    if (isPlainObject(value.studySheet)) return true;

    return Object.values(FIELD_ALIASES).some((aliases) =>
        aliases.some((alias) => Object.prototype.hasOwnProperty.call(value, alias))
    );
}

function tryParseJson(value) {
    if (typeof value !== "string") return null;

    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return null;

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function getStudySheetObject(input) {
    const parsedInput = typeof input === "string" ? tryParseJson(input) : null;

    if (looksLikeStudySheetObject(parsedInput)) {
        return parsedInput.sections || parsedInput.studySheet || parsedInput;
    }

    if (isPlainObject(input)) {
        const serializedSummary = firstAvailable(
            input.summary_text,
            input.summaryText
        );
        const parsedSummary = tryParseJson(serializedSummary);

        if (looksLikeStudySheetObject(parsedSummary)) {
            return (
                parsedSummary.sections ||
                parsedSummary.studySheet ||
                parsedSummary
            );
        }

        if (looksLikeStudySheetObject(input)) {
            return input.sections || input.studySheet || input;
        }

        if (looksLikeStudySheetObject(input.data)) {
            return input.data.sections || input.data.studySheet || input.data;
        }
    }

    return null;
}

function getRawSummaryText(input) {
    if (typeof input === "string") {
        const parsed = tryParseJson(input);
        if (looksLikeStudySheetObject(parsed)) {
            const sections = parsed.sections || parsed.studySheet || parsed;
            return cleanText(sections.summary || sections.rawText || "");
        }

        return cleanText(input);
    }

    if (!isPlainObject(input)) return "";

    const serializedSummary = firstAvailable(input.summary_text, input.summaryText);
    const parsedSummary = tryParseJson(serializedSummary);

    if (looksLikeStudySheetObject(parsedSummary)) {
        const sections =
            parsedSummary.sections || parsedSummary.studySheet || parsedSummary;
        return cleanText(sections.summary || sections.rawText || "");
    }

    return cleanText(
        firstAvailable(
            input.summary,
            input.summaryText,
            input.summary_text,
            input.output,
            input.result,
            input.answer,
            input.text,
            input.content,
            input.data?.summary,
            input.data?.output,
            input.data?.result,
            input.data?.answer,
            input.raw?.summary,
            input.raw?.output,
            input.raw?.result
        )
    );
}

function labelToKey(label) {
    const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();

    if (normalized === "summary" || normalized === "overview") return "summary";
    if (normalized === "expectation" || normalized === "expectations") {
        return "expectation";
    }
    if (normalized === "main idea" || normalized === "central idea") {
        return "mainIdea";
    }
    if (normalized === "short summary" || normalized === "brief summary") {
        return "shortSummary";
    }
    if (
        normalized === "revision" ||
        normalized === "key points" ||
        normalized === "revision key points" ||
        normalized === "revision / key points"
    ) {
        return "revision";
    }
    if (normalized === "implied idea" || normalized === "hidden meaning") {
        return "impliedIdea";
    }
    if (normalized === "theme" || normalized === "themes") return "theme";
    if (normalized === "important quotes" || normalized === "quotes") {
        return "importantQuotes";
    }

    return "";
}

function parseLabeledSections(value) {
    const text = cleanText(value);
    if (!text) return {};

    const sections = {};
    const lines = text.split(/\n+/);
    let currentKey = "";

    const headingPattern =
        /^\s*(summary|overview|expectation|expectations|main idea|central idea|short summary|brief summary|revision\s*\/?\s*key points|revision|key points|implied idea|hidden meaning|theme|themes|important quotes|quotes)\s*[:-]?\s*(.*)$/i;

    lines.forEach((line) => {
        const match = line.match(headingPattern);

        if (match) {
            currentKey = labelToKey(match[1]);
            const inlineText = cleanText(match[2]);

            if (currentKey && inlineText) {
                sections[currentKey] = [
                    ...(sections[currentKey] || []),
                    inlineText,
                ];
            }

            return;
        }

        if (currentKey && cleanText(line)) {
            sections[currentKey] = [...(sections[currentKey] || []), line];
        }
    });

    return Object.fromEntries(
        Object.entries(sections).map(([key, value]) => [key, value.join("\n")])
    );
}

function guessTopic(text, context = {}) {
    const title = compactText(
        context.title ||
            context.fileName ||
            context.filename ||
            context.sourceTitle ||
            ""
    );

    if (title) return title;

    const firstSentence = splitSentences(text)[0] || compactText(text);
    const words = firstSentence
        .replace(/[^a-zA-Z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .slice(0, 5);

    return words.length ? words.join(" ") : "this material";
}

function extractQuotes(text) {
    const matches = [];
    const quotePattern = /"([^"]{12,220})"|'([^']{12,220})'/g;
    let match = quotePattern.exec(text);

    while (match && matches.length < 3) {
        matches.push(limitText(match[1] || match[2], 220));
        match = quotePattern.exec(text);
    }

    return matches;
}

function fallbackStudySheet(rawText, context = {}) {
    const text = cleanText(rawText);
    const sentences = splitSentences(text);
    const topic = guessTopic(text, context);
    const mainIdea = limitText(sentences[0] || text || `Study notes about ${topic}.`, 280);
    const shortSummary = limitText(
        sentences.slice(0, 2).join(" ") || mainIdea,
        360
    );
    const revision = splitList(text, 6);
    const quotes = extractQuotes(text);
    const fallbackQuoteLines =
        quotes.length > 0 ? quotes : sentences.slice(0, 2).map((item) => limitText(item, 220));

    return {
        summary: text || `A study summary for ${topic}.`,
        expectation: [
            `Expect this material to explain ${topic}.`,
            "Look for the causes, examples, and results that support the main idea.",
            "Focus on the details most useful for review or exam practice.",
        ],
        mainIdea,
        shortSummary,
        revision:
            revision.length > 0
                ? revision
                : [
                      mainIdea,
                      "Review the key terms and connect them to the examples.",
                      "Use the short summary as a quick final check.",
                  ],
        impliedIdea: [
            `The deeper point is why ${topic} matters beyond the surface details.`,
            "The supporting details help connect the facts to a broader lesson.",
        ],
        theme: limitText(topic, 140),
        importantQuotes:
            fallbackQuoteLines.length > 0
                ? fallbackQuoteLines
                : ["No direct quote was returned, so use the summary lines above as review evidence."],
    };
}

function normalizeListField(value, fallback) {
    const list = splitList(value, 8);
    return list.length > 0 ? list : fallback;
}

function normalizeTextField(value, fallback) {
    return cleanText(value) || fallback;
}

export function normalizeStudySheetSummary(input, context = {}) {
    const rawText = getRawSummaryText(input);
    const structured = getStudySheetObject(input) || {};
    const labeled = parseLabeledSections(rawText);
    const fallback = fallbackStudySheet(rawText, context);

    return SECTION_CONFIG.reduce((sheet, section) => {
        const key = section.key;
        const value = firstAvailable(
            getNestedValue(structured, FIELD_ALIASES[key]),
            getNestedValue(structured.data, FIELD_ALIASES[key]),
            labeled[key]
        );

        sheet[key] = LIST_KEYS.has(key)
            ? normalizeListField(value, fallback[key])
            : normalizeTextField(value, fallback[key]);

        return sheet;
    }, {});
}

export function serializeStudySheetSummary(input, context = {}) {
    const sheet = normalizeStudySheetSummary(input, context);

    return JSON.stringify({
        format: STUDY_SHEET_FORMAT,
        generatedAt: new Date().toISOString(),
        title: context.title || "",
        sourceType: context.sourceType || context.source_type || "",
        sourceUrl: context.url || context.sourceUrl || "",
        sections: sheet,
    });
}

export function formatStudySheetAsText(input, context = {}) {
    const sheet = normalizeStudySheetSummary(input, context);

    return SECTION_CONFIG.map((section) => {
        const value = sheet[section.key];

        if (Array.isArray(value)) {
            const rows = value
                .map((item, index) => `${index + 1}. ${compactText(item)}`)
                .join("\n");

            return `${section.title}\n${rows}`;
        }

        return `${section.title}\n${cleanText(value)}`;
    }).join("\n\n");
}

function StudySheetSection({ section, value }) {
    const Icon = section.Icon;
    const sectionClass = [
        "study-sheet-section",
        `study-sheet-section--${section.tone}`,
        section.size ? `study-sheet-section--${section.size}` : "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <section className={sectionClass}>
            <div className="study-sheet-section-title">
                <span className="study-sheet-section-icon">
                    <Icon size={16} strokeWidth={2.2} />
                </span>
                <span>{section.title}</span>
            </div>

            <div className="study-sheet-section-body">
                {renderSectionBody(section, value)}
            </div>
        </section>
    );
}

function renderSectionBody(section, value) {
    if (Array.isArray(value)) {
        const Tag = section.type === "ordered" ? "ol" : "ul";
        const className =
            section.type === "quotes"
                ? "study-sheet-list study-sheet-quote-list"
                : "study-sheet-list";

        return (
            <Tag className={className}>
                {value.map((item, index) => (
                    <li key={`${section.key}-${index}`}>{item}</li>
                ))}
            </Tag>
        );
    }

    const paragraphs = cleanText(value)
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    if (paragraphs.length === 0) {
        return <p>No details available yet.</p>;
    }

    return paragraphs.map((paragraph, index) => (
        <p key={`${section.key}-${index}`}>{paragraph}</p>
    ));
}

export default function StudySheetSummaryCard({
    summary,
    title = "Study Sheet Summary",
    sourceLabel = "",
    generatedAt = "",
    meta = [],
    className = "",
}) {
    const sheet = normalizeStudySheetSummary(summary, { title, sourceLabel });
    const metaItems = [
        sourceLabel ? { label: sourceLabel } : null,
        generatedAt ? { label: generatedAt } : null,
        ...meta,
    ].filter(Boolean);

    return (
        <article className={`study-sheet-summary-card ${className}`.trim()}>
            <header className="study-sheet-header">
                <div className="study-sheet-title-group">
                    <span className="study-sheet-header-icon">
                        <CheckCircle2 size={18} strokeWidth={2.4} />
                    </span>
                    <div>
                        <p className="study-sheet-eyebrow">Study sheet</p>
                        <h2 className="study-sheet-title">{title}</h2>
                    </div>
                </div>

                {metaItems.length > 0 && (
                    <div className="study-sheet-meta">
                        {metaItems.map((item, index) => (
                            <span
                                className="study-sheet-meta-badge"
                                key={`${item.label}-${index}`}
                            >
                                {item.label}
                            </span>
                        ))}
                    </div>
                )}
            </header>

            <div className="study-sheet-grid">
                {SECTION_CONFIG.map((section) => (
                    <StudySheetSection
                        key={section.key}
                        section={section}
                        value={sheet[section.key]}
                    />
                ))}
            </div>
        </article>
    );
}
