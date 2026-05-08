import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

function HamburgerIcon() {
    return (
        <svg
            width="20"
            height="20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
            />
        </svg>
    );
}

const pageTitles = {
    "/dashboard": "Dashboard",
    "/notes": "My Notes",
    "/admin": "Admin Dashboard",
    "/admin/users": "Admin Users",
    "/admin/notes": "Admin Notes",
};

export default function Topbar({ onMenuToggle }) {
    const { user } = useAuth();
    const location = useLocation();

    const title =
        pageTitles[location.pathname] ||
        (location.pathname.startsWith("/notes/")
            ? "Note Details"
            : "Studyflow");

    const initials = user?.name
        ? user.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()
        : "U";

    return (
        <header className="topbar">
            <div className="topbar-left">
                <button
                    className="hamburger"
                    onClick={onMenuToggle}
                    aria-label="Toggle menu"
                >
                    <HamburgerIcon />
                </button>
                <span className="topbar-title">{title}</span>
            </div>

            <div className="topbar-right">
                {user && (
                    <div className="topbar-user-pill">
                        <div className="topbar-avatar">{initials}</div>
                        <span>{user.name || user.email}</span>
                    </div>
                )}
            </div>
        </header>
    );
}
