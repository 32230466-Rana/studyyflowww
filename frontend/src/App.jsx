import { Navigate, Route, Routes } from "react-router-dom";

import MainPage from "./pages/MainPage.jsx";
import FeedbackPage from "./pages/FeedbackPage";
import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import AdminRoute from "./routes/AdminRoute.jsx";
import AppLayout from "./components/AppLayout.jsx";
import AdminLayout from "./components/AdminLayout.jsx";

import LinkSummaryPage from "./pages/LinkSummaryPage";
import StudyPlanPage from "./pages/StudyPlanPage.jsx";
import RecommendationPage from "./pages/RecommendationPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import VerifyEmailPage from "./pages/VerifyEmailPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import NotesPage from "./pages/NotesPage.jsx";
import NoteDetailsPage from "./pages/NoteDetailsPage.jsx";
import AiToolsPage from "./pages/AiToolsPage.jsx";
import SummariesPage from "./pages/SummariesPage.jsx";
import SavedChatPage from "./pages/SavedChatPage";
import QuizPage from "./pages/QuizPage.jsx";
import StudySummaryDesign from "./pages/StudySummaryDesign";
import OllamaQuizPage from "./pages/OllamaQuizPage.jsx";
import AdminDashboardPage from "./pages/AdminDashboardPage.jsx";
import AdminUsersPage from "./pages/AdminUsersPage.jsx";
import AdminNotesPage from "./pages/AdminNotesPage.jsx";
import AdminAnnouncementsPage from "./pages/AdminAnnouncementsPage.jsx";
import AdminFeedbackPage from "./pages/AdminFeedbackPage.jsx";
import AdminSettingsPage from "./pages/AdminSettingPage.jsx";
import AdminAiManagementPage from "./pages/AdminAiManagementPage.jsx";
import AdminQuizManagementPage from "./pages/AdminQuizManagementPage.jsx";

import { useAuth } from "./auth/AuthContext.jsx";

function App() {
  const { token } = useAuth();

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/"
        element={<Navigate to={token ? "/dashboard" : "/main"} replace />}
      />

      <Route path="/main" element={<MainPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/study-summary-design" element={<StudySummaryDesign />} />

      {/* Admin protected routes */}
      <Route element={<AdminRoute />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboardPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="notes" element={<AdminNotesPage />} />
          <Route path="announcements" element={<AdminAnnouncementsPage />} />
          <Route path="feedback" element={<AdminFeedbackPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
          <Route path="ai-management" element={<AdminAiManagementPage />} />
          <Route path="quizzes" element={<AdminQuizManagementPage />} />
        </Route>
      </Route>

      {/* User protected routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
<Route path="/ollama-quiz" element={<OllamaQuizPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/notes/:id" element={<NoteDetailsPage />} />
<Route path="/summaries/:id" element={<StudySummaryDesign />} />
          <Route path="/summaries" element={<SummariesPage />} />

          <Route path="/study-chat" element={<SavedChatPage />} />
          <Route path="/study-chat/:uuid" element={<SavedChatPage />} />

          <Route path="/recommendations" element={<RecommendationPage />} />
          <Route
            path="/recommendation"
            element={<Navigate to="/recommendations" replace />}
          />

          <Route path="/study-plan" element={<StudyPlanPage />} />
          <Route path="/feedback" element={<FeedbackPage />} />

          <Route path="/ai-tools" element={<AiToolsPage />} />
          <Route path="/link-summary" element={<LinkSummaryPage />} />

          <Route path="/quiz" element={<QuizPage />} />
          <Route path="/quiz/:id" element={<QuizPage />} />
          <Route path="/ai-tutor" element={<QuizPage />} />
        </Route>
      </Route>

      {/* Not found */}
      <Route
        path="*"
        element={
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: "#6b7280",
            }}
          >
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