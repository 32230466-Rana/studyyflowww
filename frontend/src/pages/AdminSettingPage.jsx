import { useNavigate } from "react-router-dom";

export default function AdminSettingsPage() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: "100vh", padding: 32, background: "#f4f8ff" }}>
      <button
        onClick={() => navigate("/admin")}
        style={{
          border: 0,
          background: "#ffffff",
          color: "#164b8f",
          padding: "12px 18px",
          borderRadius: 14,
          fontWeight: 800,
          cursor: "pointer",
          marginBottom: 18,
        }}
      >
        ← Back to Admin Dashboard
      </button>

      <div
        style={{
          background: "#ffffff",
          borderRadius: 24,
          padding: 24,
          boxShadow: "0 14px 32px rgba(15, 23, 42, 0.08)",
        }}
      >
        <h1 style={{ margin: 0, color: "#164b8f" }}>System Settings</h1>

        <p style={{ color: "#64748b", fontWeight: 700 }}>
          Admin can view file limits and AI service options.
        </p>

        <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
          <div
            style={{
              padding: 18,
              borderRadius: 18,
              background: "#f8fbff",
              border: "1px solid #dbeafe",
              color: "#334155",
              fontWeight: 700,
            }}
          >
            <strong>File Limits</strong>
            <p>Uploaded files are monitored from Notes and Files Uploaded stats.</p>
          </div>

          <div
            style={{
              padding: 18,
              borderRadius: 18,
              background: "#f8fbff",
              border: "1px solid #dbeafe",
              color: "#334155",
              fontWeight: 700,
            }}
          >
            <strong>AI Options</strong>
            <p>Current AI Model: Local Ollama</p>
            <p>Quiz Generator: Ready</p>
            <p>Summary Service: Connected</p>
          </div>
        </div>
      </div>
    </div>
  );
}