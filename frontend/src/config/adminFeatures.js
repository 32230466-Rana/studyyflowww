const enabled = (value) => String(value ?? "true").toLowerCase() !== "false";

export const adminFeatures = {
  dashboard: enabled(import.meta.env.VITE_ADMIN_DASHBOARD_ENABLED),
  users: enabled(import.meta.env.VITE_ADMIN_USERS_ENABLED),
  notes: enabled(import.meta.env.VITE_ADMIN_NOTES_ENABLED),
  aiUsage: enabled(import.meta.env.VITE_ADMIN_AI_USAGE_ENABLED),
  feedback: enabled(import.meta.env.VITE_ADMIN_FEEDBACK_ENABLED),
  announcements: enabled(import.meta.env.VITE_ADMIN_ANNOUNCEMENTS_ENABLED),
  activityLogs: enabled(import.meta.env.VITE_ADMIN_ACTIVITY_LOGS_ENABLED),
};

export const featureDisabledMessage = "This feature is temporarily disabled.";
