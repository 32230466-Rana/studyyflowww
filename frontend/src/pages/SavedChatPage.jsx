import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  getAiConversations,
  createAiConversation,
  getAiConversationMessages,
  saveAiConversationMessage,
  deleteAiConversation,
} from "../services/aiConversationService";

export default function SavedChatPage() {
  const { uuid } = useParams();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const activeUuid = uuid || null;

  async function loadConversations() {
    try {
      setLoadingChats(true);
      setError("");

      const data = await getAiConversations();
      setConversations(data.conversations?.data || []);
    } catch (err) {
      console.error("LOAD CONVERSATIONS ERROR:", err);
      setError("Failed to load saved chats.");
    } finally {
      setLoadingChats(false);
    }
  }

  async function loadMessages(chatUuid) {
    if (!chatUuid) {
      setMessages([]);
      return;
    }

    try {
      setLoadingMessages(true);
      setError("");

      const data = await getAiConversationMessages(chatUuid);
      setMessages(data.messages?.data || []);
    } catch (err) {
      console.error("LOAD MESSAGES ERROR:", err);
      setError("Failed to load chat messages.");
    } finally {
      setLoadingMessages(false);
    }
  }

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    loadMessages(activeUuid);
  }, [activeUuid]);

  async function handleNewChat() {
    try {
      setError("");

      const data = await createAiConversation({
        title: "New chat",
      });

      const newConversation = data.conversation;

      setConversations((prev) => [newConversation, ...prev]);
      navigate(`/study-chat/${newConversation.uuid}`);
    } catch (err) {
      console.error("CREATE CHAT ERROR:", err);
      setError("Failed to create new chat.");
    }
  }

  function openChat(chatUuid) {
    navigate(`/study-chat/${chatUuid}`);
  }

  async function handleSendMessage(e) {
    e.preventDefault();

    const cleanInput = input.trim();

    if (!cleanInput || sending) {
      return;
    }

    try {
      setSending(true);
      setError("");

      let chatUuid = activeUuid;

      if (!chatUuid) {
        const data = await createAiConversation({
          title: cleanInput.slice(0, 70),
        });

        chatUuid = data.conversation.uuid;
        setConversations((prev) => [data.conversation, ...prev]);
        navigate(`/study-chat/${chatUuid}`);
      }

      const userSaved = await saveAiConversationMessage(chatUuid, {
        role: "user",
        content: cleanInput,
      });

      const tempAssistantText =
        "Message saved. AI reply connection will be added in the next step.";

      const assistantSaved = await saveAiConversationMessage(chatUuid, {
        role: "assistant",
        content: tempAssistantText,
        metadata: {
          temporary: true,
        },
      });

      setMessages((prev) => [
        ...prev,
        userSaved.chat_message,
        assistantSaved.chat_message,
      ]);

      setInput("");
      await loadConversations();
    } catch (err) {
      console.error("SEND MESSAGE ERROR:", err);
      setError("Failed to save message.");
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteChat(chatUuid) {
    const ok = window.confirm("Delete this saved chat?");

    if (!ok) {
      return;
    }

    try {
      setError("");

      await deleteAiConversation(chatUuid);

      setConversations((prev) =>
        prev.filter((conversation) => conversation.uuid !== chatUuid)
      );

      if (activeUuid === chatUuid) {
        setMessages([]);
        navigate("/study-chat");
      }
    } catch (err) {
      console.error("DELETE CHAT ERROR:", err);
      setError("Failed to delete chat.");
    }
  }

  return (
    <div style={styles.page}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <h2 style={styles.logo}>StudyFlow Chats</h2>

          <button style={styles.newButton} onClick={handleNewChat}>
            + New Chat
          </button>
        </div>

        {loadingChats ? (
          <p style={styles.smallText}>Loading chats...</p>
        ) : conversations.length === 0 ? (
          <p style={styles.smallText}>No saved chats yet.</p>
        ) : (
          <div style={styles.chatList}>
            {conversations.map((conversation) => {
              const isActive = conversation.uuid === activeUuid;

              return (
                <div
                  key={conversation.uuid}
                  style={{
                    ...styles.chatItem,
                    ...(isActive ? styles.activeChatItem : {}),
                  }}
                >
                  <button
                    type="button"
                    style={styles.chatTitle}
                    onClick={() => openChat(conversation.uuid)}
                  >
                    {conversation.title || "New chat"}
                  </button>

                  <button
                    type="button"
                    style={styles.deleteButton}
                    onClick={() => handleDeleteChat(conversation.uuid)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </aside>

      <main style={styles.main}>
        <div style={styles.header}>
          <h1 style={styles.title}>
            {activeUuid ? "Saved Chat" : "Start a New Chat"}
          </h1>

          <p style={styles.subtitle}>
            Your messages are saved in the database using conversation UUIDs.
          </p>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.messagesBox}>
          {loadingMessages ? (
            <p style={styles.emptyText}>Loading messages...</p>
          ) : messages.length === 0 ? (
            <p style={styles.emptyText}>
              No messages yet. Send a message to test saving.
            </p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                style={{
                  ...styles.messageBubble,
                  ...(message.role === "user"
                    ? styles.userBubble
                    : styles.assistantBubble),
                }}
              >
                <div style={styles.roleLabel}>
                  {message.role === "user" ? "You" : "Assistant"}
                </div>

                <div style={styles.messageContent}>{message.content}</div>
              </div>
            ))
          )}
        </div>

        <form style={styles.form} onSubmit={handleSendMessage}>
          <textarea
            style={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message to save..."
            rows={3}
          />

          <button style={styles.sendButton} type="submit" disabled={sending}>
            {sending ? "Saving..." : "Send"}
          </button>
        </form>
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    background: "#f5f7fb",
    color: "#1f2937",
  },
  sidebar: {
    width: "290px",
    background: "#111827",
    color: "white",
    padding: "18px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  sidebarHeader: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  logo: {
    fontSize: "20px",
    margin: 0,
  },
  newButton: {
    border: "none",
    borderRadius: "12px",
    padding: "12px",
    cursor: "pointer",
    fontWeight: "700",
    background: "#ffffff",
    color: "#111827",
  },
  smallText: {
    color: "#cbd5e1",
    fontSize: "14px",
  },
  chatList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    overflowY: "auto",
  },
  chatItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "10px",
    borderRadius: "10px",
    background: "#1f2937",
  },
  activeChatItem: {
    background: "#374151",
  },
  chatTitle: {
    flex: 1,
    background: "transparent",
    border: "none",
    color: "white",
    cursor: "pointer",
    textAlign: "left",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  deleteButton: {
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    background: "#ef4444",
    color: "white",
    fontWeight: "700",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    padding: "24px",
    gap: "18px",
  },
  header: {
    background: "white",
    borderRadius: "16px",
    padding: "20px",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
  },
  title: {
    margin: 0,
    fontSize: "28px",
  },
  subtitle: {
    margin: "8px 0 0",
    color: "#6b7280",
  },
  error: {
    background: "#fee2e2",
    color: "#991b1b",
    padding: "12px",
    borderRadius: "12px",
  },
  messagesBox: {
    flex: 1,
    background: "white",
    borderRadius: "16px",
    padding: "20px",
    overflowY: "auto",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
  },
  emptyText: {
    textAlign: "center",
    color: "#6b7280",
    marginTop: "40px",
  },
  messageBubble: {
    maxWidth: "75%",
    padding: "12px 14px",
    borderRadius: "14px",
    marginBottom: "12px",
    lineHeight: "1.5",
  },
  userBubble: {
    marginLeft: "auto",
    background: "#dbeafe",
  },
  assistantBubble: {
    marginRight: "auto",
    background: "#f3f4f6",
  },
  roleLabel: {
    fontSize: "12px",
    fontWeight: "700",
    marginBottom: "5px",
    color: "#374151",
  },
  messageContent: {
    whiteSpace: "pre-wrap",
  },
  form: {
    display: "flex",
    gap: "12px",
    background: "white",
    borderRadius: "16px",
    padding: "14px",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: "1px solid #d1d5db",
    borderRadius: "12px",
    padding: "12px",
    fontSize: "15px",
    outline: "none",
  },
  sendButton: {
    width: "110px",
    border: "none",
    borderRadius: "12px",
    cursor: "pointer",
    background: "#2563eb",
    color: "white",
    fontWeight: "700",
  },
};