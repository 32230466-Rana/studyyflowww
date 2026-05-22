<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Local PDF RAG Backend
    |--------------------------------------------------------------------------
    | New backend:
    | http://127.0.0.1:8010
    |
    | Handles:
    | - AskPDF
    | - PDF process
    | - MCQ generation
    */

    'ai_tutor' => [
        'url' => env('AI_TUTOR_URL', 'http://127.0.0.1:8010'),
        'timeout' => env('AI_TUTOR_TIMEOUT', 700),

        // New pdf-rag-backend endpoints
        'upload_endpoint' => env('AI_TUTOR_UPLOAD_ENDPOINT', '/process'),
        'mcq_endpoint' => env('AI_TUTOR_MCQ_ENDPOINT', '/generate-mcq'),

        // Keep these for now so old code does not crash if referenced,
        // but the new backend currently mainly supports MCQ.
        'true_false_endpoint' => env('AI_TUTOR_TRUE_FALSE_ENDPOINT', '/api/quiz/true-false'),
        'fill_blank_endpoint' => env('AI_TUTOR_FILL_BLANK_ENDPOINT', '/api/quiz/fill-blank'),
    ],

    'askpdf' => [
        'url' => env('ASKPDF_URL', 'http://127.0.0.1:8010'),
        'api_url' => env('ASKPDF_API_URL', 'http://127.0.0.1:8010'),
        'base_url' => env('ASKPDF_BASE_URL', 'http://127.0.0.1:8010'),
    ],

    'ollama' => [
        'host' => env('OLLAMA_HOST', 'http://127.0.0.1:11434'),
        'base_url' => env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
        'model' => env('OLLAMA_MODEL', 'llama3.2:3b'),
        'timeout' => env('OLLAMA_TIMEOUT', 620),
        'connect_timeout' => env('OLLAMA_CONNECT_TIMEOUT', 10),
    ],

];
