import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { PageSpinner } from "../components/Spinner.jsx";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function getApiError(error, fallback) {
  const data = error?.response?.data;
  if (data?.errors) return Object.values(data.errors).flat().join(" ");
  return data?.message || fallback;
}

export default function AdminActivityPage() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [type, setType] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const params = {};
      if (type.trim()) params.type = type.trim();

      const response = await axiosClient.get("/admin/activity", { params });
      const data = response.data?.data || response.data || {};
      setActivities(Array.isArray(data.activities) ? data.activities : []);
    } catch (err) {
      console.error("ADMIN ACTIVITY LOAD ERROR:", {
        status: err?.response?.status,
        body: err?.response?.data,
      });
      setActivities([]);
      setError(getApiError(err, "Failed to load activity logs."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  if (loading) return <PageSpinner />;

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1 className="page-title">Activity Logs</h1>
        <p className="page-desc">Recent admin-visible events from users and platform actions.</p>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label">Filter by type</label>
          <input
            className="input"
            value={type}
            onChange={(event) => setType(event.target.value)}
            placeholder="login, note_uploaded, quiz_generated..."
          />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--color-bg)" }}>
                {["Type", "Title", "Description", "User", "Created"].map((column) => (
                  <th
                    key={column}
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      fontSize: 11.5,
                      color: "var(--color-muted)",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {activities.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 18, color: "var(--color-muted)" }}>
                    No activity logs found.
                  </td>
                </tr>
              ) : (
                activities.map((activity) => (
                  <tr key={activity.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span className="badge badge-info">{activity.type || "activity"}</span>
                    </td>
                    <td style={{ padding: "12px 14px", minWidth: 180 }}>{activity.title || "-"}</td>
                    <td style={{ padding: "12px 14px", minWidth: 260 }}>{activity.description || "-"}</td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      {activity.user?.name || activity.user_name || "-"}
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{formatDate(activity.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
