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

export default function AdminQuizManagementPage() {
  const [reports, setReports] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/admin/quiz-reports");
      const data = response.data?.data || response.data || {};
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (err) {
      console.error("ADMIN QUIZ REPORTS LOAD ERROR:", {
        status: err?.response?.status,
        body: err?.response?.data,
      });
      setReports([]);
      setError(getApiError(err, "Failed to load quiz reports."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return reports.filter((report) => {
      const matchesStatus = status === "all" || report.status === status;
      const text = `${report.issue_message || ""} ${report.question_text || ""} ${report.user?.name || ""} ${report.user?.email || ""}`.toLowerCase();
      return matchesStatus && (!term || text.includes(term));
    });
  }, [reports, search, status]);

  const stats = useMemo(() => ({
    total: reports.length,
    open: reports.filter((report) => report.status === "open").length,
    reviewed: reports.filter((report) => report.status === "reviewed").length,
    resolved: reports.filter((report) => report.status === "resolved").length,
  }), [reports]);

  const updateStatus = async (report, nextStatus) => {
    setError("");

    try {
      await axiosClient.patch(`/admin/quiz-reports/${report.id}/status`, {
        status: nextStatus,
      });
      await load();
    } catch (err) {
      console.error("ADMIN QUIZ REPORT STATUS ERROR:", {
        status: err?.response?.status,
        body: err?.response?.data,
      });
      setError(getApiError(err, "Failed to update quiz report."));
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1 className="page-title">Quiz Management</h1>
        <p className="page-desc">Generated quiz reports, issues, and failures from students.</p>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="admin-stats-grid" style={{ marginBottom: 14 }}>
        <Stat label="Total reports" value={stats.total} />
        <Stat label="Open" value={stats.open} />
        <Stat label="Reviewed" value={stats.reviewed} />
        <Stat label="Resolved" value={stats.resolved} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="field" style={{ marginBottom: 0, flex: "1 1 280px" }}>
            <label className="field-label">Search</label>
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reports, question text, or user"
            />
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <label className="field-label">Status</label>
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="reviewed">Reviewed</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--color-bg)" }}>
                {["User", "Question", "Issue", "Status", "Created", "Actions"].map((column) => (
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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 18, color: "var(--color-muted)" }}>
                    No quiz reports found.
                  </td>
                </tr>
              ) : (
                filtered.map((report) => (
                  <tr key={report.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      {report.user?.name || "-"}
                      <div style={{ color: "var(--color-muted)" }}>{report.user?.email || ""}</div>
                    </td>
                    <td style={{ padding: "12px 14px", minWidth: 240 }}>{report.question_text || "-"}</td>
                    <td style={{ padding: "12px 14px", minWidth: 280 }}>{report.issue_message || "-"}</td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span className={report.status === "resolved" ? "badge badge-success" : "badge badge-warning"}>
                        {report.status || "open"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{formatDate(report.created_at)}</td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn btn-sm btn-ghost" type="button" onClick={() => updateStatus(report, "reviewed")}>
                          Mark reviewed
                        </button>
                        <button className="btn btn-sm btn-secondary" type="button" onClick={() => updateStatus(report, "resolved")}>
                          Mark resolved
                        </button>
                      </div>
                    </td>
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

function Stat({ label, value }) {
  return (
    <div className="admin-stat-card blue">
      <div className="admin-stat-copy">
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </div>
  );
}
