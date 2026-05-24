import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axiosClient from '../api/axiosClient.js';

function formatNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function formatDate(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function getPayload(res) {
  return res?.data?.data || res?.data || {};
}

function pillClass(type) {
  if (type === 'success' || type === 'online' || type === 'active') {
    return 'bg-green-100 text-green-700';
  }

  if (type === 'warning' || type === 'ready') {
    return 'bg-yellow-100 text-yellow-700';
  }

  if (type === 'danger' || type === 'error') {
    return 'bg-red-100 text-red-700';
  }

  if (type === 'admin' || type === 'connected' || type === 'generated') {
    return 'bg-blue-100 text-blue-700';
  }

  return 'bg-slate-100 text-slate-700';
}

function StatCard({ icon, title, value, subtitle }) {
  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-2xl">
          {icon}
        </div>

        <div>
          <div className="text-3xl font-black text-slate-950">{formatNumber(value)}</div>
          <div className="text-sm font-bold text-slate-600">{title}</div>
          {subtitle ? <div className="mt-1 text-xs text-slate-400">{subtitle}</div> : null}
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ title, icon, items, shapeClass }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-blue-100 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-2xl font-black leading-tight text-blue-900">{title}</h3>

          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-2xl">
            {icon}
          </div>
        </div>

        <div className="mt-4 h-px bg-blue-100" />

        <div className="mt-4 space-y-3">
          {(items || []).map((item, index) => {
            const label = typeof item === 'string' ? item : item.label;
            const onClick = typeof item === 'string' ? null : item.onClick;

            return (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className="flex w-full items-start gap-3 rounded-xl px-2 py-1.5 text-left text-sm font-bold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700"
              >
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                    index === 0 ? 'bg-yellow-400' : index === 1 ? 'bg-green-500' : 'bg-blue-400'
                  }`}
                />

                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={`absolute -bottom-8 -right-8 h-32 w-32 rounded-full opacity-50 ${shapeClass}`} />
    </div>
  );
}

function SimpleLineChart({ values }) {
  const data = Array.isArray(values) && values.length ? values.map((v) => Number(v || 0)) : [0];
  const width = 520;
  const height = 180;
  const padding = 34;
  const max = Math.max(...data, 1);
  const step = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;

  const points = data.map((value, index) => {
    const x = padding + index * step;
    const y = height - padding - (value / max) * (height - padding * 2);

    return { x, y, value };
  });

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div className="w-full overflow-hidden rounded-2xl bg-white">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e5e7eb" />
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#f1f5f9" />

        <path d={path} fill="none" stroke="#6366f1" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, index) => (
          <g key={index}>
            <circle cx={p.x} cy={p.y} r="5" fill="#6366f1" />

            {index % labelEvery === 0 || index === points.length - 1 ? (
              <text x={p.x} y={Math.max(16, p.y - 12)} textAnchor="middle" fontSize="14" fontWeight="800" fill="#020617">
                {p.value}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

function SimpleBarChart({ values }) {
  const data = Array.isArray(values) && values.length ? values.map((v) => Number(v || 0)) : [0];
  const max = Math.max(...data, 1);

  return (
    <div className="flex h-44 items-end gap-2 rounded-2xl bg-white px-2 pb-4 pt-8">
      {data.map((value, index) => {
        const height = Math.max(8, (value / max) * 120);

        return (
          <div key={index} className="flex flex-1 flex-col items-center justify-end gap-2">
            <div className="text-xs font-black text-slate-950">{value}</div>
            <div className="w-full rounded-t-xl bg-indigo-500/80" style={{ height }} />
          </div>
        );
      })}
    </div>
  );
}

function ChartCard({ title, subtitle, type = 'line', values }) {
  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-black text-slate-950">{title}</h3>
      <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p>

      <div className="mt-5">
        {type === 'bar' ? <SimpleBarChart values={values} /> : <SimpleLineChart values={values} />}
      </div>
    </div>
  );
}

function TableCard({ title, children }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-blue-100 bg-white shadow-sm">
      <div className="border-b border-blue-100 px-5 py-4">
        <h3 className="text-2xl font-black text-blue-900">{title}</h3>
      </div>

      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function EmptyRow({ colSpan, text }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-10 text-center text-sm font-bold text-slate-400">
        {text}
      </td>
    </tr>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [users, setUsers] = useState([]);
const [activities, setActivities] = useState([]);
const [examReminders, setExamReminders] = useState([]);
const [quizReports, setQuizReports] = useState([]);
const [studyPlans, setStudyPlans] = useState([]);
const [adminLoading, setAdminLoading] = useState(false);

  const analyticsRef = useRef(null);
  const usersTableRef = useRef(null);
  const notesTableRef = useRef(null);
  const quizTableRef = useRef(null);
  const summaryTableRef = useRef(null);
  const systemHealthRef = useRef(null);
  const recentActivityRef = useRef(null);

  const scrollToSection = (ref) => {
    ref.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const showNotice = (message, ref = null) => {
    setNotice(message);

    if (ref) {
      setTimeout(() => scrollToSection(ref), 80);
    }

    setTimeout(() => {
      setNotice('');
    }, 3500);
  };

  const loadDashboard = useCallback(async () => {
    setError('');

    try {
      const res = await axiosClient.get('/admin/dashboard', {
        params: { days: 14 },
      });

      setDashboard(getPayload(res));
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to load admin dashboard.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);

    loadDashboard().finally(() => {
      setLoading(false);
    });
  }, [loadDashboard]);

  const refresh = async () => {
    setRefreshing(true);
    await loadDashboard();
    setRefreshing(false);
  };

  const stats = dashboard?.stats || {};
  const charts = dashboard?.charts || {};

  const recentUsers = dashboard?.recent_users || [];
  const recentNotes = dashboard?.recent_notes || [];
  const recentQuizzes = dashboard?.recent_quizzes || [];
  const recentSummaries = dashboard?.recent_summaries || [];
  const recentActivity = dashboard?.recent_activity || [];

  const systemHealth = useMemo(() => {
    return (
      dashboard?.system_health || [
        { name: 'Laravel API', status: 'Online', type: 'online' },
        { name: 'Admin Dashboard API', status: 'Online', type: 'online' },
        { name: 'Summary Service', status: 'Connected', type: 'connected' },
        { name: 'Quiz Generator', status: 'Ready', type: 'ready' },
        { name: 'Current AI Model', status: 'Local Ollama', type: 'default' },
      ]
    );
  }, [dashboard]);

  const mainStats = [
    {
      icon: '👥',
      title: 'Total Users',
      value: stats.total_users,
    },
    {
      icon: '📁',
      title: 'Total Notes',
      value: stats.total_notes,
    },
    {
      icon: '🛡️',
      title: 'Total Admins',
      value: stats.total_admins ?? stats.admin_users,
    },
    {
      icon: '⭐',
      title: 'Featured Notes',
      value: stats.featured_notes,
    },
    {
      icon: '🤖',
      title: 'AI Usage',
      value: stats.ai_usage_count ?? stats.ai_usage,
    },
    {
      icon: '⚡',
      title: 'Active Users',
      value: stats.active_users,
    },
    {
      icon: '📝',
      title: 'Quizzes Created',
      value: stats.quizzes_created ?? stats.quiz_count,
    },
    {
      icon: '📤',
      title: 'Files Uploaded',
      value: stats.files_uploaded,
    },
  ];

  const featureCards = [
    {
      title: 'User Management',
      icon: '👤',
      shapeClass: 'bg-blue-200',
      items: [
        {
          label: 'Add / Update / Delete Users',
          onClick: () => navigate('/admin/users'),
        },
        {
          label: 'Role Control Admin / Student',
          onClick: () => navigate('/admin/users?section=roles'),
        },
        {
          label: 'Search & Filters',
          onClick: () => navigate('/admin/users?focus=search'),
        },
      ],
    },
    {
      title: 'Notes Management',
      icon: '📚',
      shapeClass: 'bg-green-200',
      items: [
        {
          label: 'View / Delete Notes',
          onClick: () => navigate('/admin/notes'),
        },
        {
          label: 'Reprocess Notes',
          onClick: () => navigate('/admin/notes?section=reprocess'),
        },
        {
          label: 'File Filters & Status',
          onClick: () => navigate('/admin/notes?focus=filters'),
        },
      ],
    },
    {
      title: 'AI Management',
      icon: '🤖',
      shapeClass: 'bg-purple-200',
      items: [
        {
          label: 'Summary Stats',
          onClick: () => showNotice('Summary statistics are shown in the Summary Table.', summaryTableRef),
        },
        {
          label: 'Quiz Stats',
          onClick: () => showNotice('Quiz statistics are shown in the Quiz Table.', quizTableRef),
        },
        {
          label: 'AI Usage Reports',
          onClick: () => showNotice('AI usage reports are shown in the Analytics Dashboard.', analyticsRef),
        },
      ],
  
 {
  title: "Quiz Management",
  icon: "✅",
  variant: "orange",
  path: "/admin/quiz-management",
  points: [
    "View / Edit Quizzes",
    "Regenerate Quizzes",
  ],
},
  ];

  const secondaryFeatureCards = [
    {
      title: 'Announcements',
      icon: '📣',
      shapeClass: 'bg-orange-200',
      items: [
        {
          label: 'Post Updates',
          onClick: () => showNotice('Latest platform updates are shown in Recent Activity.', recentActivityRef),
        },
        {
          label: 'Manage Alerts',
          onClick: () => showNotice('Admin alerts are tracked in Recent Activity.', recentActivityRef),
        },
      ],
    },
    {
      title: 'Featured Materials',
      icon: '⭐',
      shapeClass: 'bg-green-200',
      items: [
        {
          label: 'Highlight Notes',
          onClick: () => navigate('/admin/notes?focus=featured'),
        },
        {
          label: 'Promote Content',
          onClick: () => navigate('/admin/notes?section=featured'),
        },
      ],
    },
    {
      title: 'Reports & Feedback',
      icon: '⚠️',
      shapeClass: 'bg-blue-200',
      items: [
        {
          label: 'Review Issues',
          onClick: () => showNotice('Reports and issues are shown through recent admin activity.', recentActivityRef),
        },
        {
          label: 'User Reports',
          onClick: () => showNotice('User reports are connected to admin activity and feedback records.', recentActivityRef),
        },
      ],
    },
    {
      title: 'System Settings',
      icon: '⚙️',
      shapeClass: 'bg-purple-200',
      items: [
        {
          label: 'File Limits',
          onClick: () => showNotice('File and service status are shown in System Health.', systemHealthRef),
        },
        {
          label: 'AI Options',
          onClick: () => showNotice('Current AI model and AI service status are shown in System Health.', systemHealthRef),
        },
      ],
    },
  ];
  

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="rounded-3xl bg-white px-8 py-6 text-center shadow-sm">
          <div className="text-lg font-black text-blue-900">Loading admin dashboard...</div>
          <div className="mt-2 text-sm text-slate-500">Please wait</div>
        </div>
      </div>
    );
  }
const loadAdminFeatures = async () => {
  try {
    setAdminLoading(true);

    const [
      usersRes,
      activitiesRes,
      remindersRes,
      reportsRes,
      plansRes,
    ] = await Promise.all([
      axiosClient.get("/admin/users"),
      axiosClient.get("/admin/recent-activities"),
      axiosClient.get("/admin/exam-reminders"),
      axiosClient.get("/admin/quiz-reports"),
      axiosClient.get("/admin/study-plans"),
    ]);

    setUsers(usersRes.data.users || []);
    setActivities(activitiesRes.data.activities || []);
    setExamReminders(remindersRes.data.reminders || []);
    setQuizReports(reportsRes.data.reports || []);
    setStudyPlans(plansRes.data.plans || []);
  } catch (error) {
    console.error(error);
  } finally {
    setAdminLoading(false);
  }
};

useEffect(() => {
  loadAdminFeatures();
}, []);
  return (
    <div className="w-full bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1500px] space-y-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold text-slate-500">Admin Dashboard</div>
            <h1 className="text-3xl font-black text-slate-950">Admin Dashboard</h1>
          </div>

          <div className="flex gap-3">
            <Link
              to="/dashboard"
              className="rounded-2xl border border-blue-100 bg-white px-4 py-2 text-sm font-bold text-blue-900 shadow-sm transition hover:bg-blue-50"
            >
              ← Back to dashboard
            </Link>

            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-3xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-3xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-bold text-blue-700">
            {notice}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-[2rem] bg-gradient-to-r from-blue-700 to-sky-400 p-8 text-center shadow-sm">
          <h2 className="text-4xl font-black tracking-tight text-white drop-shadow sm:text-5xl">
            ADMIN DASHBOARD FEATURES
          </h2>

          <div className="mx-auto mt-5 w-fit rounded-2xl bg-blue-900/35 px-8 py-3 text-lg font-black text-white">
            For Study Platform
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {mainStats.map((card) => (
            <StatCard key={card.title} {...card} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {featureCards.map((card) => (
            <FeatureCard key={card.title} {...card} />
          ))}
        </div>

        <section ref={analyticsRef} className="scroll-mt-6 rounded-[2rem] border border-blue-100 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-4">
            <div className="h-px flex-1 bg-blue-100" />
            <h2 className="text-center text-3xl font-black text-blue-900">Analytics Dashboard</h2>
            <div className="h-px flex-1 bg-blue-100" />
          </div>

          <div className="mb-5 grid grid-cols-1 overflow-hidden rounded-3xl border border-blue-100 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon="👥" title="Total Users" value={stats.total_users} />
            <StatCard icon="📁" title="Total Notes" value={stats.total_notes} />
            <StatCard icon="🤖" title="AI Requests" value={stats.ai_usage_count ?? stats.ai_usage} />
            <StatCard icon="📝" title="Quizzes Created" value={stats.quizzes_created ?? stats.quiz_count} />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ChartCard
              title="Users Growth"
              subtitle="New users created per day"
              values={charts.users_growth || charts.user_growth}
            />

            <ChartCard
              title="Notes Uploads"
              subtitle="Notes created per day"
              type="bar"
              values={charts.notes_uploads || charts.notes_growth}
            />

            <ChartCard
              title="AI Usage"
              subtitle="AI requests / Ask Note usage"
              values={charts.ai_usage}
            />

            <ChartCard
              title="Quiz And Summary Stats"
              subtitle="Quizzes and summaries activity"
              type="bar"
              values={[
                stats.quizzes_created ?? stats.quiz_count ?? 0,
                stats.ai_summaries ?? 0,
                stats.ai_usage_count ?? stats.ai_usage ?? 0,
                stats.total_notes ?? 0,
                stats.active_users ?? 0,
              ]}
            />
          </div>
        </section>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {secondaryFeatureCards.map((card) => (
            <FeatureCard key={card.title} {...card} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div ref={usersTableRef} className="scroll-mt-6">
            <TableCard title="Users Table">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Email</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {recentUsers.length === 0 ? (
                    <EmptyRow colSpan={5} text="No users found" />
                  ) : (
                    recentUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 font-bold text-slate-800">{user.name || '-'}</td>
                        <td className="px-5 py-4 font-bold text-slate-700">{user.email || '-'}</td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-black ${pillClass(user.role)}`}>
                            {user.is_admin ? 'Admin' : 'User'}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-black ${pillClass(user.status)}`}>
                            {user.status || 'active'}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-bold text-slate-600">{formatDate(user.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableCard>
          </div>

          <div ref={notesTableRef} className="scroll-mt-6">
            <TableCard title="Notes Table">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Title</th>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Source</th>
                    <th className="px-5 py-3">Featured</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {recentNotes.length === 0 ? (
                    <EmptyRow colSpan={5} text="No notes found" />
                  ) : (
                    recentNotes.map((note) => (
                      <tr key={note.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 font-bold text-slate-800">{note.title || 'Untitled'}</td>
                        <td className="px-5 py-4 font-bold text-slate-700">{note.user_name || note.user?.name || '-'}</td>
                        <td className="px-5 py-4 font-bold text-slate-700">{note.source || note.source_type || '-'}</td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-black ${
                              note.is_featured ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {note.is_featured ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-bold text-slate-600">{formatDate(note.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableCard>
          </div>

          <div ref={quizTableRef} className="scroll-mt-6">
            <TableCard title="Quiz Table">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Note</th>
                    <th className="px-5 py-3">Questions</th>
                    <th className="px-5 py-3">Grade</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {recentQuizzes.length === 0 ? (
                    <EmptyRow colSpan={5} text="No recent quizzes" />
                  ) : (
                    recentQuizzes.map((quiz) => (
                      <tr key={quiz.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 font-bold text-slate-800">{quiz.note_title || 'Quiz'}</td>
                        <td className="px-5 py-4 font-bold text-slate-700">{quiz.questions_count ?? 0}</td>
                        <td className="px-5 py-4 font-bold text-slate-700">{quiz.grade || '-'}</td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-black ${pillClass(quiz.status)}`}>
                            {quiz.status || 'generated'}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-bold text-slate-600">{formatDate(quiz.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableCard>
          </div>

          <div ref={summaryTableRef} className="scroll-mt-6">
            <TableCard title="Summary Table">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Note</th>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Words</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {recentSummaries.length === 0 ? (
                    <EmptyRow colSpan={5} text="No recent summaries" />
                  ) : (
                    recentSummaries.map((summary) => (
                      <tr key={summary.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 font-bold text-slate-800">{summary.note_title || summary.title || 'Summary'}</td>
                        <td className="px-5 py-4 font-bold text-slate-700">{summary.user_name || '-'}</td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-black ${pillClass(summary.status)}`}>
                            {summary.status || 'generated'}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-bold text-slate-700">{summary.words_count ?? 0}</td>
                        <td className="px-5 py-4 font-bold text-slate-600">{formatDate(summary.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableCard>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div ref={systemHealthRef} className="scroll-mt-6 rounded-3xl border border-blue-100 bg-white shadow-sm">
            <div className="border-b border-blue-100 px-5 py-4">
              <h3 className="text-2xl font-black text-blue-900">System Health</h3>
            </div>

            <div className="space-y-3 p-5">
              {systemHealth.map((item) => (
                <div key={item.name} className="flex items-center justify-between rounded-2xl border border-blue-100 bg-slate-50 px-4 py-3">
                  <span className="font-black text-slate-700">{item.name}</span>
                  <span className={`rounded-full px-4 py-2 text-xs font-black ${pillClass(item.type)}`}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div ref={recentActivityRef} className="scroll-mt-6 rounded-3xl border border-blue-100 bg-white shadow-sm">
            <div className="border-b border-blue-100 px-5 py-4">
              <h3 className="text-2xl font-black text-blue-900">Recent Activity</h3>
            </div>

            <div className="space-y-3 p-5">
              {recentActivity.length === 0 ? (
                <div className="rounded-2xl border border-blue-100 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">
                  No recent activity
                </div>
              ) : (
                recentActivity.map((activity, index) => (
                  <div
                    key={`${activity.title}-${index}`}
                    className="flex items-center gap-4 rounded-2xl border border-blue-100 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-xl">
                      {activity.icon || '📌'}
                    </div>

                    <div>
                      <div className="font-black text-slate-800">{activity.title}</div>
                      <div className="text-sm font-bold text-slate-400">{formatDate(activity.created_at)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}