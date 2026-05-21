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

function getApiError(error, fallback = "Something went wrong.") {
    const data = error?.response?.data;

    if (data?.errors) {
        return Object.values(data.errors).flat().join(" ");
    }

    return data?.message || fallback;
}

function RoleBadge({ isAdmin }) {
    return isAdmin ? (
        <span className="badge badge-accent">admin</span>
    ) : (
        <span className="badge badge-default">user</span>
    );
}

function StatusBadge({ status }) {
    if (status === "active") {
        return <span className="badge badge-success">active</span>;
    }

    return <span className="badge badge-warning">inactive</span>;
}

function Table({ columns, rows, emptyText }) {
    return (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
                <table
                    style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 13,
                    }}
                >
                    <thead>
                        <tr style={{ background: "var(--color-bg)" }}>
                            {columns.map((column) => (
                                <th
                                    key={column}
                                    style={{
                                        textAlign: "left",
                                        padding: "12px 14px",
                                        fontSize: 11.5,
                                        letterSpacing: "0.02em",
                                        color: "var(--color-muted)",
                                        fontWeight: 700,
                                        whiteSpace: "nowrap",
                                        borderBottom:
                                            "1px solid var(--color-border)",
                                    }}
                                >
                                    {column}
                                </th>
                            ))}
                        </tr>
                    </thead>

                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={columns.length}
                                    style={{
                                        padding: 18,
                                        color: "var(--color-muted)",
                                    }}
                                >
                                    {emptyText}
                                </td>
                            </tr>
                        ) : (
                            rows.map((row, rowIndex) => (
                                <tr
                                    key={rowIndex}
                                    style={{
                                        borderBottom:
                                            rowIndex === rows.length - 1
                                                ? "none"
                                                : "1px solid var(--color-border)",
                                    }}
                                >
                                    {row.map((cell, cellIndex) => (
                                        <td
                                            key={cellIndex}
                                            style={{
                                                padding: "12px 14px",
                                                verticalAlign: "top",
                                                whiteSpace: "nowrap",
                                            }}
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

export default function AdminUsersPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const [users, setUsers] = useState([]);
    const [pagination, setPagination] = useState({
        current_page: 1,
        per_page: 10,
        total: 0,
        last_page: 1,
    });

    const [search, setSearch] = useState("");
    const [role, setRole] = useState("all");
    const [status, setStatus] = useState("all");

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState(null);

    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "",
        password_confirmation: "",
        is_admin: false,
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

            if (search.trim()) {
                params.search = search.trim();
            }

            if (role !== "all") {
                params.is_admin = role === "admin" ? 1 : 0;
            }

            if (status !== "all") {
                params.status = status;
            }

            const res = await axiosClient.get("/admin/users", { params });
            const data = res.data?.data || {};

            setUsers(Array.isArray(data.users) ? data.users : []);

            setPagination(
                data.pagination || {
                    current_page: 1,
                    per_page: pagination.per_page,
                    total: 0,
                    last_page: 1,
                }
            );
        } catch (e) {
            console.log("LOAD USERS ERROR:", e.response?.data || e.message);
            setError(getApiError(e, "Failed to load users."));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            load(1);
        }, 350);

        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, role, status, pagination.per_page]);

    const openCreate = () => {
        setError("");
        setEditing(null);

        setForm({
            name: "",
            email: "",
            password: "",
            password_confirmation: "",
            is_admin: false,
            status: "active",
        });

        setFormOpen(true);
    };

    const openEdit = (user) => {
        setError("");
        setEditing(user);

        setForm({
            name: user?.name || "",
            email: user?.email || "",
            password: "",
            password_confirmation: "",
            is_admin: Boolean(user?.is_admin),
            status: user?.status || "active",
        });

        setFormOpen(true);
    };

    const closeForm = () => {
        if (saving) return;

        setFormOpen(false);
        setEditing(null);
        setError("");
    };

    const submit = async (e) => {
        e.preventDefault();

        setSaving(true);
        setError("");

        const payload = {
            name: form.name.trim(),
            email: form.email.trim(),
            is_admin: form.is_admin ? 1 : 0,
            status: form.status,
        };

        if (!payload.name) {
            setError("Name is required.");
            setSaving(false);
            return;
        }

        if (!payload.email) {
            setError("Email is required.");
            setSaving(false);
            return;
        }

        if (!editing || form.password) {
            if (form.password.length < 8) {
                setError("Password must be at least 8 characters.");
                setSaving(false);
                return;
            }

            if (form.password !== form.password_confirmation) {
                setError("Password confirmation does not match.");
                setSaving(false);
                return;
            }

            payload.password = form.password;
            payload.password_confirmation = form.password_confirmation;
        }

        try {
            if (!editing) {
                await axiosClient.post("/admin/users", payload);
            } else {
                await axiosClient.put(`/admin/users/${editing.id}`, payload);
            }

            setFormOpen(false);
            setEditing(null);

            setForm({
                name: "",
                email: "",
                password: "",
                password_confirmation: "",
                is_admin: false,
                status: "active",
            });

            await load(1);
        } catch (e2) {
            console.log("SAVE USER ERROR:", e2.response?.data || e2.message);
            setError(getApiError(e2, "Failed to save user."));
        } finally {
            setSaving(false);
        }
    };

    const onDelete = async (user) => {
        if (!confirm(`Delete user "${user?.name}"?`)) return;

        setError("");

        try {
            await axiosClient.delete(`/admin/users/${user.id}`);
            await load(1);
        } catch (e) {
            console.log("DELETE USER ERROR:", e.response?.data || e.message);
            setError(getApiError(e, "Delete failed."));
        }
    };

    const toggleAdmin = async (user) => {
        setError("");

        try {
            await axiosClient.post(`/admin/users/${user.id}/change-role`, {
                is_admin: user.is_admin ? 0 : 1,
            });

            await load(page);
        } catch (e) {
            console.log("TOGGLE ADMIN ERROR:", e.response?.data || e.message);
            setError(getApiError(e, "Action failed."));
        }
    };

    const toggleStatus = async (user) => {
        setError("");

        try {
            await axiosClient.post(`/admin/users/${user.id}/change-status`, {
                status: user.status === "active" ? "inactive" : "active",
            });

            await load(page);
        } catch (e) {
            console.log("TOGGLE STATUS ERROR:", e.response?.data || e.message);
            setError(getApiError(e, "Action failed."));
        }
    };

    const headerRight = useMemo(
        () => (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => load(page)}
                >
                    Refresh
                </button>

                <button
                    className="btn btn-primary"
                    type="button"
                    onClick={openCreate}
                >
                    Add user
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
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                }}
            >
                <div>
                    <h1 className="page-title">Users</h1>
                    <p className="page-desc">
                        Manage accounts, roles, and status
                    </p>
                </div>

                {headerRight}
            </div>

            {error ? <div className="alert alert-error">{error}</div> : null}

            <div className="card" style={{ marginBottom: 14 }}>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr",
                        gap: 10,
                    }}
                >
                    <div className="field" style={{ marginBottom: 0 }}>
                        <label className="field-label">Search</label>

                        <input
                            className="input"
                            placeholder="Search by name or email"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <div
                            className="field"
                            style={{
                                marginBottom: 0,
                                minWidth: 180,
                                flex: "0 0 auto",
                            }}
                        >
                            <label className="field-label">Role</label>

                            <select
                                className="input"
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                            >
                                <option value="all">All</option>
                                <option value="admin">Admin</option>
                                <option value="user">User</option>
                            </select>
                        </div>

                        <div
                            className="field"
                            style={{
                                marginBottom: 0,
                                minWidth: 180,
                                flex: "0 0 auto",
                            }}
                        >
                            <label className="field-label">Status</label>

                            <select
                                className="input"
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                            >
                                <option value="all">All</option>
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                            </select>
                        </div>

                        <div
                            className="field"
                            style={{
                                marginBottom: 0,
                                minWidth: 180,
                                flex: "0 0 auto",
                            }}
                        >
                            <label className="field-label">Per page</label>

                            <select
                                className="input"
                                value={pagination.per_page}
                                onChange={(e) =>
                                    setPagination((current) => ({
                                        ...current,
                                        per_page:
                                            Number(e.target.value) || 10,
                                    }))
                                }
                            >
                                {[10, 15, 25, 50].map((number) => (
                                    <option key={number} value={number}>
                                        {number}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {formOpen ? (
                <div className="card" style={{ marginBottom: 14 }}>
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 14, fontWeight: 700 }}>
                            {editing ? "Edit user" : "Add user"}
                        </div>

                        <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={closeForm}
                        >
                            Close
                        </button>
                    </div>

                    <form onSubmit={submit} style={{ marginTop: 12 }}>
                        <div className="field">
                            <label className="field-label">Name</label>

                            <input
                                className="input"
                                value={form.name}
                                onChange={(e) =>
                                    setForm((current) => ({
                                        ...current,
                                        name: e.target.value,
                                    }))
                                }
                                required
                            />
                        </div>

                        <div className="field">
                            <label className="field-label">Email</label>

                            <input
                                className="input"
                                type="email"
                                value={form.email}
                                onChange={(e) =>
                                    setForm((current) => ({
                                        ...current,
                                        email: e.target.value,
                                    }))
                                }
                                required
                            />
                        </div>

                        <div
                            style={{
                                display: "flex",
                                gap: 12,
                                flexWrap: "wrap",
                            }}
                        >
                            <div
                                className="field"
                                style={{
                                    marginBottom: 0,
                                    minWidth: 220,
                                    flex: "1 1 240px",
                                }}
                            >
                                <label className="field-label">Role</label>

                                <select
                                    className="input"
                                    value={form.is_admin ? "admin" : "user"}
                                    onChange={(e) =>
                                        setForm((current) => ({
                                            ...current,
                                            is_admin:
                                                e.target.value === "admin",
                                        }))
                                    }
                                >
                                    <option value="user">User</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>

                            <div
                                className="field"
                                style={{
                                    marginBottom: 0,
                                    minWidth: 220,
                                    flex: "1 1 240px",
                                }}
                            >
                                <label className="field-label">Status</label>

                                <select
                                    className="input"
                                    value={form.status}
                                    onChange={(e) =>
                                        setForm((current) => ({
                                            ...current,
                                            status: e.target.value,
                                        }))
                                    }
                                >
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                gap: 12,
                                flexWrap: "wrap",
                                marginTop: 14,
                            }}
                        >
                            <div
                                className="field"
                                style={{
                                    marginBottom: 0,
                                    minWidth: 220,
                                    flex: "1 1 240px",
                                }}
                            >
                                <label className="field-label">
                                    Password{" "}
                                    {editing ? "(leave blank to keep)" : ""}
                                </label>

                                <input
                                    className="input"
                                    type="password"
                                    value={form.password}
                                    onChange={(e) =>
                                        setForm((current) => ({
                                            ...current,
                                            password: e.target.value,
                                        }))
                                    }
                                    required={!editing}
                                />
                            </div>

                            <div
                                className="field"
                                style={{
                                    marginBottom: 0,
                                    minWidth: 220,
                                    flex: "1 1 240px",
                                }}
                            >
                                <label className="field-label">
                                    Confirm password
                                </label>

                                <input
                                    className="input"
                                    type="password"
                                    value={form.password_confirmation}
                                    onChange={(e) =>
                                        setForm((current) => ({
                                            ...current,
                                            password_confirmation:
                                                e.target.value,
                                        }))
                                    }
                                    required={!editing}
                                />
                            </div>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                gap: 10,
                                marginTop: 16,
                                flexWrap: "wrap",
                            }}
                        >
                            <button
                                className="btn btn-primary"
                                type="submit"
                                disabled={saving}
                            >
                                {saving ? "Saving..." : "Save"}
                            </button>

                            <button
                                className="btn btn-secondary"
                                type="button"
                                onClick={closeForm}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}

            <Table
                columns={[
                    "Name",
                    "Email",
                    "Role",
                    "Status",
                    "Created",
                    "Actions",
                ]}
                emptyText="No users found."
                rows={users.map((user) => [
                    <div
                        key={`${user.id}-name`}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <div style={{ fontWeight: 600 }}>{user.name}</div>
                    </div>,

                    user.email,

                    <RoleBadge
                        key={`${user.id}-role`}
                        isAdmin={Boolean(user.is_admin)}
                    />,

                    <StatusBadge
                        key={`${user.id}-status`}
                        status={user.status}
                    />,

                    formatDate(user.created_at),

                    <div
                        key={`${user.id}-actions`}
                        style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                        }}
                    >
                        <button
                            className="btn btn-sm btn-secondary"
                            type="button"
                            onClick={() => openEdit(user)}
                        >
                            Edit
                        </button>

                        <button
                            className="btn btn-sm btn-ghost"
                            type="button"
                            onClick={() => toggleAdmin(user)}
                        >
                            {user.is_admin ? "Remove admin" : "Make admin"}
                        </button>

                        <button
                            className="btn btn-sm btn-ghost"
                            type="button"
                            onClick={() => toggleStatus(user)}
                        >
                            {user.status === "active"
                                ? "Deactivate"
                                : "Activate"}
                        </button>

                        <button
                            className="btn btn-sm btn-danger"
                            type="button"
                            onClick={() => onDelete(user)}
                        >
                            Delete
                        </button>
                    </div>,
                ])}
            />

            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    marginTop: 12,
                }}
            >
                <div style={{ fontSize: 13, color: "var(--color-muted)" }}>
                    Page {pagination.current_page} of {pagination.last_page} ·{" "}
                    {pagination.total} total
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
                        disabled={
                            pagination.current_page >= pagination.last_page
                        }
                        onClick={() => load(pagination.current_page + 1)}
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}