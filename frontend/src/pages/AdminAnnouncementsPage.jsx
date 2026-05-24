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

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [pagination, setPagination] = useState({
    current_page: 1,
    per_page: 10,
    total: 0,
    last_page: 1,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    title: "",
    message: "",
    is_active: true,
  });

  const page = pagination.current_page;

  const load = async (pageValue = page) => {
    setLoading(true);
    setError("");

    try {
      const params = {
        page: pageValue,
        per_page: pagination.per_page,
      };

      if (search.trim()) params.search = search.trim();
      if (activeFilter !== "all") params.is_active = activeFilter === "active";

      const response = await axiosClient.get("/admin/announcements", { params });
      const data = response.data?.data || {};

      setAnnouncements(Array.isArray(data.announcements) ? data.announcements : []);
      setPagination(data.pagination || pagination);
    } catch (err) {
      setError(getApiError(err, "Failed to load announcements."));
      setAnnouncements([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      load(1);
    }, 250);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeFilter, pagination.per_page]);

  const resetForm = () => {
    setEditing(null);
    setForm({
      title: "",
      message: "",
      is_active: true,
    });
  };

  const editAnnouncement = (item) => {
    setEditing(item);
    setForm({
      title: item.title || "",
      message: item.message || "",
      is_active: Boolean(item.is_active),
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        is_active: form.is_active,
      };

      if (editing) {
        await axiosClient.put(`/admin/announcements/${editing.id}`, payload);
      } else {
        await axiosClient.post("/admin/announcements", payload);
      }

      resetForm();
      await load(1);
    } catch (err) {
      setError(getApiError(err, "Failed to save announcement."));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (item) => {
    setError("");

    try {
      await axiosClient.patch(`/admin/announcements/${item.id}/toggle-status`);
      await load(page);
    } catch (err) {
      setError(getApiError(err, "Action failed."));
    }
  };

  const deleteAnnouncement = async (item) => {
    if (!confirm(`Delete announcement "${item.title}"?`)) return;

    setError("");

    try {
      await axiosClient.delete(`/admin/announcements/${item.id}`);
      await load(1);
    } catch (err) {
      setError(getApiError(err, "Delete failed."));
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1 className="page-title">Announcements</h1>
        <p className="page-desc">Post platform updates that appear for every user.</p>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card" style={{ marginBottom: 14 }}>
        <form onSubmit={submit}>
          <div className="field">
            <label className="field-label">Title</label>
            <input
              className="input"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Announcement title"
              required
            />
          </div>

          <div className="field">
            <label className="field-label">Message</label>
            <textarea
              className="textarea"
              value={form.message}
              onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
              placeholder="Write the message users should see"
              required
            />
          </div>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
            />
            Active
          </label>

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving..." : editing ? "Update announcement" : "Post announcement"}
            </button>
            {editing ? (
              <button className="btn btn-secondary" type="button" onClick={resetForm} disabled={saving}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="field" style={{ marginBottom: 0, flex: "1 1 260px" }}>
            <label className="field-label">Search</label>
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title or message"
            />
          </div>

          <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <label className="field-label">Status</label>
            <select className="input" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {announcements.length === 0 ? (
          <div className="card" style={{ color: "var(--color-muted)" }}>
            No announcements found.
          </div>
        ) : (
          announcements.map((item) => (
            <div key={item.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{item.title}</h3>
                  <p style={{ margin: "6px 0 0", color: "var(--color-muted)" }}>{item.message}</p>
                  <small style={{ color: "var(--color-muted)" }}>
                    {formatDate(item.created_at)} by {item.author?.name || "Admin"}
                  </small>
                </div>

                <span className={item.is_active ? "badge badge-success" : "badge badge-default"}>
                  {item.is_active ? "active" : "inactive"}
                </span>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <button className="btn btn-sm btn-secondary" type="button" onClick={() => editAnnouncement(item)}>
                  Edit
                </button>
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => toggleStatus(item)}>
                  {item.is_active ? "Deactivate" : "Activate"}
                </button>
                <button className="btn btn-sm btn-danger" type="button" onClick={() => deleteAnnouncement(item)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
