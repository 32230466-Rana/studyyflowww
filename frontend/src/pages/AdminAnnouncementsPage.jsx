import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function AdminAnnouncementsPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [announcements, setAnnouncements] = useState([]);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("studyflow_announcements") || "[]");
    setAnnouncements(saved);
  }, []);

  const saveList = (list) => {
    setAnnouncements(list);
    localStorage.setItem("studyflow_announcements", JSON.stringify(list));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!title.trim() || !message.trim()) return;

    const item = {
      id: Date.now(),
      title: title.trim(),
      message: message.trim(),
      created_at: new Date().toISOString(),
    };

    saveList([item, ...announcements]);
    setTitle("");
    setMessage("");
  };

  const deleteItem = (id) => {
    saveList(announcements.filter((item) => item.id !== id));
  };

  return (
    <div style={{ minHeight: "100vh", padding: 32, background: "#f4f8ff" }}>
      <button onClick={() => navigate("/admin")} style={backBtn}>
        ← Back to Admin Dashboard
      </button>

      <div style={card}>
        <h1 style={titleStyle}>Announcements</h1>
        <p style={textStyle}>Admin can post platform updates and alerts for students.</p>

        <form onSubmit={handleSubmit}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Announcement title"
            style={inputStyle}
          />

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write announcement message..."
            rows="5"
            style={textareaStyle}
          />

          <button type="submit" style={primaryBtn}>
            Post Announcement
          </button>
        </form>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {announcements.length === 0 ? (
          <div style={emptyBox}>No announcements yet.</div>
        ) : (
          announcements.map((item) => (
            <div key={item.id} style={card}>
              <h3 style={{ margin: "0 0 8px", color: "#0f172a" }}>{item.title}</h3>
              <p style={{ color: "#334155", fontWeight: 700 }}>{item.message}</p>
              <small style={{ color: "#64748b", fontWeight: 700 }}>
                {new Date(item.created_at).toLocaleString()}
              </small>

              <br />

              <button onClick={() => deleteItem(item.id)} style={deleteBtn}>
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const card = {
  background: "#ffffff",
  borderRadius: 24,
  padding: 24,
  boxShadow: "0 14px 32px rgba(15, 23, 42, 0.08)",
  marginBottom: 22,
};

const backBtn = {
  border: 0,
  background: "#ffffff",
  color: "#164b8f",
  padding: "12px 18px",
  borderRadius: 14,
  fontWeight: 800,
  cursor: "pointer",
  marginBottom: 18,
};

const titleStyle = {
  margin: 0,
  color: "#164b8f",
};

const textStyle = {
  color: "#64748b",
  fontWeight: 700,
};

const inputStyle = {
  width: "100%",
  padding: 14,
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  marginBottom: 12,
  fontWeight: 700,
};

const textareaStyle = {
  ...inputStyle,
  resize: "vertical",
};

const primaryBtn = {
  border: 0,
  background: "#2563eb",
  color: "#ffffff",
  padding: "13px 20px",
  borderRadius: 14,
  fontWeight: 900,
  cursor: "pointer",
};

const deleteBtn = {
  marginTop: 12,
  border: 0,
  background: "#fee2e2",
  color: "#b91c1c",
  padding: "9px 14px",
  borderRadius: 12,
  fontWeight: 900,
  cursor: "pointer",
};

const emptyBox = {
  background: "#ffffff",
  borderRadius: 20,
  padding: 20,
  color: "#94a3b8",
  fontWeight: 800,
};