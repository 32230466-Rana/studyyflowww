import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { PageSpinner } from "../components/Spinner.jsx";

function formatDate(value) {
    if (!value) return "";
    try {
        return new Date(value).toLocaleDateString();
    } catch {
        return String(value);
    }
}

function truncate(text, max = 120) {
    const value = String(text || "").trim();
    if (!value) return "-";
    return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function FeaturedBadge({ featured }) {
    return featured ? (
        <span className="badge badge-accent">featured</span>
    ) : (
        <span className="badge badge-default">normal</span>
    );
}

function StatusBadge({ status }) {
    if (status === "inactive") {
        return <span className="badge badge-danger">inactive</span>;
    }

    if (status === "failed") {
        return <span className="badge badge-warning">failed</span>;
    }

    return <span className="badge badge-success">{status || "active"}</span>;
}

function Table({ columns, rows, emptyText }) {
    return (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                        <tr style={{ background: "var(--color-bg)" }}>
                            {columns.map((c) => (
                                <th
                                    key={c}
                                    style={{
                                        textAlign: "left",
                                        padding: "12px 14px",
                                        fontSize: 11.5,
                                        letterSpacing: "0.02em",
                                        color: "var(--color-muted)",
                                        fontWeight: 700,
                                        whiteSpace: "nowrap",
                                        borderBottom: "1px solid var(--color-border)",
                                    }}
                                >
                                    {c}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} style={{ padding: 18, color: "var(--color-muted)" }}>
                                    {emptyText}
                                </td>
                            </tr>
                        ) : (
                            rows.map((r, idx) => (
                                <tr
                                    key={idx}
                                    style={{
                                        borderBottom:
                                            idx === rows.length - 1
                                                ? "none"
                                                : "1px solid var(--color-border)",
                                    }}
                                >
                                    {r.map((cell, j) => (
                                        <td
                                            key={j}
                                            style={{ padding: "12px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}
                                        >
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function AdminNotesPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const [notes, setNotes] = useState([]);
    const [pagination, setPagination] = useState({
        current_page: 1,
        per_page: 10,
        total: 0,
        last_page: 1,
    });

    const [search, setSearch] = useState("");
    const [featured, setFeatured] = useState("all");
    const [status, setStatus] = useState("all");
    const [summaryFilter, setSummaryFilter] = useState("all");

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({
        title: "",
        description: "",
        source_type: "",
        status: "active",
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
            if (featured !== "all") params.is_featured = featured === "featured";
            if (status !== "all") params.status = status;
            if (summaryFilter !== "all") params.has_summary = summaryFilter === "with_summary";

            const res = await axiosClient.get("/admin/notes", { params });
            const data = res.data?.data || {};

            setNotes(Array.isArray(data.notes) ? data.notes : []);
            setPagination(data.pagination || pagination);
        } catch (e) {
            setError(e?.response?.data?.message || "Failed to load notes.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const id = setTimeout(() => {
            load(1);
        }, 350);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, featured, status, summaryFilter, pagination.per_page]);

    const openEdit = (n) => {
        setError("");
        setEditing(n);
        setForm({
            title: n?.title || "",
            description: n?.description || "",
            source_type: n?.source_type || "",
            status: n?.status || "active",
        });
        setFormOpen(true);
    };

    const closeForm = () => {
        if (saving) return;
        setFormOpen(false);
        setEditing(null);
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!editing?.id) return;
        setSaving(true);
        setError("");
        try {
            await axiosClient.put(`/admin/notes/${editing.id}`, {
                title: form.title,
                description: form.description,
                source_type: form.source_type || null,
                status: form.status,
            });

            setFormOpen(false);
            setEditing(null);
            await load(page);
        } catch (e2) {
            setError(e2?.response?.data?.message || "Failed to save note.");
        } finally {
            setSaving(false);
        }
    };

    const onDelete = async (n) => {
        if (!confirm(`Delete note "${n?.title}"?`)) return;
        setError("");
        try {
            await axiosClient.delete(`/admin/notes/${n.id}`);
            await load(1);
        } catch (e) {
            setError(e?.response?.data?.message || "Delete failed.");
        }
    };

    const toggleFeatured = async (n) => {
        setError("");
        try {
            await axiosClient.patch(`/admin/notes/${n.id}/toggle-featured`);
            await load(page);
        } catch (e) {
            setError(e?.response?.data?.message || "Action failed.");
        }
    };

    const toggleStatus = async (n) => {
        setError("");
        try {
            await axiosClient.patch(`/admin/notes/${n.id}/toggle-status`);
            await load(page);
        } catch (e) {
            setError(e?.response?.data?.message || "Action failed.");
        }
    };

    const headerRight = useMemo(
        () => (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn-secondary" type="button" onClick={() => load(page)}>
                    Refresh
                </button>
            </div>
        ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [page]
    );

    if (loading) return <PageSpinner />;

    return (
        <div className="page-enter">
            <div
                className="page-header"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
            >
                <div>
                    <h1 className="page-title">Notes</h1>
                    <p className="page-desc">Manage and feature notes across the platform</p>
                </div>
                {headerRight}
            </div>

            {error ? <div className="alert alert-error">{error}</div> : null}

            <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                        <label className="field-label">Search</label>
                        <input
                            className="input"
                            placeholder="Search by title"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: "0 0 auto" }}>
                            <label className="field-label">Featured</label>
                            <select className="input" value={featured} onChange={(e) => setFeatured(e.target.value)}>
                                <option value="all">All</option>
                                <option value="featured">Featured</option>
                                <option value="not_featured">Not featured</option>
                            </select>
                        </div>

                        <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: "0 0 auto" }}>
                            <label className="field-label">Status</label>
                            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                                <option value="all">All</option>
                                <option value="uploaded">Uploaded</option>
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                                <option value="processing">Processing</option>
                                <option value="failed">Failed</option>
                            </select>
                        </div>

                        <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: "0 0 auto" }}>
                            <label className="field-label">Summary</label>
                            <select
                                className="input"
                                value={summaryFilter}
                                onChange={(e) => setSummaryFilter(e.target.value)}
                            >
                                <option value="all">All</option>
                                <option value="with_summary">With summary</option>
                                <option value="without_summary">Without summary</option>
                            </select>
                        </div>

                        <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: "0 0 auto" }}>
                            <label className="field-label">Per page</label>
                            <select
                                className="input"
                                value={pagination.per_page}
                                onChange={(e) =>
                                    setPagination((p) => ({ ...p, per_page: Number(e.target.value) || 10 }))
                                }
                            >
                                {[10, 15, 25, 50].map((n) => (
                                    <option key={n} value={n}>
                                        {n}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {formOpen ? (
                <div className="card" style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>Edit note</div>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={closeForm}>
                            Close
                        </button>
                    </div>

                    <form onSubmit={submit} style={{ marginTop: 12 }}>
                        <div className="field">
                            <label className="field-label">Title</label>
                            <input
                                className="input"
                                value={form.title}
                                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                                required
                            />
                        </div>

                        <div className="field">
                            <label className="field-label">Description</label>
                            <textarea
                                className="textarea"
                                value={form.description}
                                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                placeholder="Optional"
                            />
                        </div>

                        <div className="field">
                            <label className="field-label">Source type</label>
                            <input
                                className="input"
                                value={form.source_type}
                                onChange={(e) => setForm((f) => ({ ...f, source_type: e.target.value }))}
                                placeholder="pdf / text / ..."
                            />
                        </div>

                        <div className="field">
                            <label className="field-label">Status</label>
                            <select
                                className="input"
                                value={form.status}
                                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                            >
                                <option value="uploaded">Uploaded</option>
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                                <option value="processing">Processing</option>
                                <option value="failed">Failed</option>
                            </select>
                        </div>

                        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                            <button className="btn btn-primary" type="submit" disabled={saving}>
                                {saving ? "Saving..." : "Save"}
                            </button>
                            <button className="btn btn-secondary" type="button" onClick={closeForm} disabled={saving}>
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}

            <Table
                columns={["Title", "User", "Source", "Status", "Featured", "Summary", "Created", "Actions"]}
                emptyText="No notes found."
                rows={notes.map((n) => [
                    <div key={n.id} style={{ display: "flex", flexDirection: "column", minWidth: 220 }}>
                        <div style={{ fontWeight: 600, whiteSpace: "normal" }}>{n.title}</div>
                    </div>,
                    n.user?.name || "-",
                    n.source_type || "-",
                    <StatusBadge status={n.status} />,
                    <FeaturedBadge featured={!!n.is_featured} />,
                    <div key={`${n.id}-summary`} style={{ minWidth: 260, maxWidth: 380, whiteSpace: "normal" }}>
                        <div style={{ fontWeight: 600 }}>
                            {n.has_summary ? `${n.summary_words_count || 0} words` : "No summary"}
                        </div>
                        <div style={{ color: "var(--color-muted)" }}>{truncate(n.summary)}</div>
                    </div>,
                    formatDate(n.created_at),
                    <div key={`${n.id}-actions`} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn btn-sm btn-secondary" type="button" onClick={() => openEdit(n)}>
                            Edit
                        </button>
                        <button className="btn btn-sm btn-ghost" type="button" onClick={() => toggleFeatured(n)}>
                            {n.is_featured ? "Unfeature" : "Feature"}
                        </button>
                        <button className="btn btn-sm btn-ghost" type="button" onClick={() => toggleStatus(n)}>
                            {n.status === "inactive" ? "Activate" : "Deactivate"}
                        </button>
                        <button className="btn btn-sm btn-danger" type="button" onClick={() => onDelete(n)}>
                            Delete
                        </button>
                    </div>,
                ])}
            />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12 }}>
                <div style={{ fontSize: 13, color: "var(--color-muted)" }}>
                    Page {pagination.current_page} of {pagination.last_page} · {pagination.total} total
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                    <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        disabled={pagination.current_page <= 1}
                        onClick={() => load(pagination.current_page - 1)}
                    >
                        Prev
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        disabled={pagination.current_page >= pagination.last_page}
                        onClick={() => load(pagination.current_page + 1)}
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}
