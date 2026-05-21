import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosClient from "../api/axiosClient";

export default function AdminFeedbackPage() {
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadFeedback = async () => {
    setLoading(true);

    try {
      const res = await axiosClient.get("/feedback/recent");
      const data = res?.data?.data || res?.data || [];
      setFeedback(Array.isArray(data) ? data : data.feedback || data.items || []);
    } catch {
      setFeedback([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeedback();
  }, []);

  return (
    <div style={{ minHeight: "100vh", padding: 32, background: "#f4f8ff" }}>
      <button onClick={() => navigate("/admin")} style={backBtn}>
        ← Back to Admin Dashboard
      </button>

      <div style={card}>
        <h1 style={{ margin: 0, color: "#164b8f" }}>Reports & Feedback</h1>
        <p style={{ color: "#64748b", fontWeight: 700 }}>
          Admin can review user feedback and reported issues.
        </p>

        <button onClick={loadFeedback} style={primaryBtn}>
          Refresh Feedback
        </button>

        {loading ? (
          <p style={{ fontWeight: 800 }}>Loading...</p>
        ) : feedback.length === 0 ? (
          <div style={emptyBox}>No feedback found.</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {feedback.map((item, index) => (
              <div key={item.id || index} style={feedbackBox}>
                <strong style={{ color: "#0f172a" }}>
                  {item.name || item.user_name || item.email || "User Feedback"}
                </strong>

                <p style={{ color: "#334155", fontWeight: 700 }}>
                  {item.message || item.feedback || item.content || item.description || "No message"}
                </p>

                <small style={{ color: "#64748b", fontWeight: 700 }}>
                  {item.created_at ? new Date(item.created_at).toLocaleString() : ""}
                </small>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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

const card = {
  background: "#ffffff",
  borderRadius: 24,
  padding: 24,
  boxShadow: "0 14px 32px rgba(15, 23, 42, 0.08)",
};

const primaryBtn = {
  border: 0,
  background: "#2563eb",
  color: "#ffffff",
  padding: "12px 18px",
  borderRadius: 14,
  fontWeight: 900,
  cursor: "pointer",
  marginBottom: 18,
};

const emptyBox = {
  background: "#f8fbff",
  border: "1px solid #dbeafe",
  borderRadius: 18,
  padding: 18,
  color: "#64748b",
  fontWeight: 800,
};

const feedbackBox = {
  background: "#f8fbff",
  border: "1px solid #dbeafe",
  borderRadius: 18,
  padding: 18,
};