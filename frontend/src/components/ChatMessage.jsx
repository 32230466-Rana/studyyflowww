import { useState } from "react";

export function TypingIndicator() {
    return (
        <div
            style={{
                display: "flex",
                justifyContent: "flex-start",
                marginBottom: 12,
            }}
        >
            <div
                style={{
                    maxWidth: "78%",
                    padding: "12px 14px",
                    borderRadius: 14,
                    background: "#f3f4f6",
                    color: "#111827",
                    border: "1px solid #e5e7eb",
                }}
            >
                AI is typing...
            </div>
        </div>
    );
}

export default function ChatMessage({
    id = null,
    role = "ai",
    content = "",
    metadata = {},
    onEdit = null,
    onReaction = null,
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(content || "");
    const [copied, setCopied] = useState(false);

    const isUser = role === "user";
    const isAi = role === "ai" || role === "assistant";
    const reaction = metadata?.reaction || null;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content || "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch (error) {
            console.error("Copy failed:", error);
            alert("Copy failed.");
        }
    };

    const handleShare = async () => {
        try {
            if (navigator.share) {
                await navigator.share({
                    title: "StudyFlow AI Answer",
                    text: content || "",
                });
                return;
            }

            await navigator.clipboard.writeText(content || "");
            alert("Share is not supported here, so the message was copied.");
        } catch (error) {
            console.error("Share failed:", error);
        }
    };

    const saveEdit = () => {
        const clean = editValue.trim();

        if (!clean) return;

        if (onEdit && id) {
            onEdit(id, clean);
        }

        setIsEditing(false);
    };

    const like = () => {
        if (onReaction && id) {
            onReaction(id, reaction === "like" ? null : "like");
        }
    };

    const dislike = () => {
        if (onReaction && id) {
            onReaction(id, reaction === "dislike" ? null : "dislike");
        }
    };

    return (
        <div
            style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
                marginBottom: 12,
            }}
        >
            <div
                style={{
                    maxWidth: "78%",
                    padding: "12px 14px",
                    borderRadius: 14,
                    background: isUser ? "#dbeafe" : "#f3f4f6",
                    color: "#111827",
                    border: "1px solid #e5e7eb",
                }}
            >
                <div
                    style={{
                        fontSize: 12,
                        fontWeight: 700,
                        marginBottom: 6,
                        color: "#374151",
                    }}
                >
                    {isUser ? "You" : "AI"}
                </div>

                {isEditing ? (
                    <div>
                        <textarea
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            rows={4}
                            style={{
                                width: "100%",
                                minWidth: 280,
                                border: "1px solid #d1d5db",
                                borderRadius: 10,
                                padding: 10,
                                resize: "vertical",
                                fontSize: 14,
                            }}
                        />

                        <div
                            style={{
                                display: "flex",
                                gap: 8,
                                marginTop: 8,
                                justifyContent: "flex-end",
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => setIsEditing(false)}
                                style={smallButtonStyle}
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={saveEdit}
                                style={primarySmallButtonStyle}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                ) : (
                    <div
                        style={{
                            whiteSpace: "pre-wrap",
                            lineHeight: "1.7",
                            fontSize: 14,
                        }}
                    >
                        {content}
                    </div>
                )}

                {!isEditing && (
                    <div
                        style={{
                            display: "flex",
                            gap: 8,
                            marginTop: 10,
                            flexWrap: "wrap",
                            justifyContent: isUser ? "flex-end" : "flex-start",
                        }}
                    >
                        {isAi && (
                            <>
                                <button
                                    type="button"
                                    onClick={like}
                                    style={{
                                        ...actionButtonStyle,
                                        background:
                                            reaction === "like"
                                                ? "#dcfce7"
                                                : "#ffffff",
                                    }}
                                >
                                    👍 Like
                                </button>

                                <button
                                    type="button"
                                    onClick={dislike}
                                    style={{
                                        ...actionButtonStyle,
                                        background:
                                            reaction === "dislike"
                                                ? "#fee2e2"
                                                : "#ffffff",
                                    }}
                                >
                                    👎 Dislike
                                </button>

                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    style={actionButtonStyle}
                                >
                                    {copied ? "✅ Copied" : "📋 Copy"}
                                </button>

                                <button
                                    type="button"
                                    onClick={handleShare}
                                    style={actionButtonStyle}
                                >
                                    🔗 Share
                                </button>
                            </>
                        )}

                        {isUser && (
                            <button
                                type="button"
                                onClick={() => {
                                    setEditValue(content || "");
                                    setIsEditing(true);
                                }}
                                style={actionButtonStyle}
                            >
                                ✏️ Edit
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

const actionButtonStyle = {
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 12,
    cursor: "pointer",
};

const smallButtonStyle = {
    border: "1px solid #d1d5db",
    background: "#ffffff",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    cursor: "pointer",
};

const primarySmallButtonStyle = {
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#ffffff",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    cursor: "pointer",
};