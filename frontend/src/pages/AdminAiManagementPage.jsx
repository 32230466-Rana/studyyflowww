import { useEffect, useMemo, useState } from "react";
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

export default function AdminAiManagementPage() {
  const [users, setUsers] = useState([]);
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [weeklyLimit, setWeeklyLimit] = useState(50);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const params = {};
      if (search.trim()) params.search = search.trim();

      const response = await axiosClient.get("/admin/ai-usage", { params });
      const data = response.data?.data || {};

      setUsers(Array.isArray(data.users) ? data.users : []);
      setPeriod(data.period || { start: "", end: "" });
      setWeeklyLimit(Number(data.weekly_limit || 50));
    } catch (err) {
      console.error("ADMIN AI USAGE LOAD ERROR:", {
        status: err?.response?.status,
        body: err?.response?.data,
      });
      setUsers([]);
      setError(getApiError(err, "Failed to load AI usage."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totals = useMemo(() => {
    const used = users.reduce((sum, user) => sum + Number(user.weekly_usage || user.weekly_ai_usage || 0), 0);
    const nearLimit = users.filter((user) => Number(user.weekly_usage || user.weekly_ai_usage || 0) >= weeklyLimit).length;

    return { used, nearLimit, users: users.length };
  }, [users, weeklyLimit]);

  const resetUsage = async (user) => {
    if (!confirm(`Reset weekly AI usage for ${user.name}?`)) return;

    setError("");
    setNotice("");

    try {
      await axiosClient.post(`/admin/users/${user.id}/reset-weekly-usage`);
      setNotice("Weekly AI usage reset.");
      await load();
    } catch (err) {
      console.error("ADMIN AI USAGE RESET ERROR:", {
        status: err?.response?.status,
        body: err?.response?.data,
      });
      setError(getApiError(err, "Failed to reset weekly usage."));
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1 className="page-title">AI Usage</h1>
        <p className="page-desc">
          Weekly AI usage limit is {weeklyLimit} requests per user.
        </p>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}

      <div className="admin-stats-grid" style={{ marginBottom: 14 }}>
        <div className="admin-stat-card blue">
          <div className="admin-stat-copy">
            <strong>{totals.users}</strong>
            <p>Users tracked</p>
            <span>{period.start || "-"} to {period.end || "-"}</span>
          </div>
        </div>
        <div className="admin-stat-card purple">
          <div className="admin-stat-copy">
            <strong>{totals.used}</strong>
            <p>AI usage this week</p>
            <span>Across all users</span>
          </div>
        </div>
        <div className="admin-stat-card orange">
          <div className="admin-stat-copy">
            <strong>{weeklyLimit}</strong>
            <p>Weekly limit</p>
            <span>Per user</span>
          </div>
        </div>
        <div className="admin-stat-card green">
          <div className="admin-stat-copy">
            <strong>{totals.nearLimit}</strong>
            <p>At limit</p>
            <span>Can be reset by admin</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label">Search</label>
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search user name or email"
          />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--color-bg)" }}>
                {["User", "Email", "Role", "Status", "Used", "Remaining", "Last login", "Actions"].map((column) => (
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
              {users.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 18, color: "var(--color-muted)" }}>
                    No AI usage found.
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const used = Number(user.weekly_usage || user.weekly_ai_usage || 0);
                  const remaining = Math.max(0, weeklyLimit - used);

                  return (
                    <tr key={user.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{user.name}</td>
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{user.email}</td>
                      <td style={{ padding: "12px 14px" }}>{user.role || "user"}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <span className={user.status === "active" ? "badge badge-success" : "badge badge-default"}>
                          {user.status || "active"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                        {used} / {weeklyLimit}
                      </td>
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{remaining}</td>
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{formatDate(user.last_login_at)}</td>
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                        <button className="btn btn-sm btn-ghost" type="button" onClick={() => resetUsage(user)}>
                          Reset weekly usage
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
