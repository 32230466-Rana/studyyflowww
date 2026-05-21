import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosClient from "../api/axiosClient";


const emptyDashboard = {
  totalUsers: 0,
  totalNotes: 0,
  totalAdmins: 0,
  featuredNotes: 0,
  aiSummaries: 0,
  aiUsageCount: 0,
  activeUsers: 0,
  aiRequests: 0,
  quizzesCreated: 0,
  filesUploaded: 0,
  todayUsers: 0,
  todayNotes: 0,
  todayAiUsage: 0,
  userGrowth: [0, 0, 0, 0, 0, 0, 0],
  notesGrowth: [0, 0, 0, 0, 0, 0, 0],
  aiUsage: [0, 0, 0, 0, 0, 0, 0],
  quizGrowth: [0, 0, 0, 0, 0, 0, 0],
  summaryGrowth: [0, 0, 0, 0, 0, 0, 0],
  recentUsers: [],
  recentNotes: [],
  recentQuizzes: [],
  recentSummaries: [],
  recentActivity: [],
};

const getValue = (obj, path) => {
  return path.split(".").reduce((acc, key) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, key)) {
      return acc[key];
    }

    return undefined;
  }, obj);
};

const pick = (obj, paths, fallback = null) => {
  for (const path of paths) {
    const value = getValue(obj, path);

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return fallback;
};

const pickNumber = (obj, paths, fallback = 0) => {
  const value = pick(obj, paths, fallback);
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
};

const pickArray = (obj, paths, fallback = []) => {
  const value = pick(obj, paths, fallback);

  return Array.isArray(value) ? value : fallback;
};

const normalizeSeries = (series, fallback) => {
  if (!Array.isArray(series) || series.length === 0) {
    return fallback;
  }

  return series.map((item) => {
    if (typeof item === "number") {
      return item;
    }

    if (item && typeof item === "object") {
      return Number(
        item.count ??
          item.total ??
          item.value ??
          item.users ??
          item.notes ??
          item.summaries ??
          item.quizzes ??
          0
      );
    }

    return 0;
  });
};

const normalizeDashboard = (payload) => {
  const root = payload?.data ?? payload ?? {};

  return {
    totalUsers: pickNumber(root, [
      "totalUsers",
      "total_users",
      "stats.totalUsers",
      "stats.total_users",
      "counts.totalUsers",
      "counts.total_users",
    ]),

    totalNotes: pickNumber(root, [
      "totalNotes",
      "total_notes",
      "stats.totalNotes",
      "stats.total_notes",
      "counts.totalNotes",
      "counts.total_notes",
    ]),

    totalAdmins: pickNumber(root, [
      "totalAdmins",
      "total_admins",
      "stats.totalAdmins",
      "stats.total_admins",
      "counts.totalAdmins",
      "counts.total_admins",
    ]),

    featuredNotes: pickNumber(root, [
      "featuredNotes",
      "featured_notes",
      "stats.featuredNotes",
      "stats.featured_notes",
    ]),

    aiSummaries: pickNumber(root, [
      "aiSummaries",
      "ai_summaries",
      "summaryCount",
      "summary_count",
      "stats.aiSummaries",
      "stats.ai_summaries",
      "stats.summary_count",
    ]),

    aiUsageCount: pickNumber(root, [
      "aiUsageCount",
      "ai_usage_count",
      "stats.aiUsageCount",
      "stats.ai_usage_count",
      "ai_usage_total",
      "stats.ai_usage_total",
      "counts.aiUsageCount",
      "counts.ai_usage_count",
    ]),

    activeUsers: pickNumber(root, [
      "activeUsers",
      "active_users",
      "stats.activeUsers",
      "stats.active_users",
    ]),

    aiRequests: pickNumber(root, [
      "aiRequests",
      "ai_requests",
      "stats.aiRequests",
      "stats.ai_requests",
      "stats.ai_summaries",
      "aiSummaries",
      "ai_summaries",
    ]),

    quizzesCreated: pickNumber(root, [
      "quizzesCreated",
      "quizzes_created",
      "quizCount",
      "quiz_count",
      "stats.quizzesCreated",
      "stats.quizzes_created",
      "stats.quiz_count",
    ]),

    filesUploaded: pickNumber(root, [
      "filesUploaded",
      "files_uploaded",
      "stats.filesUploaded",
      "stats.files_uploaded",
    ]),

    todayUsers: pickNumber(root, [
      "todayUsers",
      "today_users",
      "stats.todayUsers",
      "stats.today_users",
    ]),

    todayNotes: pickNumber(root, [
      "todayNotes",
      "today_notes",
      "stats.todayNotes",
      "stats.today_notes",
    ]),

    todayAiUsage: pickNumber(root, [
      "todayAiUsage",
      "today_ai_usage",
      "stats.todayAiUsage",
      "stats.today_ai_usage",
    ]),

    userGrowth: normalizeSeries(
      pickArray(root, [
        "userGrowth",
        "user_growth",
        "charts.userGrowth",
        "charts.user_growth",
        "charts.users_growth",
      ]),
      emptyDashboard.userGrowth
    ),

    notesGrowth: normalizeSeries(
      pickArray(root, [
        "notesGrowth",
        "notes_growth",
        "notesUploads",
        "notes_uploads",
        "charts.notesGrowth",
        "charts.notes_growth",
        "charts.notes_uploads",
      ]),
      emptyDashboard.notesGrowth
    ),

    aiUsage: normalizeSeries(
      pickArray(root, [
        "aiUsage",
        "ai_usage",
        "charts.aiUsage",
        "charts.ai_usage",
      ]),
      emptyDashboard.aiUsage
    ),

    quizGrowth: normalizeSeries(
      pickArray(root, [
        "quizGrowth",
        "quiz_growth",
        "charts.quizGrowth",
        "charts.quiz_growth",
      ]),
      emptyDashboard.quizGrowth
    ),

    summaryGrowth: normalizeSeries(
      pickArray(root, [
        "summaryGrowth",
        "summary_growth",
        "charts.summaryGrowth",
        "charts.summary_growth",
      ]),
      emptyDashboard.summaryGrowth
    ),

    recentUsers: pickArray(root, [
      "recentUsers",
      "recent_users",
      "latestUsers",
      "latest_users",
      "users",
    ]),

    recentNotes: pickArray(root, [
      "recentNotes",
      "recent_notes",
      "latestNotes",
      "latest_notes",
      "notes",
    ]),

    recentQuizzes: pickArray(root, [
      "recentQuizzes",
      "recent_quizzes",
      "latestQuizzes",
      "latest_quizzes",
      "quizzes",
    ]),

    recentSummaries: pickArray(root, [
      "recentSummaries",
      "recent_summaries",
      "latestSummaries",
      "latest_summaries",
      "summaries",
    ]),

    recentActivity: pickArray(root, [
      "recentActivity",
      "recent_activity",
      "activities",
      "latestActivity",
      "latest_activity",
    ]),
  };
};

const formatDate = (value) => {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString();
};

const FeatureCard = ({ title, icon, points, variant = "blue", onClick }) => {
  const handlePointClick = (e, point) => {
    e.stopPropagation();

    if (point && typeof point === "object" && point.action) {
      point.action();
      return;
    }

    if (onClick) {
      onClick();
    }
  };

  return (
    <div
      className={`admin-feature-card ${variant}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onClick) {
          onClick();
        }
      }}
    >
      <div className="admin-feature-card-head">
        <h3>{title}</h3>
        <span>{icon}</span>
      </div>

      <div className="admin-feature-line" />

      <ul>
        {points.map((point, index) => {
          const label = typeof point === "string" ? point : point.label;

          return (
            <li key={label}>
              <button
                type="button"
                className="admin-feature-point-btn"
                onClick={(e) => handlePointClick(e, point)}
              >
                <span className={`dot dot-${index + 1}`} />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const MetricBox = ({ icon, label, value }) => {
  return (
    <div className="admin-metric-box">
      <span className="metric-icon">{icon}</span>

      <div>
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </div>
  );
};

const SmallStatCard = ({ icon, label, value, variant = "blue" }) => {
  return (
    <div className={`small-stat-card ${variant}`}>
      <span>{icon}</span>

      <div>
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </div>
  );
};

const MiniLineChart = ({ values = [] }) => {
  const safeValues = values.length > 0 ? values : [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(...safeValues.map((v) => Number(v || 0)), 1);
  const width = 420;
  const height = 120;
  const gap = safeValues.length > 1 ? width / (safeValues.length - 1) : width;

  const points = safeValues
    .map((value, index) => {
      const x = index * gap;
      const y = height - (Number(value || 0) / max) * 75 - 25;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="mini-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <polyline points={points} fill="none" strokeWidth="5" />

        {safeValues.map((value, index) => {
          const x = index * gap;
          const y = height - (Number(value || 0) / max) * 75 - 25;

          return (
            <g key={`${value}-${index}`}>
              <circle cx={x} cy={y} r="5" />
              <text
                x={x}
                y={Math.max(12, y - 10)}
                textAnchor="middle"
                fontSize="18"
                fontWeight="800"
                fill="#0f172a"
              >
                {Number(value || 0)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const MiniBarChart = ({ values = [] }) => {
  const safeValues = values.length > 0 ? values : [0, 0, 0, 0, 0];
  const max = Math.max(...safeValues.map((v) => Number(v || 0)), 1);

  return (
    <div className="mini-bars">
      {safeValues.map((value, index) => (
        <div
          key={`${value}-${index}`}
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <strong
            style={{
              fontSize: "14px",
              color: "#0f172a",
            }}
          >
            {Number(value || 0)}
          </strong>

          <span
            style={{
              height: `${Math.max(12, (Number(value || 0) / max) * 100)}%`,
            }}
          />
        </div>
      ))}
    </div>
  );
};

const StatusPill = ({ children, type = "active" }) => {
  return <span className={`status-pill ${type}`}>{children}</span>;
};

export default function AdminDashboardPage() {
  const navigate = useNavigate();

  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/admin/dashboard");
      setDashboard(normalizeDashboard(response.data));
    } catch (err) {
      console.error("Failed to load admin dashboard:", err);
      setDashboard(emptyDashboard);
      setError(
        "Dashboard data could not be loaded. The page design is still displayed."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const topStats = useMemo(
    () => [
      {
        icon: "👥",
        label: "Total Users",
        value: dashboard.totalUsers,
        variant: "blue",
      },
      {
        icon: "📁",
        label: "Total Notes",
        value: dashboard.totalNotes,
        variant: "purple",
      },
      {
        icon: "🛡️",
        label: "Total Admins",
        value: dashboard.totalAdmins,
        variant: "orange",
      },
      {
        icon: "⭐",
        label: "Featured Notes",
        value: dashboard.featuredNotes,
        variant: "green",
      },
      {
        icon: "🤖",
        label: "AI Usage",
        value:
          dashboard.aiUsageCount || dashboard.aiRequests || dashboard.aiSummaries,
        variant: "purple",
      },
      {
        icon: "⚡",
        label: "Active Users",
        value: dashboard.activeUsers,
        variant: "green",
      },
      {
        icon: "📝",
        label: "Quizzes Created",
        value: dashboard.quizzesCreated,
        variant: "blue",
      },
      {
        icon: "📤",
        label: "Files Uploaded",
        value: dashboard.filesUploaded || dashboard.totalNotes,
        variant: "orange",
      },
    ],
    [dashboard]
  );

  const analyticsMetrics = useMemo(
    () => [
      {
        icon: "👥",
        label: "Total Users",
        value: dashboard.totalUsers,
      },
      {
        icon: "📁",
        label: "Total Notes",
        value: dashboard.totalNotes,
      },
      {
        icon: "🤖",
        label: "AI Requests",
        value:
          dashboard.aiUsageCount || dashboard.aiRequests || dashboard.aiSummaries,
      },
      {
        icon: "📝",
        label: "Quizzes Created",
        value: dashboard.quizzesCreated,
      },
    ],
    [dashboard]
  );

  const aiUsageChartValues =
    Array.isArray(dashboard.aiUsage) &&
    dashboard.aiUsage.some((v) => Number(v) > 0)
      ? dashboard.aiUsage
      : [0, 0, 0, 0, 0, 0, dashboard.aiUsageCount || 0];

  const quizAndSummaryValues = [
    dashboard.quizzesCreated || 0,
    dashboard.aiSummaries || 0,
    dashboard.aiUsageCount || 0,
    dashboard.totalNotes || 0,
    dashboard.activeUsers || 0,
  ];

  const scrollToSection = (id) => {
    const element = document.getElementById(id);

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  };

  const handleFeatureClick = (path) => {
    if (!path) return;

    if (path.startsWith("#")) {
      scrollToSection(path.replace("#", ""));
      return;
    }

    navigate(path);
  };

  const featureCards = [
    {
      title: "User Management",
      icon: "👤",
      variant: "blue",
      path: "/admin/users",
      points: [
        "Add / Update / Delete Users",
        "Role Control Admin / Student",
        "Search & Filters",
      ],
    },
    {
      title: "Notes Management",
      icon: "📚",
      variant: "green",
      path: "/admin/notes",
      points: [
        "View / Delete Notes",
        "Reprocess Notes",
        "File Filters & Status",
      ],
    },
    {
  title: "AI Management",
  icon: "🤖",
  variant: "purple",
  path: "/admin/ai-management",
  points: [
    "Summary Stats",
    "Quiz Stats",
    "AI Usage Reports",
  ],
},
    {
      title: "Quiz Management",
      icon: "✅",
      variant: "orange",
      path: "#quiz-table",
      points: [
        {
          label: "View / Edit Quizzes",
          action: () => scrollToSection("quiz-table"),
        },
        {
          label: "Regenerate Quizzes",
          action: () => navigate("/quiz"),
        },
      ],
    },
  ];

const bottomCards = [
  {
    title: "Announcements",
    icon: "📣",
    variant: "orange",
    path: "/admin/announcements",
    points: [
      {
        label: "Post Updates",
        action: () => navigate("/admin/announcements"),
      },
      {
        label: "Manage Alerts",
        action: () => navigate("/admin/announcements"),
      },
    ],
  },
  {
    title: "Featured Materials",
    icon: "⭐",
    variant: "green",
    path: "/admin/notes?focus=featured",
    points: [
      {
        label: "Highlight Notes",
        action: () => navigate("/admin/notes?focus=featured"),
      },
      {
        label: "Promote Content",
        action: () => navigate("/admin/notes?section=featured"),
      },
    ],
  },
  {
    title: "Reports & Feedback",
    icon: "⚠️",
    variant: "blue",
    path: "/admin/feedback",
    points: [
      {
        label: "Review Issues",
        action: () => navigate("/admin/feedback"),
      },
      {
        label: "User Reports",
        action: () => navigate("/admin/feedback"),
      },
    ],
  },
  {
    title: "System Settings",
    icon: "⚙️",
    variant: "purple",
    path: "/admin/settings",
    points: [
      {
        label: "File Limits",
        action: () => navigate("/admin/settings"),
      },
      {
        label: "AI Options",
        action: () => navigate("/admin/settings"),
      },
    ],
  },
];
  return (
    <div className="admin-feature-page">
      <style>{`
        .admin-feature-page {
          min-height: 100%;
          padding: 24px;
          background:
            radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 30%),
            linear-gradient(180deg, #f7fbff 0%, #eef6ff 100%);
          color: #172033;
        }

        .admin-feature-shell {
          width: 100%;
          max-width: none;
          margin: 0;
        }

        .admin-feature-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }

        .admin-feature-title-mini {
          font-size: 14px;
          color: #64748b;
          margin: 0 0 4px;
        }

        .admin-feature-top h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 800;
          color: #0f172a;
        }

        .refresh-btn {
          border: 0;
          background: #ffffff;
          color: #1d4ed8;
          border-radius: 16px;
          padding: 13px 18px;
          font-weight: 800;
          box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);
          cursor: pointer;
          transition: 0.2s ease;
        }

        .refresh-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 16px 30px rgba(15, 23, 42, 0.12);
        }

        .refresh-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .admin-hero {
          position: relative;
          overflow: hidden;
          border-radius: 26px;
          padding: 26px 22px;
          margin-bottom: 22px;
          text-align: center;
          color: white;
          background: linear-gradient(135deg, #1e63b6 0%, #2f8df0 55%, #43b4ff 100%);
          box-shadow: 0 18px 35px rgba(37, 99, 235, 0.24);
        }

        .admin-hero::before,
        .admin-hero::after {
          content: "";
          position: absolute;
          top: 18px;
          width: 150px;
          height: 42px;
          background: rgba(15, 71, 145, 0.55);
          transform: skewX(-22deg);
        }

        .admin-hero::before {
          left: -55px;
        }

        .admin-hero::after {
          right: -55px;
        }

        .admin-hero h2 {
          position: relative;
          margin: 0;
          font-size: clamp(30px, 5vw, 56px);
          line-height: 1;
          letter-spacing: 1px;
          font-weight: 950;
          text-transform: uppercase;
          text-shadow: 0 4px 10px rgba(15, 23, 42, 0.25);
        }

        .admin-hero p {
          position: relative;
          display: inline-block;
          margin: 12px 0 0;
          padding: 8px 28px;
          border-radius: 0 0 18px 18px;
          background: rgba(15, 71, 145, 0.55);
          font-size: 20px;
          font-weight: 800;
        }

        .admin-alert {
          margin-bottom: 18px;
          padding: 14px 16px;
          border-radius: 18px;
          background: #fff7ed;
          color: #9a3412;
          border: 1px solid #fed7aa;
          font-weight: 700;
        }

        .top-stats-grid,
        .admin-feature-grid,
        .bottom-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 18px;
        }

        .small-stat-card {
          display: flex;
          align-items: center;
          gap: 14px;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 22px;
          padding: 18px;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
        }

        .small-stat-card span {
          display: grid;
          place-items: center;
          width: 52px;
          height: 52px;
          border-radius: 17px;
          font-size: 26px;
        }

        .small-stat-card.blue span {
          background: #dbeafe;
        }

        .small-stat-card.purple span {
          background: #ede9fe;
        }

        .small-stat-card.green span {
          background: #dcfce7;
        }

        .small-stat-card.orange span {
          background: #ffedd5;
        }

        .small-stat-card strong {
          display: block;
          font-size: 28px;
          color: #0f172a;
          line-height: 1;
        }

        .small-stat-card p {
          margin: 7px 0 0;
          color: #64748b;
          font-size: 13px;
          font-weight: 800;
        }

        .admin-feature-card {
          position: relative;
          overflow: hidden;
          min-height: 190px;
          text-align: left;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.94);
          border-radius: 22px;
          padding: 20px;
          cursor: pointer;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
          transition: 0.2s ease;
        }

        .admin-feature-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.13);
        }

        .admin-feature-card::after {
          content: "";
          position: absolute;
          right: -28px;
          bottom: -35px;
          width: 130px;
          height: 130px;
          border-radius: 999px;
          opacity: 0.16;
        }

        .admin-feature-card.blue::after {
          background: #2563eb;
        }

        .admin-feature-card.green::after {
          background: #16a34a;
        }

        .admin-feature-card.purple::after {
          background: #7c3aed;
        }

        .admin-feature-card.orange::after {
          background: #f97316;
        }

        .admin-feature-card-head {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .admin-feature-card h3 {
          margin: 0;
          color: #164b8f;
          font-size: clamp(20px, 1.35vw, 23px);
          line-height: 1.35;
          font-weight: 950;
          flex: 1;
          min-width: 0;
        }

        .admin-feature-card-head span {
          display: grid;
          place-items: center;
          width: 54px;
          height: 54px;
          min-width: 54px;
          flex: 0 0 54px;
          border-radius: 18px;
          background: #eff6ff;
          font-size: 28px;
          position: relative;
          z-index: 3;
        }

        .admin-feature-line {
          position: relative;
          z-index: 1;
          height: 1px;
          margin: 13px 0;
          background: linear-gradient(90deg, #bfdbfe, transparent);
        }

        .admin-feature-card ul {
          position: relative;
          z-index: 1;
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 12px;
        }

        .admin-feature-card li {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #16406f;
          font-weight: 800;
          font-size: 15px;
        }

        .admin-feature-point-btn {
          border: 0;
          background: transparent;
          padding: 0;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 10px;
          color: #16406f;
          font-weight: 800;
          font-size: 15px;
          text-align: left;
          cursor: pointer;
          transition: 0.2s ease;
        }

        .admin-feature-point-btn:hover {
          color: #2563eb;
          transform: translateX(3px);
        }

        .dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          flex: 0 0 auto;
        }

        .dot-1 {
          background: #fbbf24;
        }

        .dot-2 {
          background: #22c55e;
        }

        .dot-3 {
          background: #60a5fa;
        }

        .analytics-card,
        .admin-table-card,
        .system-card,
        .activity-card {
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 24px;
          box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08);
          overflow: hidden;
        }

        .analytics-card {
          margin-bottom: 18px;
          padding: 22px;
        }

        .section-heading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-bottom: 18px;
          color: #164b8f;
        }

        .section-heading::before,
        .section-heading::after {
          content: "";
          height: 2px;
          flex: 1;
          background: linear-gradient(90deg, transparent, #bfdbfe, transparent);
        }

        .section-heading h2 {
          margin: 0;
          font-size: 28px;
          font-weight: 950;
          white-space: nowrap;
        }

        .metrics-row {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          border: 1px solid #dbeafe;
          border-radius: 18px;
          overflow: hidden;
          margin-bottom: 18px;
          background: #f8fbff;
        }

        .admin-metric-box {
          display: flex;
          align-items: center;
          gap: 13px;
          padding: 17px;
          border-right: 1px solid #dbeafe;
        }

        .admin-metric-box:last-child {
          border-right: 0;
        }

        .metric-icon {
          display: grid;
          place-items: center;
          width: 48px;
          height: 48px;
          border-radius: 16px;
          background: #dbeafe;
          font-size: 25px;
        }

        .admin-metric-box strong {
          display: block;
          font-size: 26px;
          color: #0f172a;
          line-height: 1;
        }

        .admin-metric-box p {
          margin: 5px 0 0;
          color: #475569;
          font-size: 13px;
          font-weight: 800;
        }

        .analytics-content {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .chart-panel {
          border: 1px solid #dbeafe;
          border-radius: 18px;
          padding: 18px;
          background: #ffffff;
        }

        .chart-panel h3 {
          margin: 0 0 6px;
          color: #0f172a;
          font-size: 17px;
          font-weight: 950;
        }

        .chart-panel p {
          margin: 0 0 14px;
          color: #64748b;
          font-size: 13px;
          font-weight: 700;
        }

        .mini-chart {
          height: 150px;
          width: 100%;
          border-radius: 18px;
          background:
            repeating-linear-gradient(
              to bottom,
              #ffffff,
              #ffffff 27px,
              #eef2ff 28px
            );
          padding: 8px;
        }

        .mini-chart svg {
          width: 100%;
          height: 100%;
        }

        .mini-chart polyline {
          stroke: #6366f1;
        }

        .mini-chart circle {
          fill: #6366f1;
        }

        .mini-bars {
          height: 150px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 10px;
          padding: 14px;
          border-radius: 18px;
          background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
        }

        .mini-bars span {
          width: 28px;
          border-radius: 9px 9px 4px 4px;
          background: linear-gradient(180deg, #818cf8, #6366f1);
          min-height: 12px;
        }

        .table-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 18px;
        }

        .admin-table-card {
          min-width: 0;
        }

        .admin-table-card h3,
        .system-card h3,
        .activity-card h3 {
          margin: 0;
          padding: 16px 18px;
          color: #164b8f;
          font-size: 22px;
          font-weight: 950;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fbff;
        }

        .table-scroll {
          overflow-x: auto;
        }

        .admin-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 520px;
        }

        .admin-table th {
          text-align: left;
          padding: 12px 14px;
          background: #f1f5f9;
          color: #475569;
          font-size: 12px;
          text-transform: uppercase;
        }

        .admin-table td {
          padding: 13px 14px;
          border-top: 1px solid #e2e8f0;
          color: #334155;
          font-size: 14px;
          font-weight: 700;
        }

        .status-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 5px 10px;
          background: #dcfce7;
          color: #15803d;
          font-size: 12px;
          font-weight: 950;
          text-transform: capitalize;
        }

        .status-pill.generated {
          background: #dbeafe;
          color: #1d4ed8;
        }

        .status-pill.pending {
          background: #fef3c7;
          color: #92400e;
        }

        .status-pill.failed {
          background: #fee2e2;
          color: #b91c1c;
        }

        .role-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 5px 10px;
          background: #ede9fe;
          color: #6d28d9;
          font-size: 12px;
          font-weight: 950;
          text-transform: capitalize;
        }

        .empty-row {
          text-align: center;
          color: #94a3b8 !important;
          padding: 20px !important;
        }

        .final-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .system-list,
        .activity-list {
          padding: 16px 18px 18px;
          display: grid;
          gap: 12px;
        }

        .system-item,
        .activity-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 13px 14px;
          border-radius: 16px;
          background: #f8fbff;
          border: 1px solid #e2e8f0;
        }

        .system-item span,
        .activity-item span {
          color: #334155;
          font-weight: 800;
          font-size: 14px;
        }

        .system-item strong,
        .activity-item strong {
          color: #0f172a;
          font-size: 14px;
        }

        .activity-item {
          justify-content: flex-start;
        }

        .activity-icon {
          display: grid;
          place-items: center;
          width: 40px;
          height: 40px;
          border-radius: 14px;
          background: #dbeafe;
          flex: 0 0 auto;
        }

        .activity-text {
          display: grid;
          gap: 3px;
        }

        .activity-text p {
          margin: 0;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        @media (max-width: 1180px) {
          .admin-feature-grid,
          .bottom-grid,
          .top-stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .table-grid,
          .analytics-content,
          .final-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .admin-feature-page {
            min-height: calc(100vh - 60px);
            width: 100%;
            padding: 24px 32px;
            margin: 0;
            background:
              radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 30%),
              linear-gradient(180deg, #f7fbff 0%, #eef6ff 100%);
            color: #172033;
            box-sizing: border-box;
          }

          .admin-feature-shell {
            width: 100%;
            max-width: 100%;
            margin: 0;
          }

          .admin-feature-top {
            align-items: flex-start;
            flex-direction: column;
          }

          .refresh-btn {
            width: 100%;
          }

          .admin-feature-grid,
          .bottom-grid,
          .metrics-row,
          .top-stats-grid {
            grid-template-columns: 1fr;
          }

          .admin-metric-box {
            border-right: 0;
            border-bottom: 1px solid #dbeafe;
          }

          .admin-metric-box:last-child {
            border-bottom: 0;
          }

          .section-heading h2 {
            font-size: 22px;
          }

          .admin-hero p {
            font-size: 16px;
          }
        }
      `}</style>

      <div className="admin-feature-shell">
        <div className="admin-feature-top">
          <div>
            <p className="admin-feature-title-mini">
              Overview of your Studyflow system
            </p>
            <h1>Admin Dashboard</h1>
          </div>

          <button className="refresh-btn" onClick={loadDashboard} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <section className="admin-hero">
          <h2>Admin Dashboard Features</h2>
          <p>For Study Platform</p>
        </section>

        {error && <div className="admin-alert">{error}</div>}

        <section className="top-stats-grid">
          {topStats.map((stat) => (
            <SmallStatCard key={stat.label} {...stat} />
          ))}
        </section>

        <section className="admin-feature-grid">
          {featureCards.map((card) => (
            <FeatureCard
              key={card.title}
              {...card}
              onClick={() => handleFeatureClick(card.path)}
            />
          ))}
        </section>

        <section id="analytics-section" className="analytics-card">
          <div className="section-heading">
            <h2>Analytics Dashboard</h2>
          </div>

          <div className="metrics-row">
            {analyticsMetrics.map((metric) => (
              <MetricBox key={metric.label} {...metric} />
            ))}
          </div>

          <div className="analytics-content">
            <div className="chart-panel">
              <h3>Users Growth</h3>
              <p>New users created per day</p>
              <MiniLineChart values={dashboard.userGrowth} />
            </div>

            <div className="chart-panel">
              <h3>Notes Uploads</h3>
              <p>Notes created per day</p>
              <MiniBarChart values={dashboard.notesGrowth} />
            </div>

            <div id="ai-usage-section" className="chart-panel">
              <h3>AI Usage</h3>
              <p>AI requests / Ask Note usage</p>
              <MiniLineChart values={aiUsageChartValues} />
            </div>

            <div className="chart-panel">
              <h3>Quiz And Summary Stats</h3>
              <p>Quizzes and summaries activity</p>
              <MiniBarChart values={quizAndSummaryValues} />
            </div>
          </div>
        </section>

        <section className="bottom-grid">
  {bottomCards.map((card) => (
    <FeatureCard
      key={card.title}
      {...card}
      onClick={() => handleFeatureClick(card.path)}
    />
  ))}
</section>
        <section className="table-grid">
          <div className="admin-table-card">
            <h3>Users Table</h3>

            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>

                <tbody>
                  {dashboard.recentUsers.length > 0 ? (
                    dashboard.recentUsers.slice(0, 5).map((user, index) => (
                      <tr key={user.id ?? user.email ?? index}>
                        <td>{user.name ?? user.username ?? "User"}</td>
                        <td>{user.email ?? "-"}</td>
                        <td>
                          <span className="role-pill">
                            {user.role ?? (user.is_admin ? "admin" : "user")}
                          </span>
                        </td>
                        <td>
                          <StatusPill>{user.status ?? "active"}</StatusPill>
                        </td>
                        <td>{formatDate(user.created_at ?? user.createdAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="empty-row" colSpan="5">
                        No recent users
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="admin-table-card">
            <h3>Notes Table</h3>

            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>User</th>
                    <th>Source</th>
                    <th>Featured</th>
                    <th>Created</th>
                  </tr>
                </thead>

                <tbody>
                  {dashboard.recentNotes.length > 0 ? (
                    dashboard.recentNotes.slice(0, 5).map((note, index) => (
                      <tr key={note.id ?? note.title ?? index}>
                        <td>{note.title ?? "Untitled"}</td>
                        <td>
                          {note.user?.name ??
                            note.user_name ??
                            note.owner ??
                            "-"}
                        </td>
                        <td>{note.source ?? note.type ?? note.source_type ?? "file"}</td>
                        <td>
                          {note.is_featured || note.featured ? (
                            <StatusPill>Yes</StatusPill>
                          ) : (
                            <StatusPill type="pending">No</StatusPill>
                          )}
                        </td>
                        <td>{formatDate(note.created_at ?? note.createdAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="empty-row" colSpan="5">
                        No recent notes
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div id="quiz-table" className="admin-table-card">
            <h3>Quiz Table</h3>

            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Note</th>
                    <th>Questions</th>
                    <th>Grade</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>

                <tbody>
                  {dashboard.recentQuizzes.length > 0 ? (
                    dashboard.recentQuizzes.slice(0, 5).map((quiz, index) => (
                      <tr key={quiz.id ?? index}>
                        <td>{quiz.note?.title ?? quiz.note_title ?? "Quiz"}</td>

                        <td>
                          {quiz.questions_count ??
                            quiz.number_of_questions ??
                            quiz.questions?.length ??
                            5}
                        </td>

                        <td>
                          {quiz.grade ??
                            quiz.score ??
                            quiz.percentage ??
                            "-"}
                        </td>

                        <td>
                          <StatusPill type="generated">
                            {quiz.status ?? "generated"}
                          </StatusPill>
                        </td>

                        <td>{formatDate(quiz.created_at ?? quiz.createdAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="empty-row" colSpan="5">
                        No recent quizzes
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div id="summary-table" className="admin-table-card">
            <h3>Summary Table</h3>

            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Note</th>
                    <th>User</th>
                    <th>Status</th>
                    <th>Words</th>
                    <th>Created</th>
                  </tr>
                </thead>

                <tbody>
                  {dashboard.recentSummaries.length > 0 ? (
                    dashboard.recentSummaries
                      .slice(0, 5)
                      .map((summary, index) => (
                        <tr key={summary.id ?? index}>
                          <td>
                            {summary.note?.title ??
                              summary.note_title ??
                              summary.title ??
                              "Summary"}
                          </td>

                          <td>
                            {summary.user?.name ??
                              summary.user_name ??
                              summary.owner ??
                              "-"}
                          </td>

                          <td>
                            <StatusPill type="generated">
                              {summary.status ?? "generated"}
                            </StatusPill>
                          </td>

                          <td>
                            {summary.words_count ??
                              summary.word_count ??
                              summary.length ??
                              "-"}
                          </td>

                          <td>
                            {formatDate(summary.created_at ?? summary.createdAt)}
                          </td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td className="empty-row" colSpan="5">
                        No recent summaries
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="final-grid">
        <div id="system-health" className="system-card">
            <h3>System Health</h3>

            <div className="system-list">
              <div className="system-item">
                <span>Laravel API</span>
                <StatusPill>Online</StatusPill>
              </div>

              <div className="system-item">
                <span>Admin Dashboard API</span>
                <StatusPill>{error ? "Check" : "Online"}</StatusPill>
              </div>

              <div className="system-item">
                <span>Summary Service</span>
                <StatusPill type="generated">Connected</StatusPill>
              </div>

              <div className="system-item">
                <span>Quiz Generator</span>
                <StatusPill type="generated">Ready</StatusPill>
              </div>

              <div className="system-item">
                <span>Current AI Model</span>
                <strong>Local Ollama</strong>
              </div>
            </div>
          </div>

        <div id="recent-activity" className="activity-card">
            <h3>Recent Activity</h3>

            <div className="activity-list">
              {dashboard.recentActivity.length > 0 ? (
                dashboard.recentActivity.slice(0, 5).map((activity, index) => (
                  <div className="activity-item" key={activity.id ?? index}>
                    <span className="activity-icon">
                      {activity.icon ?? "🔔"}
                    </span>

                    <div className="activity-text">
                      <strong>
                        {activity.title ??
                          activity.message ??
                          activity.description ??
                          "New activity"}
                      </strong>
                      <p>{formatDate(activity.created_at ?? activity.createdAt)}</p>
                    </div>
                  </div>
                ))
              ) : (
                <>
                  <div className="activity-item">
                    <span className="activity-icon">👥</span>
                    <div className="activity-text">
                      <strong>Users are tracked from the admin dashboard</strong>
                      <p>Live user management overview</p>
                    </div>
                  </div>

                  <div className="activity-item">
                    <span className="activity-icon">📁</span>
                    <div className="activity-text">
                      <strong>Notes uploads appear in the notes table</strong>
                      <p>View uploaded study materials</p>
                    </div>
                  </div>

                  <div className="activity-item">
                    <span className="activity-icon">🤖</span>
                    <div className="activity-text">
                      <strong>AI summaries are monitored here</strong>
                      <p>Summary table and AI usage charts</p>
                    </div>
                  </div>

                  <div className="activity-item">
                    <span className="activity-icon">📝</span>
                    <div className="activity-text">
                      <strong>Generated quizzes are shown in Quiz Table</strong>
                      <p>Questions, grade, status, and creation date</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}