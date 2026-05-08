import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import AdminRoute from "./routes/AdminRoute.jsx";
import AppLayout from "./components/AppLayout.jsx";
import AdminLayout from "./components/AdminLayout.jsx";

import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import VerifyEmailPage from "./pages/VerifyEmailPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import NotesPage from "./pages/NotesPage.jsx";
import NoteDetailsPage from "./pages/NoteDetailsPage.jsx";
import AiToolsPage from "./pages/AiToolsPage.jsx";
import QuizPage from "./pages/QuizPage.jsx";
import SummariesPage from "./pages/SummariesPage.jsx";
import AdminDashboardPage from "./pages/AdminDashboardPage.jsx";
import AdminUsersPage from "./pages/AdminUsersPage.jsx";
import AdminNotesPage from "./pages/AdminNotesPage.jsx";
import { useAuth } from "./auth/AuthContext.jsx";

function App() {
    const { token } = useAuth();

    return (
        <Routes>
            {/* Admin routes */}
            <Route element={<AdminRoute />}>
                <Route element={<AdminLayout />}>
                    <Route path="/admin" element={<AdminDashboardPage />} />
                    <Route path="/admin/users" element={<AdminUsersPage />} />
                    <Route path="/admin/notes" element={<AdminNotesPage />} />
                </Route>
            </Route>

            {/* Root redirect */}
            <Route
                path="/"
                element={<Navigate to={token ? "/dashboard" : "/login"} replace />}
            />

            {/* Public auth pages */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />

            {/* Quiz page */}
            <Route element={<ProtectedRoute />}>
                <Route path="/quiz" element={<QuizPage />} />
                <Route path="/quiz/:id" element={<QuizPage />} />
            </Route>

            {/* Protected pages */}
            <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/notes" element={<NotesPage />} />
                    <Route path="/notes/:id" element={<NoteDetailsPage />} />
                    <Route path="/ai-tools" element={<AiToolsPage />} />
                    <Route path="/summaries" element={<SummariesPage />} />
                </Route>
            </Route>

            {/* 404 */}
            <Route
                path="*"
                element={
                    <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>
                        Page not found.{" "}
                        <a href="/dashboard" style={{ color: "#6366f1" }}>
                            Go home
                        </a>
                    </div>
                }
            />
        </Routes>
    );
}

export default App;