<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiConversation;
use App\Models\Note;
use App\Models\NoteChatSession;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use App\Services\AiUsageTracker;

class NoteAiController extends Controller
{
    private string $askPdfBaseUrl;

    public function __construct()
    {
        $this->askPdfBaseUrl = rtrim(
            (string) config('services.askpdf.url', env('ASKPDF_URL', 'http://127.0.0.1:8010')),
            '/'
        );
    }

    public function askText(Request $request, Note $note)
    {
        $request->validate([
            'question' => ['required', 'string', 'max:2000'],
            'session_id' => ['nullable', 'integer'],
            'conversation_uuid' => ['nullable', 'uuid'],
        ]);

        if ($request->user() && $note->user_id !== $request->user()->id) {
            return response()->json([
                'message' => 'Unauthorized.',
            ], 403);
        }

        $question = trim((string) $request->input('question'));
        $sessionId = $request->input('session_id');
        $conversationUuid = $request->input('conversation_uuid');

        if ($question === '') {
            return response()->json([
                'message' => 'Please write a question first.',
            ], 422);
        }

        $intent = $this->classifyAskIntent($question);

        if ($intent === 'greeting') {
            return response()->json([
                'answer' => $this->greetingAnswer(),
                'reply' => $this->greetingAnswer(),
                'sources' => [],
                'pages' => [],
                'chunks' => [],
                'standalone_question' => $question,
            ]);
        }

        $history = $this->buildChatHistory($request, $note, $sessionId, $conversationUuid);
        $standaloneQuestion = $this->rewriteShortFollowUp($question, $history);

        try {
            if ($this->isPdfNote($note)) {
                return $this->askPdfNote(
                    $request,
                    $note,
                    $question,
                    $standaloneQuestion,
                    $history,
                    $conversationUuid
                );
            }

            return $this->askTextNote($note, $standaloneQuestion, $intent);
        } catch (\Throwable $e) {
            Log::error('Ask Note service failed', [
                'note_id' => $note->id,
                'ask_pdf_url' => $this->askPdfBaseUrl,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'message' => 'Ask Note service failed.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    private function askPdfNote(
        Request $request,
        Note $note,
        string $question,
        string $standaloneQuestion,
        array $history,
        ?string $conversationUuid
    ) {
        $pdfPath = $this->resolveNoteFilePath($note);

        if (!$pdfPath) {
            return response()->json([
                'message' => 'PDF file was not found on disk.',
                'answer' => 'I found this note, but I could not find the PDF file on disk.',
            ], 404);
        }

        $handle = fopen($pdfPath, 'r');

        if (!$handle) {
            return response()->json([
                'message' => 'Could not open PDF file.',
                'answer' => 'I found the PDF, but I could not open it for reading.',
            ], 500);
        }

        try {
            $processResponse = Http::connectTimeout(10)
                ->timeout(300)
                ->attach(
                    'file',
                    $handle,
                    $note->original_filename ?: basename($pdfPath)
                )
                ->post($this->askPdfBaseUrl . '/process');
        } finally {
            fclose($handle);
        }

        if (!$processResponse->successful()) {
            Log::error('PDF-RAG /process failed', [
                'note_id' => $note->id,
                'url' => $this->askPdfBaseUrl . '/process',
                'status' => $processResponse->status(),
                'body' => $processResponse->body(),
                'pdf_path' => $pdfPath,
            ]);

            return response()->json([
                'message' => 'Ask PDF failed while processing the PDF.',
                'error' => $processResponse->json('detail') ?? $processResponse->body(),
                'status' => $processResponse->status(),
                'url_attempted' => $this->askPdfBaseUrl . '/process',
            ], 500);
        }

        $docId =
            $processResponse->json('doc_id')
            ?? $processResponse->json('docId')
            ?? $processResponse->json('document_id')
            ?? $processResponse->json('documentId')
            ?? $processResponse->json('operation_id')
            ?? $processResponse->json('operationId');

        if (!$docId) {
            return response()->json([
                'message' => 'PDF-RAG processed the PDF, but no doc_id was returned.',
                'debug' => $processResponse->json(),
            ], 500);
        }

        /*
         * Important:
         * Send the clean question to /ask.
         * Do NOT send a big prompt here, because pdf-rag-backend already builds
         * the grounded prompt using the PDF chunks.
         */
        $answerResponse = Http::connectTimeout(10)
            ->timeout(420)
            ->post($this->askPdfBaseUrl . '/ask', [
                'doc_id' => $docId,
                'question' => $standaloneQuestion,
                'query' => $standaloneQuestion,
                'message' => $standaloneQuestion,
                'history' => $history,
            ]);

        if (!$answerResponse->successful()) {
            Log::error('PDF-RAG /ask failed', [
                'note_id' => $note->id,
                'doc_id' => $docId,
                'url' => $this->askPdfBaseUrl . '/ask',
                'status' => $answerResponse->status(),
                'body' => $answerResponse->body(),
            ]);

            return response()->json([
                'message' => 'Ask PDF failed while generating the answer.',
                'error' => $answerResponse->json('detail') ?? $answerResponse->body(),
                'status' => $answerResponse->status(),
            ], 500);
        }

        $answer =
            $answerResponse->json('answer')
            ?? $answerResponse->json('reply')
            ?? $answerResponse->json('response')
            ?? $answerResponse->json('output')
            ?? $answerResponse->json('message')
            ?? $answerResponse->json('text')
            ?? '';

        $answer = trim((string) $answer);

        if ($answer === '') {
            $answer = 'I couldn’t find this information in the uploaded PDF/note. Could you ask about something shown in the material?';
        }

        if ($answer !== '') {
            app(AiUsageTracker::class)->track('ask_note', $note->id ?? null);
        }

        Log::info('PDF-RAG answer generated', [
            'note_id' => $note->id,
            'question' => $question,
            'standalone_question' => $standaloneQuestion,
            'conversation_uuid' => $conversationUuid,
            'doc_id' => $docId,
            'service_url' => $this->askPdfBaseUrl,
            'answer_preview' => mb_substr($answer, 0, 500),
            'chunks_count' => is_array($answerResponse->json('chunks')) ? count($answerResponse->json('chunks')) : null,
        ]);

        return response()->json([
            'answer' => $answer,
            'reply' => $answer,
            'sources' => $answerResponse->json('sources') ?? [],
            'pages' => $answerResponse->json('pages') ?? [],
            'chunks' => $answerResponse->json('chunks') ?? [],
            'chunks_used' => $answerResponse->json('chunks_used') ?? $answerResponse->json('chunks') ?? [],
            'operation_id' => $docId,
            'doc_id' => $docId,
            'model' => $answerResponse->json('model'),
            'standalone_question' => $standaloneQuestion,
        ]);
    }

    private function askTextNote(Note $note, string $standaloneQuestion, string $intent)
    {
        $noteText =
            $note->text_content
            ?? $note->extracted_text
            ?? $note->content
            ?? $note->description
            ?? '';

        if (!trim($noteText)) {
            return response()->json([
                'message' => 'This note has no text content.',
                'answer' => 'The PDF/note was not processed or has no readable content.',
            ], 422);
        }

        if ($intent === 'overview') {
            $prompt = "
You are StudyFlow AI.

Give a short overview of the note using ONLY the note content below.
Keep it friendly and concise.

NOTE CONTENT:
{$noteText}

USER QUESTION:
{$standaloneQuestion}

ANSWER:
";
        } else {
            $prompt = "
You are StudyFlow AI.

Answer the user's question using ONLY the note content below.
If the answer is not found in the note, say:
I could not find this in the note.

NOTE CONTENT:
{$noteText}

USER QUESTION:
{$standaloneQuestion}

ANSWER:
";
        }

        $response = Http::connectTimeout(10)
            ->timeout(180)
            ->post(rtrim((string) config('services.ollama.base_url', env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')), '/') . '/api/generate', [
                'model' => env('OLLAMA_MODEL', 'llama3.2:3b'),
                'prompt' => $prompt,
                'stream' => false,
                'options' => [
                    'temperature' => 0.2,
                    'top_p' => 0.9,
                    'num_predict' => 500,
                ],
            ]);

        if (!$response->successful()) {
            return response()->json([
                'message' => 'Ollama request failed.',
                'error' => $response->body(),
            ], 500);
        }

        $answer = trim((string) ($response->json('response') ?? ''));

        if ($answer !== '') {
            app(AiUsageTracker::class)->track('ask_note', $note->id ?? null);
        }

        return response()->json([
            'answer' => $answer,
            'reply' => $answer,
            'sources' => [],
            'standalone_question' => $standaloneQuestion,
        ]);
    }

    private function buildChatHistory(Request $request, Note $note, $sessionId, ?string $conversationUuid): array
    {
        if ($conversationUuid) {
            $conversation = AiConversation::query()
                ->where('uuid', $conversationUuid)
                ->where('note_id', $note->id)
                ->when($request->user(), fn($query) => $query->where('user_id', $request->user()->id))
                ->first();

            if ($conversation) {
                return $conversation->messages()
                    ->latest()
                    ->take(10)
                    ->get()
                    ->reverse()
                    ->map(fn($message) => [
                        'role' => $message->role === 'assistant' ? 'assistant' : 'user',
                        'content' => $message->content,
                    ])
                    ->values()
                    ->toArray();
            }
        }

        if ($sessionId) {
            $session = NoteChatSession::find($sessionId);

            if ($session && $session->note_id === $note->id) {
                return $session->messages()
                    ->latest()
                    ->take(10)
                    ->get()
                    ->reverse()
                    ->map(fn($message) => [
                        'role' => $message->role === 'ai' ? 'assistant' : 'user',
                        'content' => $message->content,
                    ])
                    ->values()
                    ->toArray();
            }
        }

        return [];
    }

    private function classifyAskIntent(string $question): string
    {
        $lower = mb_strtolower(trim($question));

        if ($this->isGreetingQuestion($lower)) {
            return 'greeting';
        }

        if ($this->isOverviewQuestion($lower)) {
            return 'overview';
        }

        return 'question';
    }

    private function isGreetingQuestion(string $lowerQuestion): bool
    {
        $greetings = [
            'hi',
            'hello',
            'hey',
            'good morning',
            'good evening',
            'good afternoon',
            'salam',
            'مرحبا',
            'اهلا',
            'أهلا',
        ];

        return in_array($lowerQuestion, $greetings, true);
    }

    private function isOverviewQuestion(string $lowerQuestion): bool
    {
        $patterns = [
            'tell me about this note',
            'tell me about this pdf',
            'what is this pdf about',
            'what this pdf is about',
            'what is this note about',
            'what this note is about',
            'summarize this note',
            'summarize this pdf',
            'give me an overview',
            'explain this pdf',
            'explain this note',
            'overview of this note',
            'overview of this pdf',
            'summary of this note',
            'summary of this pdf',
        ];

        foreach ($patterns as $pattern) {
            if (str_contains($lowerQuestion, $pattern)) {
                return true;
            }
        }

        return false;
    }

    private function greetingAnswer(): string
    {
        return 'Hi! Ask me anything about this PDF/note and I’ll answer using its content.';
    }

    private function rewriteShortFollowUp(string $question, array $history): string
    {
        $clean = trim($question);
        $lower = mb_strtolower($clean);

        $shortFollowUps = [
            'talk',
            'explain',
            'explain more',
            'more',
            'what about it',
            'continue',
            'go on',
            'details',
            'tell me more',
            'more details',
            'وضح',
            'اشرح',
            'كمل',
            'can you tell me more',
            'can you tell me more about this note',
            'tell me more about this note',
            'tell me more about it',
            'more about this note',
        ];

        if (!in_array($lower, $shortFollowUps, true)) {
            return $clean;
        }

        $lastUserQuestion = null;

        for ($i = count($history) - 1; $i >= 0; $i--) {
            if (($history[$i]['role'] ?? '') !== 'user') {
                continue;
            }

            $content = trim((string) ($history[$i]['content'] ?? ''));

            if ($content === '') {
                continue;
            }

            if (mb_strtolower($content) === $lower) {
                continue;
            }

            $lastUserQuestion = $content;
            break;
        }

        if (!$lastUserQuestion) {
            return $clean;
        }

        return "Continue answering this previous question using the PDF context: {$lastUserQuestion}. User follow-up: {$clean}.";
    }

    private function isPdfNote(Note $note): bool
    {
        $mime = strtolower((string) ($note->mime_type ?? ''));
        $filename = strtolower((string) ($note->original_filename ?? ''));
        $storedPath = strtolower((string) ($note->stored_path ?? ''));
        $sourceType = strtolower((string) ($note->source_type ?? ''));

        return str_contains($mime, 'pdf')
            || str_ends_with($filename, '.pdf')
            || str_ends_with($storedPath, '.pdf')
            || $sourceType === 'pdf';
    }

    private function resolveNoteFilePath(Note $note): ?string
    {
        $storedPath = (string) ($note->stored_path ?? '');

        if ($storedPath === '') {
            return null;
        }

        $candidates = [
            $storedPath,
            storage_path('app/' . $storedPath),
            storage_path('app/public/' . $storedPath),
            storage_path('app/private/' . $storedPath),
            public_path('storage/' . $storedPath),
            base_path($storedPath),
        ];

        foreach ($candidates as $candidate) {
            if ($candidate && file_exists($candidate) && is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }
}