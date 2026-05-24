import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { PageSpinner } from "../components/Spinner.jsx";

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function getApiError(error, fallback = "Something went wrong.") {
  const data = error?.response?.data;

  if (data?.errors) {
    return Object.values(data.errors).flat().join(" ");
  }

  return data?.message || fallback;
}

export default function AdminFeedbackPage() {
  const [feedback, setFeedback] = useState([]);
  const [pagination, setPagination] = useState({
    current_page: 1,
    per_page: 10,
    total: 0,
    last_page: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState("all");
  const [rating, setRating] = useState("all");

  const page = pagination.current_page;

  const loadFeedback = async (pageValue = page) => {
    setLoading(true);
    setError("");

    try {
      const params = {
        page: pageValue,
        per_page: pagination.per_page,
      };

      if (search.trim()) params.search = search.trim();
      if (visibility !== "all") params.is_visible = visibility === "visible";
      if (rating !== "all") params.rating = rating;

      const response = await axiosClient.get("/admin/feedback", { params });
      const data = response.data?.data || {};

      setFeedback(Array.isArray(data.feedback) ? data.feedback : []);
      setPagination(data.pagination || pagination);
    } catch (err) {
      setFeedback([]);
      setError(getApiError(err, "Failed to load feedback."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadFeedback(1);
    }, 250);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, visibility, rating, pagination.per_page]);

  const toggleVisibility = async (item) => {
    setError("");

    try {
      await axiosClient.patch(`/admin/feedback/${item.id}/toggle-visibility`);
      await loadFeedback(page);
    } catch (err) {
      setError(getApiError(err, "Action failed."));
    }
  };

  const deleteFeedback = async (item) => {
    if (!confirm("Delete this feedback?")) return;

    setError("");

    try {
      await axiosClient.delete(`/admin/feedback/${item.id}`);
      await loadFeedback(1);
    } catch (err) {
      setError(getApiError(err, "Delete failed."));
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1 className="page-title">Feedback & Reports</h1>
        <p className="page-desc">Review feedback from every user and hide or delete resolved items.</p>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="field" style={{ marginBottom: 0, flex: "1 1 280px" }}>
            <label className="field-label">Search</label>
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by user, email, or message"
            />
          </div>

          <div className="field" style={{ marginBottom: 0, minWidth: 170 }}>
            <label className="field-label">Visibility</label>
            <select className="input" value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="all">All</option>
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>

          <div className="field" style={{ marginBottom: 0, minWidth: 150 }}>
            <label className="field-label">Rating</label>
            <select className="input" value={rating} onChange={(event) => setRating(event.target.value)}>
              <option value="all">All</option>
              {[5, 4, 3, 2, 1].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--color-bg)" }}>
                {["User", "Email", "Online", "Rating", "Message", "Visible", "Created", "Actions"].map((column) => (
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
              {feedback.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 18, color: "var(--color-muted)" }}>
                    No feedback found.
                  </td>
                </tr>
              ) : (
                feedback.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      {item.user_name || item.name || "User"}
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{item.email || "-"}</td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span className={item.user?.is_online ? "badge badge-success" : "badge badge-default"}>
                        {item.user?.is_online ? "online" : "offline"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{item.rating || "-"}</td>
                    <td style={{ padding: "12px 14px", minWidth: 260, whiteSpace: "normal" }}>
                      {item.message || "-"}
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span className={item.is_visible ? "badge badge-success" : "badge badge-default"}>
                        {item.is_visible ? "visible" : "hidden"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{formatDate(item.created_at)}</td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn btn-sm btn-ghost" type="button" onClick={() => toggleVisibility(item)}>
                          {item.is_visible ? "Hide" : "Show"}
                        </button>
                        <button className="btn btn-sm btn-danger" type="button" onClick={() => deleteFeedback(item)}>
                          Delete
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12 }}>
        <div style={{ fontSize: 13, color: "var(--color-muted)" }}>
          Page {pagination.current_page} of {pagination.last_page} - {pagination.total} total
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={pagination.current_page <= 1}
            onClick={() => loadFeedback(pagination.current_page - 1)}
          >
            Prev
          </button>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={pagination.current_page >= pagination.last_page}
            onClick={() => loadFeedback(pagination.current_page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
