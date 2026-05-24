import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../auth/AuthContext.jsx";
import { PageSpinner } from "../components/Spinner.jsx";

const emptyDashboard = {
  stats: {},
  charts: {
    range: { labels: [] },
    user_growth: [],
    notes_growth: [],
    ai_usage: [],
    quiz_growth: [],
    summary_growth: [],
  },
  recent_users: [],
  recent_notes: [],
  recent_quizzes: [],
  recent_summaries: [],
  recent_activity: [],
  system_health: [],
};

const defaultFilters = {
  search: "",
  role: "all",
  status: "all",
  activity: "all",
};

const defaultNoteFilters = {
  search: "",
  featured: "all",
  status: "all",
  summary: "all",
};

function getPayload(response) {
  return response?.data?.data || response?.data || {};
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString() : "—";
  }

  const parsed = Number(value);

  if (String(value).trim() !== "" && Number.isFinite(parsed)) {
    return parsed.toLocaleString();
  }

  return String(value);
}

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString();
}

function sum(values = []) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function badgeClass(type) {
  if (["online", "active", "success", "admin"].includes(type)) {
    return "badge badge-success";
  }

  if (["offline", "inactive", "error", "danger"].includes(type)) {
    return "badge badge-danger";
  }

  if (["warning", "pending", "unknown"].includes(type)) {
    return "badge badge-warning";
  }

  if (["connected", "ready", "info", "user"].includes(type)) {
    return "badge badge-info";
  }

  return "badge badge-default";
}

function StatusBadge({ type, children }) {
  return <span className={badgeClass(type)}>{children}</span>;
}

function SectionHeader({ title, subtitle, actions }) {
  return (
    <div className="admin-section-head">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>

      {actions ? <div className="admin-section-actions">{actions}</div> : null}
    </div>
  );
}

function StatCard({ icon, title, value, subtitle, tone = "blue", hint }) {
  return (
    <div className={`admin-stat-card ${tone}`}>
      <div className="admin-stat-icon">{icon}</div>

      <div className="admin-stat-copy">
        <strong>{formatValue(value)}</strong>
        <p>{title}</p>
        {subtitle ? <span>{subtitle}</span> : null}
        {hint ? <small>{hint}</small> : null}
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, values = [], mode = "line" }) {
  const safeValues = values.length > 0 ? values : [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(...safeValues.map((value) => Number(value || 0)), 1);
  const width = 520;
  const height = 170;
  const step = safeValues.length > 1 ? (width - 50) / (safeValues.length - 1) : 0;

  const points = safeValues
    .map((value, index) => {
      const x = 25 + index * step;
      const y = height - 26 - (Number(value || 0) / max) * 90;

      return { x, y, value };
    })
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  return (
    <div className="admin-chart-card">
      <div className="admin-chart-meta">
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>

      {mode === "bar" ? (
        <div className="admin-bar-chart">
          {safeValues.map((value, index) => {
            const barHeight = Math.max(12, (Number(value || 0) / max) * 100);

            return (
              <div key={`${title}-${index}`} className="admin-bar-item">
                <strong>{formatValue(value)}</strong>
                <span style={{ height: `${barHeight}%` }} />
              </div>
            );
          })}
        </div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="admin-line-chart" preserveAspectRatio="none">
          <polyline points={points} fill="none" strokeWidth="5" />

          {safeValues.map((value, index) => {
            const x = 25 + index * step;
            const y = height - 26 - (Number(value || 0) / max) * 90;

            return (
              <g key={`${title}-${index}`}>
                <circle cx={x} cy={y} r="5" />
                <text
                  x={x}
                  y={Math.max(18, y - 10)}
                  textAnchor="middle"
                  fontSize="16"
                  fontWeight="800"
                  fill="#0f172a"
                >
                  {formatValue(value)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function Table({ columns, rows, emptyText }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="admin-empty-cell">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ActivityItem({ item }) {
  return (
    <div className="admin-activity-item">
      <div className="admin-activity-icon">{item.icon || "•"}</div>

      <div className="admin-activity-copy">
        <div className="admin-activity-title-row">
          <strong>{item.user_name || "System"}</strong>
          <StatusBadge type={item.statusType || "unknown"}>{item.action}</StatusBadge>
        </div>

        <p>{item.email || "—"}</p>
        <small>{formatDateTime(item.created_at)}</small>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);
  const [dashboardError, setDashboardError] = useState("");

  const [rangeDays, setRangeDays] = useState(7);

  const [users, setUsers] = useState([]);
  const [activeAdmins, setActiveAdmins] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [userFilters, setUserFilters] = useState(defaultFilters);

  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState("");
  const [noteFilters, setNoteFilters] = useState(defaultNoteFilters);

  const [feedback, setFeedback] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackSearch, setFeedbackSearch] = useState("");

  const [announcements, setAnnouncements] = useState([]);
  const [announcementSearch, setAnnouncementSearch] = useState("");

  const [health, setHealth] = useState({
    aiTutor: null,
    localAi: null,
  });

  const [notice, setNotice] = useState("");
  const noticeTimer = useRef(null);

  const [rangeFilter, setRangeFilter] = useState("last7");
  const [customDate, setCustomDate] = useState("");

  const showNotice = (message) => {
    setNotice(message);

    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }

    noticeTimer.current = setTimeout(() => {
      setNotice("");
    }, 4000);
  };

  useEffect(() => {
    return () => {
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  const loadDashboard = async (days = rangeDays) => {
    const initialLoad = loadingDashboard;

    if (initialLoad) {
      setLoadingDashboard(true);
    } else {
      setRefreshingDashboard(true);
    }

    setDashboardError("");

    try {
      const response = await axiosClient.get("/admin/dashboard", {
        params: { days },
      });

      setDashboard(getPayload(response));
    } catch (error) {
      setDashboard(emptyDashboard);
      setDashboardError(
        error?.response?.data?.message || "Dashboard data could not be loaded."
      );
    } finally {
      setLoadingDashboard(false);
      setRefreshingDashboard(false);
    }
  };

  const loadUsers = async (filters = userFilters) => {
    setUsersLoading(true);
    setUsersError("");

    try {
      const params = { per_page: 100 };

      if (filters.search.trim()) {
        params.search = filters.search.trim();
      }

      if (filters.role !== "all") {
        params.is_admin = filters.role === "admin" ? 1 : 0;
      }

      if (filters.status !== "all") {
        params.status = filters.status;
      }

      if (filters.activity && filters.activity !== "all") {
        params.activity = filters.activity;
      }

      params.sort = "last_seen_at";

      const response = await axiosClient.get("/admin/users", { params });
      const payload = getPayload(response);

      setUsers(normalizeList(payload.users));
    } catch (error) {
      setUsers([]);
      setUsersError(
        error?.response?.data?.message || "Failed to load users."
      );
    } finally {
      setUsersLoading(false);
    }
  };

  const loadActiveAdmins = async () => {
    try {
      const response = await axiosClient.get("/admin/users", {
        params: {
          is_admin: 1,
          status: "active",
          per_page: 100,
        },
      });

      const payload = getPayload(response);
      setActiveAdmins(normalizeList(payload.users));
    } catch {
      setActiveAdmins([]);
    }
  };

  const loadNotes = async (filters = noteFilters) => {
    setNotesLoading(true);
    setNotesError("");

    try {
      const params = { per_page: 100 };

      if (filters.search.trim()) {
        params.search = filters.search.trim();
      }

      if (filters.featured !== "all") {
        params.is_featured = filters.featured === "featured" ? 1 : 0;
      }

      if (filters.status !== "all") {
        params.status = filters.status;
      }

      if (filters.summary !== "all") {
        params.has_summary = filters.summary === "with_summary" ? 1 : 0;
      }

      const response = await axiosClient.get("/admin/notes", { params });
      const payload = getPayload(response);

      setNotes(normalizeList(payload.notes));
    } catch (error) {
      setNotes([]);
      setNotesError(
        error?.response?.data?.message || "Failed to load notes."
      );
    } finally {
      setNotesLoading(false);
    }
  };

  const loadFeedback = async () => {
    setFeedbackLoading(true);
    setFeedbackError("");

    try {
      const response = await axiosClient.get("/admin/feedback", {
        params: { per_page: 20 },
      });

      const payload = getPayload(response);
      const list = Array.isArray(payload) ? payload : payload.feedback || payload.items || [];

      setFeedback(list);
    } catch (error) {
      setFeedback([]);
      setFeedbackError(
        error?.response?.data?.message || "Failed to load feedback."
      );
    } finally {
      setFeedbackLoading(false);
    }
  };

  const loadHealth = async () => {
    const [aiTutorResult, localAiResult] = await Promise.allSettled([
      axiosClient.get("/ai-tutor/health"),
      axiosClient.get("/local-ai/health"),
    ]);

    setHealth({
      aiTutor:
        aiTutorResult.status === "fulfilled"
          ? getPayload(aiTutorResult.value)
          : { message: "AI Tutor service is not reachable." },
      localAi:
        localAiResult.status === "fulfilled"
          ? getPayload(localAiResult.value)
          : { success: false, message: "Summary service is not reachable." },
    });
  };

  const loadAnnouncements = async () => {
    try {
      const response = await axiosClient.get("/admin/announcements", {
        params: { per_page: 20 },
      });
      const payload = getPayload(response);
      setAnnouncements(normalizeList(payload.announcements));
    } catch {
      setAnnouncements([]);
    }
  };

  useEffect(() => {
    loadDashboard(rangeDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeDays]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers(userFilters);
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFilters.search, userFilters.role, userFilters.status, userFilters.activity]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadNotes(noteFilters);
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteFilters.search, noteFilters.featured, noteFilters.status, noteFilters.summary]);

  useEffect(() => {
    loadUsers(userFilters);
    loadNotes(noteFilters);
    loadFeedback();
    loadHealth();
    loadAnnouncements();
    loadActiveAdmins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = async () => {
    await Promise.allSettled([
      loadDashboard(rangeDays),
      loadUsers(userFilters),
      loadNotes(noteFilters),
      loadFeedback(),
      loadHealth(),
      loadAnnouncements(),
      loadActiveAdmins(),
    ]);
  };

  const toggleUserRole = async (userRecord) => {
    try {
      await axiosClient.patch(`/admin/users/${userRecord.id}/toggle-admin`);
      showNotice(
        userRecord.is_admin
          ? `${userRecord.name} downgraded to user.`
          : `${userRecord.name} promoted to admin.`
      );

      await Promise.allSettled([
        loadUsers(userFilters),
        loadActiveAdmins(),
        loadDashboard(rangeDays),
      ]);
    } catch (error) {
      showNotice(error?.response?.data?.message || "Role change failed.");
    }
  };

  const toggleUserStatus = async (userRecord) => {
    try {
      await axiosClient.patch(`/admin/users/${userRecord.id}/toggle-status`);
      showNotice(
        userRecord.status === "active"
          ? `${userRecord.name} deactivated.`
          : `${userRecord.name} activated.`
      );

      await Promise.allSettled([
        loadUsers(userFilters),
        loadActiveAdmins(),
        loadDashboard(rangeDays),
      ]);
    } catch (error) {
      showNotice(error?.response?.data?.message || "Status change failed.");
    }
  };

  const deleteUser = async (userRecord) => {
    if (!window.confirm(`Delete user ${userRecord.name}?`)) {
      return;
    }

    try {
      await axiosClient.delete(`/admin/users/${userRecord.id}`);
      showNotice(`${userRecord.name} deleted.`);

      await Promise.allSettled([
        loadUsers(userFilters),
        loadActiveAdmins(),
        loadDashboard(rangeDays),
      ]);
    } catch (error) {
      showNotice(error?.response?.data?.message || "Delete failed.");
    }
  };

  const deleteNote = async (noteRecord) => {
    if (!window.confirm(`Delete note ${noteRecord.title}?`)) {
      return;
    }

    try {
      await axiosClient.delete(`/admin/notes/${noteRecord.id}`);
      showNotice(`${noteRecord.title} deleted.`);

      await Promise.allSettled([loadNotes(noteFilters), loadDashboard(rangeDays)]);
    } catch (error) {
      showNotice(error?.response?.data?.message || "Delete failed.");
    }
  };

  const toggleNoteFeatured = async (noteRecord) => {
    try {
      await axiosClient.patch(`/admin/notes/${noteRecord.id}/toggle-featured`);
      showNotice(
        noteRecord.is_featured
          ? `${noteRecord.title} unfeatured.`
          : `${noteRecord.title} highlighted.`
      );

      await Promise.allSettled([loadNotes(noteFilters), loadDashboard(rangeDays)]);
    } catch (error) {
      showNotice(error?.response?.data?.message || "Action failed.");
    }
  };

  const toggleNoteStatus = async (noteRecord) => {
    try {
      await axiosClient.patch(`/admin/notes/${noteRecord.id}/toggle-status`);
      showNotice(
        noteRecord.status === "inactive"
          ? `${noteRecord.title} activated.`
          : `${noteRecord.title} deactivated.`
      );

      await Promise.allSettled([loadNotes(noteFilters), loadDashboard(rangeDays)]);
    } catch (error) {
      showNotice(error?.response?.data?.message || "Action failed.");
    }
  };

  const dashboardStats = dashboard.stats || {};
  const chartRange = dashboard.charts?.range?.labels || [];
  const weekUsers = sum(dashboard.charts?.user_growth || []);
  const weekNotes = sum(dashboard.charts?.notes_growth || []);
  const weekAi = sum(dashboard.charts?.ai_usage || []);
  const weekQuizzes = sum(dashboard.charts?.quiz_growth || []);
  const weekSummaries = sum(dashboard.charts?.summary_growth || []);

  const activeAdminsCount = activeAdmins.length || dashboardStats.total_admins || 0;
  const feedbackCount = dashboardStats.feedback_count ?? feedback.length;
  const reportsCount = dashboardStats.reports_count ?? null;

  const lastAdminLoginAlert = user?.is_admin
    ? `${user?.name || "Admin"} logged in as Admin`
    : "";

  const healthRows = useMemo(() => {
    const dashboardHealth = normalizeList(dashboard.system_health);

    return [
      {
        name: "Laravel API",
        status: "Online",
        type: "online",
        detail: dashboardHealth.find((item) => item.name === "Laravel API")?.status || "Healthy",
      },
      {
        name: "Admin Dashboard API",
        status: "Online",
        type: "online",
        detail:
          dashboardHealth.find((item) => item.name === "Admin Dashboard API")?.status ||
          "Healthy",
      },
      {
        name: "Summary Service",
        status:
          dashboardHealth.find((item) => item.name === "Summary Service")?.status ||
          (health.localAi?.success ? "Connected" : "Offline"),
        type: health.localAi?.success ? "connected" : "warning",
        detail: health.localAi?.message || "Local summary service status.",
      },
      {
        name: "AI Tutor",
        status: health.aiTutor?.ok ? "Online" : "Offline",
        type: health.aiTutor?.ok ? "online" : "danger",
        detail: health.aiTutor?.called_url || "AI Tutor health endpoint not available.",
      },
      {
        name: "AskPDF",
        status: "Not exposed",
        type: "warning",
        detail: "No direct health endpoint is exposed by the current backend.",
      },
      {
        name: "Current AI Model",
        status:
          dashboardHealth.find((item) => item.name === "Current AI Model")?.status ||
          "Local Ollama",
        type: "info",
        detail: "Active model shown by the dashboard API.",
      },
    ];
  }, [dashboard.system_health, health.aiTutor, health.localAi]);

  const userRows = users.map((record) => {
    const roleType = record.is_admin ? "admin" : "user";
    const statusType = record.status === "active" ? "active" : "inactive";

    return [
      <div key={`name-${record.id}`} className="admin-user-name-cell">
        <strong>{record.name || "—"}</strong>
        <span>{record.is_admin ? "Admin badge enabled" : "Normal user"}</span>
      </div>,
      <span key={`email-${record.id}`}>{record.email || "—"}</span>,
      <StatusBadge key={`role-${record.id}`} type={roleType}>
        {record.is_admin ? "admin" : "user"}
      </StatusBadge>,
      <StatusBadge key={`status-${record.id}`} type={statusType}>
        {record.status || "inactive"}
      </StatusBadge>,
      <StatusBadge key={`activity-${record.id}`} type={record.is_online ? "online" : "offline"}>
        {record.is_online ? "online" : "offline"}
      </StatusBadge>,
      <span key={`login-${record.id}`}>{formatDateTime(record.last_login_at)}</span>,
      <span key={`seen-${record.id}`}>{formatDateTime(record.last_seen_at)}</span>,
      <span key={`created-${record.id}`}>{formatDate(record.created_at)}</span>,
      <div key={`actions-${record.id}`} className="admin-row-actions">
        <button type="button" onClick={() => toggleUserRole(record)}>
          {record.is_admin ? "Make user" : "Make admin"}
        </button>
        <button type="button" onClick={() => toggleUserStatus(record)}>
          {record.status === "active" ? "Deactivate" : "Activate"}
        </button>
        <button type="button" className="danger" onClick={() => deleteUser(record)}>
          Delete
        </button>
      </div>,
    ];
  });

  const noteRows = notes.map((record) => {
    return [
      <div key={`note-${record.id}`} className="admin-user-name-cell">
        <strong>{record.title || "—"}</strong>
        <span>{record.description ? record.description.slice(0, 80) : "No description available"}</span>
      </div>,
      <span key={`note-user-${record.id}`}>
        {record.user?.name || record.user_name || "—"}
      </span>,
      <StatusBadge key={`note-featured-${record.id}`} type={record.is_featured ? "active" : "unknown"}>
        {record.is_featured ? "featured" : "normal"}
      </StatusBadge>,
      <StatusBadge key={`note-status-${record.id}`} type={record.status === "inactive" ? "inactive" : "active"}>
        {record.status || "active"}
      </StatusBadge>,
      <div key={`note-summary-${record.id}`} className="admin-user-name-cell">
        <strong>{record.has_summary ? `${record.summary_words_count || 0} words` : "No summary"}</strong>
        <span>{record.summary ? String(record.summary).slice(0, 90) : "No summary generated yet"}</span>
      </div>,
      <span key={`note-created-${record.id}`}>{formatDate(record.created_at)}</span>,
      <div key={`note-actions-${record.id}`} className="admin-row-actions">
        <button type="button" onClick={() => navigate(`/notes/${record.id}`)}>
          View
        </button>
        <button type="button" onClick={() => toggleNoteFeatured(record)}>
          {record.is_featured ? "Unfeature" : "Highlight"}
        </button>
        <button type="button" onClick={() => toggleNoteStatus(record)}>
          {record.status === "inactive" ? "Activate" : "Deactivate"}
        </button>
        <button type="button" className="danger" onClick={() => deleteNote(record)}>
          Delete
        </button>
      </div>,
    ];
  });

  const announcementsFiltered = announcements.filter((item) => {
    const query = announcementSearch.trim().toLowerCase();

    if (!query) return true;

    return (
      String(item.title || "").toLowerCase().includes(query) ||
      String(item.message || "").toLowerCase().includes(query)
    );
  });

  const feedbackFiltered = feedback.filter((item) => {
    const query = feedbackSearch.trim().toLowerCase();

    if (!query) return true;

    return (
      String(item.name || item.user_name || "").toLowerCase().includes(query) ||
      String(item.email || "").toLowerCase().includes(query) ||
      String(item.message || item.feedback || item.content || "").toLowerCase().includes(query)
    );
  });

  const activityItems = useMemo(() => {
    const currentLogin = user?.is_admin
      ? [
          {
            id: "current-admin-login",
            user_name: user?.name || "Admin",
            email: user?.email || "—",
            action: "Admin login",
            created_at: new Date().toISOString(),
            statusType: "admin",
            icon: "🛡️",
          },
        ]
      : [];

    const fromDashboardActivity = normalizeList(dashboard.recent_activity).map((item, index) => ({
      id: `dashboard-activity-${item.id || index}`,
      user_name: item.user_name || "System",
      email: item.email || "—",
      action: item.title || item.action || "System activity",
      created_at: item.created_at,
      statusType: item.statusType || "info",
      icon: item.icon || "•",
    }));

    const fromUsers = normalizeList(dashboard.recent_users).map((item, index) => ({
      id: `user-${item.id || index}`,
      user_name: item.name || "User",
      email: item.email || "—",
      action: item.is_admin ? "Admin user registered" : "New user registered",
      created_at: item.created_at,
      statusType: item.is_admin ? "admin" : item.status === "inactive" ? "inactive" : "active",
      icon: item.is_admin ? "🛡️" : "👤",
    }));

    const fromNotes = normalizeList(dashboard.recent_notes).map((item, index) => ({
      id: `note-${item.id || index}`,
      user_name: item.user?.name || item.user_name || "User",
      email: item.user?.email || "—",
      action: item.is_featured ? "Featured note uploaded" : "New note uploaded",
      created_at: item.created_at,
      statusType: item.is_featured ? "active" : "info",
      icon: item.is_featured ? "⭐" : "📄",
    }));

    const fromQuizzes = normalizeList(dashboard.recent_quizzes).map((item, index) => ({
      id: `quiz-${item.id || index}`,
      user_name: item.user_name || item.user?.name || "User",
      email: item.user?.email || "—",
      action: "Quiz generated",
      created_at: item.created_at,
      statusType: "info",
      icon: "📝",
    }));

    const fromSummaries = normalizeList(dashboard.recent_summaries).map((item, index) => ({
      id: `summary-${item.id || index}`,
      user_name: item.user_name || item.user?.name || "User",
      email: item.user?.email || "—",
      action: "Summary generated",
      created_at: item.created_at,
      statusType: "connected",
      icon: "🤖",
    }));

    const fromFeedback = feedbackFiltered.map((item, index) => ({
      id: `feedback-${item.id || index}`,
      user_name: item.name || item.user_name || "Feedback user",
      email: item.email || "—",
      action: "Feedback submitted",
      created_at: item.created_at,
      statusType: "warning",
      icon: "💬",
    }));

    return [...currentLogin, ...fromDashboardActivity, ...fromUsers, ...fromNotes, ...fromQuizzes, ...fromSummaries, ...fromFeedback]
      .filter((item) => item.created_at)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [dashboard.recent_activity, dashboard.recent_notes, dashboard.recent_quizzes, dashboard.recent_summaries, dashboard.recent_users, feedbackFiltered, user]);

  const activityFiltered = useMemo(() => {
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const sevenDaysStart = new Date(todayStart);
    sevenDaysStart.setDate(sevenDaysStart.getDate() - 6);

    return activityItems.filter((item) => {
      const date = new Date(item.created_at);

      if (Number.isNaN(date.getTime())) {
        return false;
      }

      if (rangeFilter === "today") {
        return date >= todayStart;
      }

      if (rangeFilter === "yesterday") {
        return date >= yesterdayStart && date < todayStart;
      }

      if (rangeFilter === "custom") {
        if (!customDate) return true;

        const itemDate = new Date(item.created_at);
        const selectedDate = new Date(customDate);

        if (Number.isNaN(itemDate.getTime()) || Number.isNaN(selectedDate.getTime())) {
          return false;
        }

        return itemDate.toDateString() === selectedDate.toDateString();
      }

      return date >= sevenDaysStart;
    });
  }, [activityItems, customDate, rangeFilter]);

  const todayActivityCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return activityItems.filter((item) => {
      const date = new Date(item.created_at);
      return !Number.isNaN(date.getTime()) && date >= today;
    }).length;
  }, [activityItems]);

  const adminLoginNotice = lastAdminLoginAlert || null;

  if (loadingDashboard) {
    return <PageSpinner />;
  }

  return (
    <div className="admin-dashboard-page">
      <style>{`
        .admin-dashboard-page {
          min-height: 100%;
          padding: 24px;
          color: #172033;
          background:
            radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 30%),
            linear-gradient(180deg, #f7fbff 0%, #eef6ff 100%);
        }

        .admin-shell {
          width: 100%;
          max-width: none;
          margin: 0;
          display: grid;
          gap: 18px;
        }

        .admin-topbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }

        .admin-kicker {
          margin: 0 0 4px;
          color: #64748b;
          font-size: 14px;
          font-weight: 700;
        }

        .admin-topbar h1 {
          margin: 0;
          color: #0f172a;
          font-size: clamp(28px, 4vw, 40px);
          font-weight: 950;
          letter-spacing: -0.03em;
        }

        .admin-topbar p {
          margin: 8px 0 0;
          color: #475569;
          line-height: 1.6;
          font-weight: 650;
          max-width: 860px;
        }

        .admin-topbar-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .admin-topbar-actions button,
        .admin-filter-group button,
        .admin-row-actions button,
        .admin-inline-btn,
        .admin-action-btn {
          border: 0;
          border-radius: 14px;
          padding: 11px 14px;
          font-weight: 800;
          cursor: pointer;
          transition: 0.2s ease;
        }

        .admin-topbar-actions .primary,
        .admin-inline-btn.primary,
        .admin-action-btn.primary {
          background: #1d4ed8;
          color: #fff;
          box-shadow: 0 12px 24px rgba(29, 78, 216, 0.2);
        }

        .admin-topbar-actions .ghost,
        .admin-inline-btn.ghost,
        .admin-action-btn.ghost {
          background: #fff;
          color: #1d4ed8;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
        }

        .admin-topbar-actions button:hover,
        .admin-filter-group button:hover,
        .admin-row-actions button:hover,
        .admin-inline-btn:hover,
        .admin-action-btn:hover {
          transform: translateY(-1px);
          opacity: 0.96;
        }

        .admin-alert {
          border-radius: 18px;
          padding: 14px 16px;
          font-weight: 800;
          border: 1px solid transparent;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
        }

        .admin-alert.success {
          background: #ecfdf5;
          color: #047857;
          border-color: #a7f3d0;
        }

        .admin-alert.info {
          background: #eff6ff;
          color: #1d4ed8;
          border-color: #bfdbfe;
        }

        .admin-alert.error {
          background: #fef2f2;
          color: #b91c1c;
          border-color: #fecaca;
        }

        .badge-danger {
          background: #fef2f2;
          color: #b91c1c;
          border-color: #fecaca;
        }

        .admin-hero {
          position: relative;
          overflow: hidden;
          border-radius: 28px;
          padding: 28px;
          background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 58%, #0ea5e9 100%);
          box-shadow: 0 18px 36px rgba(15, 23, 42, 0.18);
          color: #fff;
        }

        .admin-hero::before,
        .admin-hero::after {
          content: "";
          position: absolute;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.14);
        }

        .admin-hero::before {
          width: 220px;
          height: 220px;
          right: -70px;
          top: -80px;
        }

        .admin-hero::after {
          width: 180px;
          height: 180px;
          right: 100px;
          bottom: -90px;
        }

        .admin-hero-grid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.8fr);
          gap: 18px;
          align-items: stretch;
        }

        .admin-hero h2 {
          margin: 12px 0 0;
          font-size: clamp(30px, 5vw, 56px);
          line-height: 0.98;
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .admin-hero p {
          max-width: 840px;
          margin: 14px 0 0;
          color: rgba(255, 255, 255, 0.92);
          line-height: 1.7;
          font-weight: 650;
        }

        .admin-hero-badges {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 18px;
        }

        .admin-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.14);
          border: 1px solid rgba(255, 255, 255, 0.16);
          font-size: 12px;
          font-weight: 800;
          color: #fff;
        }

        .admin-hero-panel {
          display: grid;
          gap: 12px;
          padding: 18px;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(12px);
        }

        .admin-hero-panel strong {
          font-size: 28px;
          font-weight: 950;
        }

        .admin-hero-panel span {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.85);
          font-weight: 700;
        }

        .admin-grid-12 {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .admin-stat-card,
        .admin-chart-card,
        .admin-section,
        .admin-activity-card,
        .admin-mini-card {
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(148, 163, 184, 0.18);
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
        }

        .admin-stat-card {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          padding: 18px;
          min-height: 122px;
        }

        .admin-stat-card .admin-stat-icon {
          display: grid;
          place-items: center;
          width: 54px;
          height: 54px;
          border-radius: 18px;
          font-size: 24px;
          flex: 0 0 auto;
        }

        .admin-stat-card.blue .admin-stat-icon { background: #dbeafe; }
        .admin-stat-card.green .admin-stat-icon { background: #dcfce7; }
        .admin-stat-card.purple .admin-stat-icon { background: #ede9fe; }
        .admin-stat-card.orange .admin-stat-icon { background: #ffedd5; }
        .admin-stat-card.slate .admin-stat-icon { background: #e2e8f0; }

        .admin-stat-copy strong {
          display: block;
          font-size: 30px;
          line-height: 1;
          color: #0f172a;
          font-weight: 950;
        }

        .admin-stat-copy p {
          margin: 7px 0 0;
          color: #334155;
          font-size: 14px;
          font-weight: 900;
        }

        .admin-stat-copy span {
          display: block;
          margin-top: 4px;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .admin-stat-copy small {
          display: block;
          margin-top: 4px;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 700;
        }

        .admin-section {
          padding: 20px;
        }

        .admin-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }

        .admin-section-head h2 {
          margin: 0;
          color: #0f172a;
          font-size: 24px;
          font-weight: 950;
        }

        .admin-section-head p {
          margin: 6px 0 0;
          color: #64748b;
          line-height: 1.6;
          font-weight: 650;
        }

        .admin-section-actions,
        .admin-filter-group,
        .admin-row-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .admin-filter-group button,
        .admin-row-actions button,
        .admin-inline-btn,
        .admin-action-btn {
          background: #fff;
          color: #1e3a8a;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
        }

        .admin-row-actions button.danger {
          color: #b91c1c;
          background: #fff1f2;
        }

        .admin-controls {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }

        .admin-field {
          display: grid;
          gap: 7px;
        }

        .admin-field label {
          color: #475569;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .admin-input,
        .admin-select {
          width: 100%;
          border: 1px solid #dbe3f3;
          border-radius: 14px;
          background: #fff;
          padding: 12px 14px;
          color: #0f172a;
          font-weight: 700;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .admin-input:focus,
        .admin-select:focus {
          border-color: #60a5fa;
          box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.16);
        }

        .admin-chart-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .admin-chart-card {
          padding: 18px;
        }

        .admin-chart-meta h3 {
          margin: 0;
          color: #0f172a;
          font-size: 18px;
          font-weight: 950;
        }

        .admin-chart-meta p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
          font-weight: 650;
        }

        .admin-line-chart {
          display: block;
          width: 100%;
          height: 170px;
          margin-top: 12px;
        }

        .admin-line-chart polyline {
          stroke: #2563eb;
        }

        .admin-line-chart circle {
          fill: #2563eb;
        }

        .admin-bar-chart {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
          align-items: end;
          height: 170px;
          margin-top: 14px;
        }

        .admin-bar-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          height: 100%;
        }

        .admin-bar-item strong {
          color: #0f172a;
          font-size: 12px;
          font-weight: 900;
        }

        .admin-bar-item span {
          width: 100%;
          border-radius: 14px 14px 4px 4px;
          background: linear-gradient(180deg, #60a5fa 0%, #2563eb 100%);
          min-height: 12px;
        }

        .admin-overview-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .admin-mini-card {
          padding: 18px;
        }

        .admin-mini-card h3 {
          margin: 0;
          color: #0f172a;
          font-size: 17px;
          font-weight: 950;
        }

        .admin-mini-card p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
          font-weight: 650;
        }

        .admin-mini-card strong {
          display: block;
          margin-top: 10px;
          color: #0f172a;
          font-size: 28px;
          font-weight: 950;
        }

        .admin-table-wrap {
          overflow-x: auto;
          border-radius: 18px;
          border: 1px solid #e2e8f0;
        }

        .admin-table {
          width: 100%;
          min-width: 1020px;
          border-collapse: collapse;
          font-size: 13px;
        }

        .admin-table th {
          text-align: left;
          padding: 13px 14px;
          background: #f8fafc;
          color: #475569;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }

        .admin-table td {
          padding: 13px 14px;
          border-top: 1px solid #e2e8f0;
          color: #334155;
          font-weight: 650;
          vertical-align: top;
        }

        .admin-empty-cell {
          padding: 20px 14px !important;
          color: #94a3b8 !important;
          text-align: center;
          font-weight: 800 !important;
        }

        .admin-user-name-cell {
          display: grid;
          gap: 4px;
          min-width: 220px;
        }

        .admin-user-name-cell strong {
          color: #0f172a;
          font-size: 14px;
          font-weight: 900;
        }

        .admin-user-name-cell span {
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          white-space: normal;
        }

        .admin-activity-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
          gap: 14px;
        }

        .admin-activity-list {
          display: grid;
          gap: 12px;
        }

        .admin-activity-item {
          display: flex;
          gap: 12px;
          padding: 14px;
          border-radius: 18px;
          background: #f8fbff;
          border: 1px solid #dbeafe;
        }

        .admin-activity-icon {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: #dbeafe;
          color: #1d4ed8;
          font-size: 20px;
          font-weight: 900;
          flex: 0 0 auto;
        }

        .admin-activity-copy {
          min-width: 0;
          flex: 1;
        }

        .admin-activity-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }

        .admin-activity-copy strong {
          color: #0f172a;
          font-size: 14px;
          font-weight: 900;
        }

        .admin-activity-copy p {
          margin: 6px 0 0;
          color: #334155;
          font-size: 13px;
          font-weight: 650;
        }

        .admin-activity-copy small {
          display: block;
          margin-top: 6px;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .admin-health-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .admin-health-card {
          padding: 18px;
          border-radius: 18px;
          background: #f8fbff;
          border: 1px solid #dbeafe;
          display: grid;
          gap: 8px;
        }

        .admin-health-card strong {
          color: #0f172a;
          font-size: 15px;
          font-weight: 900;
        }

        .admin-health-card p {
          margin: 0;
          color: #475569;
          font-size: 13px;
          line-height: 1.6;
          font-weight: 650;
        }

        .admin-announcements-grid,
        .admin-feedback-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .admin-list-card {
          padding: 18px;
          border-radius: 18px;
          background: #f8fbff;
          border: 1px solid #dbeafe;
        }

        .admin-list-card h3 {
          margin: 0;
          color: #0f172a;
          font-size: 16px;
          font-weight: 900;
        }

        .admin-list-card p {
          margin: 8px 0 0;
          color: #334155;
          line-height: 1.6;
          font-weight: 650;
        }

        .admin-list-card small {
          display: block;
          margin-top: 8px;
          color: #64748b;
          font-weight: 700;
        }

        .admin-side-rail {
          display: grid;
          gap: 12px;
        }

        .admin-compact-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .admin-compact-card {
          padding: 16px;
          border-radius: 18px;
          background: #fff;
          border: 1px solid #dbeafe;
        }

        .admin-compact-card strong {
          display: block;
          color: #0f172a;
          font-size: 24px;
          font-weight: 950;
        }

        .admin-compact-card span {
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .admin-subtle-note {
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.6;
        }

        .admin-filter-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }

        .admin-filter-row button {
          border: 1px solid #dbeafe;
          background: #fff;
          color: #1d4ed8;
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
        }

        .admin-filter-row button.active {
          background: #1d4ed8;
          color: #fff;
        }

        @media (max-width: 1180px) {
          .admin-grid-12,
          .admin-chart-grid,
          .admin-overview-grid,
          .admin-health-grid,
          .admin-announcements-grid,
          .admin-feedback-grid {
            grid-template-columns: 1fr 1fr;
          }

          .admin-activity-layout,
          .admin-hero-grid {
            grid-template-columns: 1fr;
          }

          .admin-controls {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 760px) {
          .admin-dashboard-page {
            padding: 16px;
          }

          .admin-grid-12,
          .admin-chart-grid,
          .admin-overview-grid,
          .admin-health-grid,
          .admin-announcements-grid,
          .admin-feedback-grid,
          .admin-controls {
            grid-template-columns: 1fr;
          }

          .admin-section,
          .admin-hero {
            border-radius: 22px;
          }

          .admin-topbar-actions,
          .admin-section-actions,
          .admin-filter-group,
          .admin-row-actions {
            width: 100%;
          }

          .admin-table {
            min-width: 940px;
          }
        }
      `}</style>

      <div className="admin-shell">
        <div className="admin-topbar">
          <div>
            <p className="admin-kicker">Admin control center</p>
            <h1>StudyFlow Admin Dashboard</h1>
            <p>
              Live overview built only from the current StudyFlow data sources. Missing backend
              fields are shown as placeholders instead of fake values.
            </p>
          </div>

          <div className="admin-topbar-actions">
            <button className="ghost" type="button" onClick={() => navigate("/admin/users")}>Open users</button>
            <button className="ghost" type="button" onClick={() => navigate("/admin/notes")}>Open notes</button>
            <button className="primary" type="button" onClick={refreshAll}>
              {refreshingDashboard ? "Refreshing..." : "Refresh all"}
            </button>
          </div>
        </div>

        {adminLoginNotice ? <div className="admin-alert success">{adminLoginNotice}</div> : null}
        {dashboardError ? <div className="admin-alert error">{dashboardError}</div> : null}
        {usersError ? <div className="admin-alert error">{usersError}</div> : null}
        {notesError ? <div className="admin-alert error">{notesError}</div> : null}
        {feedbackError ? <div className="admin-alert error">{feedbackError}</div> : null}
        {notice ? <div className="admin-alert info">{notice}</div> : null}

        <section className="admin-hero">
          <div className="admin-hero-grid">
            <div>
              <span className="admin-pill">Protected admin access</span>
              <h2>Professional control room for users, notes, AI health, and activity</h2>
              <p>
                This dashboard keeps the current StudyFlow architecture intact while surfacing live
                counts, recent activity, active admins, notes, feedback, announcements, and service
                health in one responsive overview.
              </p>

              <div className="admin-hero-badges">
                <span className="admin-pill">React + Laravel</span>
                <span className="admin-pill">Responsive UI</span>
                <span className="admin-pill">API-backed data only</span>
                <span className="admin-pill">Admin protected</span>
              </div>
            </div>

            <div className="admin-hero-panel">
              <div>
                <strong>{formatValue(dashboardStats.total_users)}</strong>
                <span>Total Users</span>
              </div>
              <div>
                <strong>{formatValue(dashboardStats.total_notes)}</strong>
                <span>Total Notes</span>
              </div>
              <div>
                <strong>{formatValue(dashboardStats.quizzes_created || dashboardStats.quiz_count)}</strong>
                <span>Total Quizzes Generated</span>
              </div>
              <div>
                <strong>{formatValue(dashboardStats.ai_summaries)}</strong>
                <span>Total Summaries Generated</span>
              </div>
            </div>
          </div>
        </section>

        <section className="admin-section">
          <SectionHeader
            title="Admin Dashboard Overview"
            subtitle="Current totals, active users, admin counts, weekly analytics, and service health."
            actions={
              <div className="admin-filter-group">
                {[7, 14, 30].map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={rangeDays === days ? "active" : ""}
                    onClick={() => setRangeDays(days)}
                  >
                    Last {days} days
                  </button>
                ))}
              </div>
            }
          />

          <div className="admin-grid-12">
            <StatCard icon="👥" title="Total Users" value={dashboardStats.total_users} subtitle="All registered accounts" tone="blue" />
            <StatCard icon="⚡" title="Active Users" value={dashboardStats.active_users} subtitle="Status: active" tone="green" />
            <StatCard icon="●" title="Online Users" value={dashboardStats.online_users} subtitle="Seen in the last 5 minutes" tone="green" />
            <StatCard icon="🛡️" title="Admin Users" value={activeAdminsCount} subtitle="All active admins" tone="purple" />
            <StatCard icon="📄" title="Total Notes Uploaded" value={dashboardStats.total_notes} subtitle="Stored notes in the system" tone="orange" />
            <StatCard icon="📥" title="Total PDFs Processed" value={dashboardStats.files_uploaded} subtitle="Files currently tracked" tone="slate" />
            <StatCard icon="📝" title="Total Quizzes Generated" value={dashboardStats.quizzes_created || dashboardStats.quiz_count} subtitle="Quiz attempts and generation" tone="blue" />
            <StatCard icon="🤖" title="Total Summaries Generated" value={dashboardStats.ai_summaries} subtitle="AI summary records" tone="purple" />
            <StatCard icon="🔥" title="Failed Processing Count" value="—" subtitle="Not exposed by current API" hint="Placeholder only" tone="slate" />
            <StatCard icon="💬" title="Feedback Count" value={feedbackCount} subtitle="Latest feedback items loaded" tone="green" />
            <StatCard icon="⚠️" title="Reports Count" value={reportsCount ?? "—"} subtitle="No reports API in the current backend" hint="Placeholder only" tone="orange" />
            <StatCard icon="🧭" title="AskPDF Status" value="Not exposed" subtitle="No health endpoint available" hint="Placeholder only" tone="slate" />
            <StatCard icon="🧠" title="AI Model Currently Active" value={dashboard.system_health?.find((item) => item.name === "Current AI Model")?.status || "Local Ollama"} subtitle="Active model from dashboard API" tone="purple" />
          </div>

          <div style={{ height: 14 }} />

          <div className="admin-overview-grid">
            <div className="admin-mini-card">
              <h3>Today</h3>
              <p>Users, notes, and AI usage created today.</p>
              <strong>{formatValue(dashboardStats.today_users || 0)} / {formatValue(dashboardStats.today_notes || 0)} / {formatValue(dashboardStats.today_ai_usage || 0)}</strong>
            </div>

            <div className="admin-mini-card">
              <h3>Last 7 Days</h3>
              <p>Summed from the current dashboard analytics arrays.</p>
              <strong>{formatValue(weekUsers)} / {formatValue(weekNotes)} / {formatValue(weekAi)}</strong>
            </div>

            <div className="admin-mini-card">
              <h3>Live Admins</h3>
              <p>All active admin accounts currently available from the API.</p>
              <strong>{formatValue(activeAdmins.length)}</strong>
            </div>
          </div>
        </section>

        <section className="admin-section">
          <SectionHeader
            title="Analytics"
            subtitle="Weekly chart snapshots using the current dashboard analytics arrays."
          />

          <div className="admin-chart-grid">
            <ChartCard
              title="Users and Notes Growth"
              subtitle={`Range: ${chartRange.length || rangeDays} points`}
              values={dashboard.charts?.user_growth || []}
            />

            <ChartCard
              title="AI Usage and Quizzes"
              subtitle="Last available metrics from the dashboard API"
              values={dashboard.charts?.ai_usage || []}
              mode="bar"
            />

            <ChartCard
              title="Summaries Growth"
              subtitle="Summary generation trend"
              values={dashboard.charts?.summary_growth || []}
            />
          </div>

          <div style={{ height: 14 }} />

          <div className="admin-compact-grid">
            <div className="admin-compact-card">
              <strong>{formatValue(weekQuizzes)}</strong>
              <span>Quizzes in the selected range</span>
            </div>
            <div className="admin-compact-card">
              <strong>{formatValue(weekSummaries)}</strong>
              <span>Summaries in the selected range</span>
            </div>
          </div>
        </section>

        <section className="admin-section">
          <SectionHeader
            title="Recent Activity"
            subtitle="Logs are assembled from the current dashboard feed, recent users, notes, quizzes, summaries, and feedback."
            actions={
              <div className="admin-filter-group">
                {[
                  ["last7", "Last 7 days"],
                  ["today", "Today"],
                  ["yesterday", "Yesterday"],
                  ["custom", "Custom date"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={rangeFilter === value ? "active" : ""}
                    onClick={() => setRangeFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          />

          {rangeFilter === "custom" ? (
            <div className="admin-field" style={{ maxWidth: 240, marginBottom: 14 }}>
              <label>Custom date</label>
              <input
                className="admin-input"
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
              />
            </div>
          ) : null}

          <div className="admin-activity-layout">
            <div className="admin-activity-card" style={{ padding: 18 }}>
              <div className="admin-activity-list">
                {activityFiltered.length === 0 ? (
                  <div className="admin-mini-card">
                    <h3>No activity found</h3>
                    <p>Try a different date filter.</p>
                  </div>
                ) : (
                  activityFiltered.slice(0, 10).map((item) => (
                    <ActivityItem key={item.id} item={item} />
                  ))
                )}
              </div>
            </div>

            <div className="admin-side-rail">
              <div className="admin-mini-card">
                <h3>Today’s Activity</h3>
                <p>Logged events since midnight.</p>
                <strong>{formatValue(todayActivityCount)}</strong>
              </div>

              <div className="admin-mini-card">
                <h3>Selected Range</h3>
                <p>Filtered activity count for the current view.</p>
                <strong>{formatValue(activityFiltered.length)}</strong>
              </div>

              <div className="admin-mini-card">
                <h3>Quick Note</h3>
                <p className="admin-subtle-note">
                  The current backend exposes registrations, notes, quizzes, summaries, and
                  feedback. Login and role-change logs are shown only when the data source already
                  provides them.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="admin-section">
          <SectionHeader
            title="User Management"
            subtitle="Search users by name or email, filter by role and status, and use the existing admin actions without changing backend routes."
          />

          <div className="admin-controls">
            <div className="admin-field">
              <label>Search</label>
              <input
                className="admin-input"
                placeholder="Search by name or email"
                value={userFilters.search}
                onChange={(e) => setUserFilters((current) => ({ ...current, search: e.target.value }))}
              />
            </div>

            <div className="admin-field">
              <label>Role</label>
              <select
                className="admin-select"
                value={userFilters.role}
                onChange={(e) => setUserFilters((current) => ({ ...current, role: e.target.value }))}
              >
                <option value="all">All</option>
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
            </div>

            <div className="admin-field">
              <label>Status</label>
              <select
                className="admin-select"
                value={userFilters.status}
                onChange={(e) => setUserFilters((current) => ({ ...current, status: e.target.value }))}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="admin-field">
              <label>Activity</label>
              <select
                className="admin-select"
                value={userFilters.activity}
                onChange={(e) => setUserFilters((current) => ({ ...current, activity: e.target.value }))}
              >
                <option value="all">All</option>
                <option value="online">Online now</option>
                <option value="offline">Offline</option>
                <option value="never">Never logged in</option>
              </select>
            </div>

            <div className="admin-field">
              <label>Quick actions</label>
              <div className="admin-filter-group">
                <button type="button" onClick={() => navigate("/admin/users")}>Open full page</button>
                <button type="button" onClick={() => loadUsers(userFilters)}>Reload list</button>
              </div>
            </div>
          </div>

          <div className="admin-mini-card" style={{ marginBottom: 14 }}>
            <h3>Active Admins</h3>
            <p>All active admins currently returned by the existing API.</p>
            <div className="admin-filter-group" style={{ marginTop: 12 }}>
              {activeAdmins.length === 0 ? (
                <span className="admin-subtle-note">No active admins returned.</span>
              ) : (
                activeAdmins.map((adminRecord) => (
                  <span key={adminRecord.id} className="admin-pill" style={{ color: "#0f172a", background: "#e0f2fe", borderColor: "#bae6fd" }}>
                    {adminRecord.name} · {adminRecord.email}
                  </span>
                ))
              )}
            </div>
          </div>

          {usersLoading ? (
            <div className="admin-mini-card">
              <h3>Loading users...</h3>
              <p>Please wait.</p>
            </div>
          ) : (
            <Table
              columns={[
                "User",
                "Email",
                "Role",
                "Status",
                "Online",
                "Last Login",
                "Last Seen",
                "Registered",
                "Actions",
              ]}
              emptyText="No users found."
              rows={userRows}
            />
          )}
        </section>

        <section className="admin-section">
          <SectionHeader
            title="Notes Management"
            subtitle="Search every note, review summaries, and deactivate broken notes without deleting them."
          />

          <div className="admin-controls">
            <div className="admin-field">
              <label>Search</label>
              <input
                className="admin-input"
                placeholder="Search by note title"
                value={noteFilters.search}
                onChange={(e) => setNoteFilters((current) => ({ ...current, search: e.target.value }))}
              />
            </div>

            <div className="admin-field">
              <label>Featured</label>
              <select
                className="admin-select"
                value={noteFilters.featured}
                onChange={(e) => setNoteFilters((current) => ({ ...current, featured: e.target.value }))}
              >
                <option value="all">All</option>
                <option value="featured">Featured</option>
                <option value="not_featured">Not featured</option>
              </select>
            </div>

            <div className="admin-field">
              <label>Status</label>
              <select
                className="admin-select"
                value={noteFilters.status}
                onChange={(e) => setNoteFilters((current) => ({ ...current, status: e.target.value }))}
              >
                <option value="all">All</option>
                <option value="uploaded">Uploaded</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="processing">Processing</option>
                <option value="failed">Failed</option>
              </select>
            </div>

            <div className="admin-field">
              <label>Summary</label>
              <select
                className="admin-select"
                value={noteFilters.summary}
                onChange={(e) => setNoteFilters((current) => ({ ...current, summary: e.target.value }))}
              >
                <option value="all">All</option>
                <option value="with_summary">With summary</option>
                <option value="without_summary">Without summary</option>
              </select>
            </div>

            <div className="admin-field">
              <label>Quick actions</label>
              <div className="admin-filter-group">
                <button type="button" onClick={() => navigate("/admin/notes")}>Open full page</button>
                <button type="button" onClick={() => loadNotes(noteFilters)}>Reload list</button>
              </div>
            </div>

          </div>

          <div className="admin-compact-grid" style={{ marginBottom: 14 }}>
            <div className="admin-compact-card">
              <strong>{formatValue(dashboardStats.total_notes)}</strong>
              <span>Total notes</span>
            </div>
            <div className="admin-compact-card">
              <strong>{formatValue(dashboardStats.featured_notes)}</strong>
              <span>Featured notes</span>
            </div>
          </div>

          {notesLoading ? (
            <div className="admin-mini-card">
              <h3>Loading notes...</h3>
              <p>Please wait.</p>
            </div>
          ) : (
            <Table
              columns={["Note", "Owner", "Featured", "Status", "Summary", "Created", "Actions"]}
              emptyText="No notes found."
              rows={noteRows}
            />
          )}
        </section>

        <section className="admin-section">
          <SectionHeader
            title="AI Management"
            subtitle="Current model and service health states pulled from the existing dashboard and health endpoints only."
          />

          <div className="admin-health-grid">
            {healthRows.map((item) => (
              <div key={item.name} className="admin-health-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <strong>{item.name}</strong>
                  <StatusBadge type={item.type}>{item.status}</StatusBadge>
                </div>
                <p>{item.detail}</p>
              </div>
            ))}
          </div>

          <div style={{ height: 14 }} />

          <div className="admin-overview-grid">
            <div className="admin-mini-card">
              <h3>Current Ollama Model</h3>
              <p>Shown from the dashboard API.</p>
              <strong>{dashboard.system_health?.find((item) => item.name === "Current AI Model")?.status || "Local Ollama"}</strong>
            </div>
            <div className="admin-mini-card">
              <h3>Summary Service</h3>
              <p>Health from the existing FastAPI bridge.</p>
              <strong>{health.localAi?.success ? "Online" : "Offline"}</strong>
            </div>
            <div className="admin-mini-card">
              <h3>AI Tutor</h3>
              <p>Health from the existing AI Tutor endpoint.</p>
              <strong>{health.aiTutor?.ok ? "Online" : "Offline"}</strong>
            </div>
          </div>
        </section>

        <section className="admin-section">
          <SectionHeader
            title="Announcements"
            subtitle="Announcements are saved in the backend and shown to every user."
            actions={
              <div className="admin-filter-group">
                <button type="button" onClick={() => navigate("/admin/announcements")}>Open announcements page</button>
              </div>
            }
          />

          <div className="admin-field" style={{ maxWidth: 360, marginBottom: 14 }}>
            <label>Search announcements</label>
            <input
              className="admin-input"
              placeholder="Search title or message"
              value={announcementSearch}
              onChange={(e) => setAnnouncementSearch(e.target.value)}
            />
          </div>

          <div className="admin-announcements-grid">
            {announcementsFiltered.length === 0 ? (
              <div className="admin-mini-card">
                <h3>No announcements saved</h3>
                <p>Use the announcements page to create or manage admin messages.</p>
              </div>
            ) : (
              announcementsFiltered.slice(0, 4).map((item) => (
                <div key={item.id} className="admin-list-card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <h3>{item.title || "Announcement"}</h3>
                    <div className="admin-filter-group">
                      {item.is_pinned ? <StatusBadge type="warning">Pinned</StatusBadge> : null}
                      {item.expires_at ? <StatusBadge type="info">Expires {formatDate(item.expires_at)}</StatusBadge> : null}
                    </div>
                  </div>
                  <p>{item.message || item.body || "No message"}</p>
                  <small>{formatDateTime(item.created_at)}</small>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="admin-section">
          <SectionHeader
            title="Feedback & Reports"
            subtitle="The current backend exposes recent feedback only. Report fields that are not present are labeled as placeholders."
            actions={
              <div className="admin-filter-group">
                <button type="button" onClick={() => navigate("/admin/feedback")}>Open feedback page</button>
              </div>
            }
          />

          <div className="admin-field" style={{ maxWidth: 360, marginBottom: 14 }}>
            <label>Search feedback</label>
            <input
              className="admin-input"
              placeholder="Search by name, email, or message"
              value={feedbackSearch}
              onChange={(e) => setFeedbackSearch(e.target.value)}
            />
          </div>

          <div className="admin-feedback-grid">
            {feedbackLoading ? (
              <div className="admin-mini-card">
                <h3>Loading feedback...</h3>
                <p>Please wait.</p>
              </div>
            ) : feedbackFiltered.length === 0 ? (
              <div className="admin-mini-card">
                <h3>No feedback found</h3>
                <p>There is no recent feedback available from the API.</p>
              </div>
            ) : (
              feedbackFiltered.slice(0, 6).map((item) => (
                <div key={item.id} className="admin-list-card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <h3>{item.name || item.user_name || "Feedback"}</h3>
                    <StatusBadge type="warning">Open</StatusBadge>
                  </div>
                  <p>{item.message || item.feedback || item.content || item.description || "No message"}</p>
                  <small>
                    {item.email || "Email not exposed"} · {formatDateTime(item.created_at)}
                  </small>
                </div>
              ))
            )}

            <div className="admin-mini-card">
              <h3>Reports</h3>
              <p>Report management is not exposed by the current backend, so this page shows a placeholder instead of guessing data.</p>
              <strong>{reportsCount ?? "—"}</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
