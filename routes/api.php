<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Api\NoteController;
use App\Http\Controllers\Api\AiController;
use App\Http\Controllers\Api\SummaryController;
use App\Http\Controllers\Api\Admin\AdminDashboardController;
use App\Http\Controllers\Api\Admin\AdminUsersController;
use App\Http\Controllers\Api\Admin\AdminNotesController;
use App\Http\Controllers\Api\NoteAiController;
use App\Http\Controllers\Api\LocalAiController;
use App\Http\Controllers\Api\AiTutorController;


Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me', fn(\Illuminate\Http\Request $request) => $request->user());
});
Route::prefix('ai-tutor')->group(function () {
    Route::get('/health', [AiTutorController::class, 'health']);
    Route::post('/generate-quiz', [AiTutorController::class, 'generateQuiz']);
});

Route::middleware(['auth:sanctum', 'admin'])->prefix('admin')->group(function () {
    Route::get('/dashboard', [AdminDashboardController::class, 'dashboard']);

    Route::get('/users', [AdminUsersController::class, 'index']);
    Route::post('/users', [AdminUsersController::class, 'store']);
    Route::put('/users/{user}', [AdminUsersController::class, 'update']);
    Route::delete('/users/{user}', [AdminUsersController::class, 'destroy']);
    Route::patch('/users/{user}/toggle-admin', [AdminUsersController::class, 'toggleAdmin']);
    Route::patch('/users/{user}/toggle-status', [AdminUsersController::class, 'toggleStatus']);

    Route::get('/notes', [AdminNotesController::class, 'index']);
    Route::put('/notes/{note}', [AdminNotesController::class, 'update']);
    Route::delete('/notes/{note}', [AdminNotesController::class, 'destroy']);
    Route::patch('/notes/{note}/toggle-featured', [AdminNotesController::class, 'toggleFeatured']);
});

Route::options('/{any}', function () {
    return response()->json([], 200);
})->where('any', '.*');

Route::get('/ping', function () {
    return response()->json([
        'ok' => true,
        'message' => 'API is working',
    ], 200);
});

Route::get('/ai/test', function () {
    $response = \Illuminate\Support\Facades\Http::post('http://127.0.0.1:11434/api/generate', [
        'model' => 'qwen:0.5b',
        'prompt' => 'Say hello in one sentence',
        'stream' => false,
    ]);

    return $response->json();
});

Route::prefix('auth')->group(function () {
    Route::post('/notes/{note}/ask-text', [NoteAiController::class, 'askText']);
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/send-verification-code', [AuthController::class, 'sendVerificationCode'])->middleware('throttle:6,1');
    Route::post('/verify-code', [AuthController::class, 'verifyCode'])->middleware('throttle:10,1');

    Route::post('/login', [AuthController::class, 'login'])
        ->middleware('throttle:login');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/me', [AuthController::class, 'me']);
    });
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/notes', [NoteController::class, 'index']);
    Route::post('/notes', [NoteController::class, 'store']);
    Route::get('/notes/{id}', [NoteController::class, 'show']);
    Route::put('/notes/{id}', [NoteController::class, 'update']);
    Route::delete('/notes/{id}', [NoteController::class, 'destroy']);
    Route::get('/notes/{id}/download', [NoteController::class, 'download']);

    Route::get('/summaries', [SummaryController::class, 'index']);
    Route::delete('/summaries/{summary}', [SummaryController::class, 'destroy']);
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/notes', [NoteController::class, 'index']);
    Route::post('/notes', [NoteController::class, 'store']);
    Route::get('/notes/{id}', [NoteController::class, 'show']);
    Route::put('/notes/{id}', [NoteController::class, 'update']);
    Route::delete('/notes/{id}', [NoteController::class, 'destroy']);
    Route::get('/notes/{id}/download', [NoteController::class, 'download']);

    Route::get('/notes/{id}/chat-sessions', [AiController::class, 'getChatSessions']);
    Route::post('/notes/{id}/chat-sessions', [AiController::class, 'createChatSession']);
    Route::post('/chat-sessions/{id}/messages', [AiController::class, 'chat']);
    Route::delete('/chat-sessions/{sessionId}', [AiController::class, 'deleteChatSession']);

    Route::get('/summaries', [SummaryController::class, 'index']);
    Route::delete('/summaries/{summary}', [SummaryController::class, 'destroy']);
});
Route::middleware('auth:sanctum')->prefix('ai')->group(function () {
    Route::post('/generate-quiz', [AiController::class, 'generateQuiz']);
    Route::post('/summarize', [AiController::class, 'summarize']);
    Route::post('/quiz', [AiController::class, 'quiz']);
    Route::post('/chat', [AiController::class, 'chat']);
    Route::post('/questions', [AiController::class, 'generateQuestions']);
    Route::post('/check-answer', [AiController::class, 'checkAnswer']);
    Route::post('/generate-one', [AiController::class, 'generateQuestion']);
});




Route::prefix('local-ai')->group(function () {
    Route::match(['get', 'post'], '/health', [LocalAiController::class, 'health']);

    Route::post('/summary/text', [LocalAiController::class, 'summarizeText']);
    Route::post('/summary/file', [LocalAiController::class, 'summarizeFile']);

    Route::post('/quiz/text', [LocalAiController::class, 'quizText']);
    Route::post('/quiz/file', [LocalAiController::class, 'quizFile']);
});
Route::prefix('local-ai')->group(function () {
    Route::match(['get', 'post'], '/health', [LocalAiController::class, 'health']);
});

Route::middleware('auth:sanctum')->prefix('local-ai')->group(function () {
    Route::post('/summary/text', [LocalAiController::class, 'summarizeText']);
    Route::post('/summary/file', [LocalAiController::class, 'summarizeFile']);

    Route::post('/quiz/text', [LocalAiController::class, 'quizText']);
    Route::post('/quiz/file', [LocalAiController::class, 'quizFile']);
});
