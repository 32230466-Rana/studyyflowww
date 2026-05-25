import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { PageSpinner } from "../components/Spinner.jsx";

export default function AdminRoute() {
    const { user, token, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return <PageSpinner />;
    }

    if (!token) {
        console.warn("ADMIN ROUTE REJECTED:", {
            reason: "no_token",
            path: location.pathname,
        });

        return (
            <Navigate to="/login" replace state={{ from: location.pathname }} />
        );
    }

    if (!user?.is_admin) {
        console.warn("ADMIN ROUTE REJECTED:", {
            reason: "not_admin",
            path: location.pathname,
            userId: user?.id,
            email: user?.email,
        });

        return <Navigate to="/dashboard" replace />;
    }

    return <Outlet />;
}
