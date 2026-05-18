import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

// ---- Icons -------------------------------------------------------
function LightbulbIcon() {
    return (
        <svg
            className="sidebar-icon"
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.9 1.2 1.5 1.5 2.5" />
            <path d="M9 18h6" />
            <path d="M10 22h4" />
        </svg>
    );
}

function MessageSquareTextIcon() {
    return (
        <svg
            className="sidebar-icon"
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M13 8H7" />
            <path d="M17 12H7" />
        </svg>
    );
}

function DashboardIcon() {
    return (
        <svg
            className="sidebar-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
        </svg>
    );
}

function NotesIcon() {
    return (
        <svg
            className="sidebar-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
        </svg>
    );
}

function SparklesIcon() {
    return (
        <svg
            className="sidebar-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
            />
        </svg>
    );
}

function QuizIcon() {
    return (
        <svg
            className="sidebar-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
        </svg>
    );
}

function StudyPlanIcon() {
    return (
        <svg
            className="sidebar-icon"
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <path d="M8 14h.01" />
            <path d="M12 14h.01" />
            <path d="M16 14h.01" />
            <path d="M8 18h.01" />
            <path d="M12 18h.01" />
        </svg>
    );
}

function LogoutIcon() {
    return (
        <svg
            className="sidebar-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
        </svg>
    );
}

function BookOpenIcon() {
    return (
        <svg
            width="16"
            height="16"
            fill="none"
            viewBox="0 0 24 24"
            stroke="white"
            strokeWidth="2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
        </svg>
    );
}
// ------------------------------------------------------------------

export default function Sidebar({ open, onClose }) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        try {
            await logout();
        } finally {
            navigate("/login", { replace: true });
        }
    };

    const initials = user?.name
        ? user.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()
        : "U";

    return (
        <>
            {/* Mobile overlay */}
            <div
                className={`sidebar-overlay ${open ? "open" : ""}`}
                onClick={onClose}
            />

            <aside className={`sidebar ${open ? "open" : ""}`}>
                {/* Logo */}
                <NavLink
                    to="/dashboard"
                    className="sidebar-logo"
                    onClick={onClose}
                >
                    <div className="sidebar-logo-icon">
                        <BookOpenIcon />
                    </div>
                    <span className="sidebar-logo-text">Studyflow</span>
                </NavLink>

                {/* Nav */}
                <nav className="sidebar-nav">
                    <div className="sidebar-section-label">Navigation</div>

                    <NavLink
                        to="/dashboard"
                        className={({ isActive }) =>
                            `sidebar-link ${isActive ? "active" : ""}`
                        }
                        onClick={onClose}
                    >
                        <DashboardIcon />
                        Dashboard
                    </NavLink>

                    <NavLink
                        to="/notes"
                        className={({ isActive }) =>
                            `sidebar-link ${isActive ? "active" : ""}`
                        }
                        onClick={onClose}
                    >
                        <NotesIcon />
                        My Notes
                    </NavLink>

                    <NavLink
                        to="/summaries"
                        className={({ isActive }) =>
                            `sidebar-link ${isActive ? "active" : ""}`
                        }
                        onClick={onClose}
                    >
                        <NotesIcon />
                        My Summaries
                    </NavLink>

                    <NavLink
                        to="/quiz"
                        className={({ isActive }) =>
                            `sidebar-link ${isActive ? "active" : ""}`
                        }
                        onClick={onClose}
                    >
                        <QuizIcon />
                        Quiz Challenge
                    </NavLink>

                    <NavLink
                        to="/recommendations"
                        className={({ isActive }) =>
                            `sidebar-link ${isActive ? "active" : ""}`
                        }
                        onClick={onClose}
                    >
                        <LightbulbIcon />
                        Recommendations
                    </NavLink>

                    <NavLink
                        to="/study-plan"
                        className={({ isActive }) =>
                            `sidebar-link ${isActive ? "active" : ""}`
                        }
                        onClick={onClose}
                    >
                        <StudyPlanIcon />
                        Plan of Study
                    </NavLink>

                    <NavLink
                        to="/feedback"
                        className={({ isActive }) =>
                            `sidebar-link ${isActive ? "active" : ""}`
                        }
                        onClick={onClose}
                    >
                        <MessageSquareTextIcon />
                        Feedback
                    </NavLink>

                    <div
                        className="sidebar-section-label"
                        style={{ marginTop: 8 }}
                    >
                        AI Tools
                    </div>

                    <NavLink
                        to="/ai-tools"
                        className={({ isActive }) =>
                            `sidebar-link ${isActive ? "active" : ""}`
                        }
                        onClick={onClose}
                    >
                        <SparklesIcon />
                        AI Tools
                    </NavLink>
                </nav>

                {/* Footer */}
                <div className="sidebar-footer">
                    {user && (
                        <div className="sidebar-user">
                            <div className="sidebar-avatar">{initials}</div>
                            <div className="sidebar-user-info">
                                <div className="sidebar-user-name">
                                    {user.name}
                                </div>
                                <div className="sidebar-user-email">
                                    {user.email}
                                </div>
                            </div>
                        </div>
                    )}

                    <button
                        className="sidebar-link"
                        onClick={handleLogout}
                        type="button"
                    >
                        <LogoutIcon />
                        Sign out
                    </button>
                </div>
            </aside>
        </>
    );
}