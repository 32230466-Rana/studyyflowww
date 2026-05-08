<?php

return [

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],
    'quiz_api' => [
        'url' => env('QUIZ_API_URL'),
        'key' => env('QUIZ_API_KEY'),
        'model' => env('QUIZ_API_MODEL'),
        'timeout' => (int) env('QUIZ_API_TIMEOUT', 120),
    ],
    'ai_tutor' => [
        'url' => env('AI_TUTOR_URL', 'http://127.0.0.1:8015'),
        'timeout' => env('AI_TUTOR_TIMEOUT', 700),
    ],
];
