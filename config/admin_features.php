<?php

return [
    'dashboard' => env('ADMIN_DASHBOARD_ENABLED', true),
    'users' => env('ADMIN_USERS_ENABLED', true),
    'notes' => env('ADMIN_NOTES_ENABLED', true),
    'ai_usage' => env('ADMIN_AI_USAGE_ENABLED', true),
    'feedback' => env('ADMIN_FEEDBACK_ENABLED', true),
    'announcements' => env('ADMIN_ANNOUNCEMENTS_ENABLED', true),
    'emails' => env('ADMIN_EMAILS_ENABLED', true),
    'activity_logs' => env('ADMIN_ACTIVITY_LOGS_ENABLED', true),
    'weekly_ai_usage_limit' => (int) env('AI_WEEKLY_USAGE_LIMIT', 50),
];
