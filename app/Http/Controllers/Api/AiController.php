<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use App\Models\Note;
use App\Models\Summary;
use App\Support\ApiResponse;
use thiagoalessio\TesseractOCR\TesseractOCR;

class AiController extends Controller
{
    public function reset()
    {
        return response()->json([
            'success' => true,
            'message' => 'Reset done',
        ]);
    }

    public function testOllama()
    {
        $baseUrl = $this->ollamaBaseUrl();

        try {
            $timeout = min(30, $this->ollamaTimeout());

            $versionResponse = Http::connectTimeout($this->ollamaConnectTimeout())
                ->timeout($timeout)
                ->get($baseUrl . '/api/version');

            if (! $versionResponse->successful()) {
                Log::warning('Ollama version check failed', [
                    'status' => $versionResponse->status(),
                    'body' => $versionResponse->body(),
                ]);

                return ApiResponse::error('Ollama connection failed', 500, [
                    'base_url' => $baseUrl,
                    'model' => $this->ollamaModel(),
                ]);
            }

            return ApiResponse::success([
                'base_url' => $baseUrl,
                'model' => $this->ollamaModel(),
                'ollama' => $versionResponse->json(),
            ], 'Ollama is reachable');
        } catch (\Throwable $e) {
            Log::error('Ollama connection error', [
                'message' => $e->getMessage(),
            ]);

            return ApiResponse::error('Ollama connection failed', 500, [
                'base_url' => $baseUrl,
                'model' => $this->ollamaModel(),
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function generateQuestion(Request $request)
    {
        $validated = $request->validate([
            'note_id' => 'nullable|exists:notes,id',
            'note' => 'nullable|string',
            'topic' => 'nullable|string',
        ]);

        $topic = trim((string) ($validated['topic'] ?? ''));

        try {
            $noteText = $this->resolveNoteText(
                $request,
                $validated['note_id'] ?? null,
                $validated['note'] ?? null,
                6000
            );

            if ($noteText === '') {
                return ApiResponse::success([
                    'topic' => $topic !== '' ? $topic : 'General',
                    'question' => 'What is the main idea of this note?',
                ], 'Fallback question generated', 200, [
                    'fallback_used' => true,
                ]);
            }

            $prompt = $this->buildGenerateOnePrompt($noteText, $topic);

            $raw = $this->ollamaGenerate($prompt, [
                'temperature' => 0.2,
                'num_predict' => 220,
            ], min(60, $this->ollamaTimeout()));

            $decoded = $this->decodeFirstJsonObject($raw);

            $question = '';
            $finalTopic = '';

            if (is_array($decoded)) {
                $question = $this->normalizeQuestionText((string) ($decoded['question'] ?? ''));
                $finalTopic = trim((string) ($decoded['topic'] ?? ''));
            }

            if ($question === '') {
                $question = $this->fallbackOneQuestion($noteText);
            }

            if ($finalTopic === '') {
                $finalTopic = $topic !== '' ? $topic : $this->guessTopicFromText($noteText);
            }

            return ApiResponse::success([
                'topic' => $finalTopic !== '' ? $finalTopic : 'General',
                'question' => $question,
            ], 'Question generated successfully', 200, [
                'fallback_used' => $decoded === null,
            ]);
        } catch (\Throwable $e) {
            Log::error('GenerateQuestion error', [
                'message' => $e->getMessage(),
            ]);

            return ApiResponse::success([
                'topic' => $topic !== '' ? $topic : 'General',
                'question' => 'What is this note mainly about?',
            ], 'Fallback question generated', 200, [
                'fallback_used' => true,
            ]);
        }
    }

    public function checkAnswer(Request $request)
    {
        $validated = $request->validate([
            'question' => 'required|string',
            'expected_answer' => 'required|string',
            'user_answer' => 'required|string',
        ]);

        $question = $this->cleanText((string) $validated['question'], 800);
        $expected = $this->cleanText((string) $validated['expected_answer'], 800);
        $user = $this->cleanText((string) $validated['user_answer'], 800);

        try {
            $prompt = $this->buildCheckAnswerPrompt($question, $expected, $user);

            $raw = $this->ollamaGenerate($prompt, [
                'temperature' => 0,
                'num_predict' => 220,
            ], min(40, $this->ollamaTimeout()));

            $decoded = $this->decodeFirstJsonObject($raw);
            $result = $this->normalizeCheckAnswerResult($decoded);

            if ($result === null) {
                $result = $this->fallbackCheckAnswer($expected, $user);
            }

            return ApiResponse::success($result, 'Answer checked', 200, [
                'fallback_used' => $decoded === null,
            ]);
        } catch (\Throwable $e) {
            Log::error('CheckAnswer error', [
                'message' => $e->getMessage(),
            ]);

            return ApiResponse::success(
                $this->fallbackCheckAnswer($expected, $user),
                'Answer checked',
                200,
                ['fallback_used' => true]
            );
        }
    }

    public function quiz(Request $request)
    {
        $validated = $request->validate([
            'note_id' => 'nullable|exists:notes,id',
            'note' => 'nullable|string',
            'topic' => 'nullable|string',
            'count' => 'nullable|integer|min:1|max:15',
            'difficulty' => 'nullable|string|in:easy,medium,hard',
        ]);

        $count = (int) ($validated['count'] ?? 5);
        $difficulty = (string) ($validated['difficulty'] ?? 'medium');
        $requestedTopic = trim((string) ($validated['topic'] ?? ''));

        try {
            $noteText = $this->resolveNoteText(
                $request,
                $validated['note_id'] ?? null,
                $validated['note'] ?? null,
                9000
            );

            if ($noteText === '') {
                return ApiResponse::success([
                    'topic' => $requestedTopic !== '' ? $requestedTopic : 'General',
                    'difficulty' => $difficulty,
                    'type' => 'multiple_choice',
                    'questions' => [],
                    'total_questions' => 0,
                ], 'Quiz generation failed', 200, [
                    'fallback_used' => true,
                    'error' => 'empty_note',
                ]);
            }

            $topicFallback = $requestedTopic !== '' ? $requestedTopic : $this->guessTopicFromText($noteText);

            $prompt = $this->buildQuizPrompt($noteText, $difficulty, $count, $topicFallback);
            $raw = $this->ollamaGenerate($prompt, [
                'temperature' => 0.3,
                'num_predict' => 1400,
            ], $this->ollamaTimeout());

            $decoded = $this->decodeFirstJsonObject($raw);
            $normalized = $this->normalizeQuizResult($decoded, $topicFallback, $difficulty, $count);

            if ($normalized === null) {
                $prompt2 = $this->buildQuizPromptStrict($noteText, $difficulty, $count, $topicFallback);
                $raw2 = $this->ollamaGenerate($prompt2, [
                    'temperature' => 0,
                    'num_predict' => 1600,
                ], $this->ollamaTimeout());

                $decoded2 = $this->decodeFirstJsonObject($raw2);
                $normalized = $this->normalizeQuizResult($decoded2, $topicFallback, $difficulty, $count);
            }

            if ($normalized === null) {
                return ApiResponse::success([
                    'topic' => $topicFallback !== '' ? $topicFallback : 'General',
                    'difficulty' => $difficulty,
                    'type' => 'multiple_choice',
                    'questions' => [],
                    'total_questions' => 0,
                ], 'Quiz generation failed', 200, [
                    'fallback_used' => true,
                    'error' => 'invalid_model_output',
                ]);
            }

            return ApiResponse::success([
                'topic' => $normalized['topic'],
                'difficulty' => $normalized['difficulty'],
                'type' => 'multiple_choice',
                'questions' => $normalized['questions'],
                'total_questions' => count($normalized['questions']),
            ], 'Quiz generated successfully', 200, [
                'fallback_used' => false,
            ]);
        } catch (\Throwable $e) {
            Log::error('Quiz generation error', [
                'message' => $e->getMessage(),
            ]);

            return ApiResponse::success([
                'topic' => $requestedTopic !== '' ? $requestedTopic : 'General',
                'difficulty' => $difficulty,
                'type' => 'multiple_choice',
                'questions' => [],
                'total_questions' => 0,
            ], 'Quiz generation failed', 200, [
                'fallback_used' => true,
                'error' => 'exception',
            ]);
        }
    }

    public function summarize(Request $request)
    {
        @set_time_limit(120);

        $validated = $request->validate([
            'note_id' => ['required', 'integer', 'min:1'],
        ]);

        $noteId = (int) $validated['note_id'];

        try {
            $note = Note::query()
                ->where('user_id', $request->user()->id)
                ->whereKey($noteId)
                ->first();

            if (! $note) {
                return response()->json([
                    'success' => false,
                    'message' => 'Note not found.',
                ], 404);
            }

            $storedPath = (string) ($note->stored_path ?? '');
            if ($storedPath === '' && isset($note->file_path)) {
                $storedPath = (string) ($note->file_path ?? '');
            }

            if ($storedPath === '') {
                return response()->json([
                    'success' => false,
                    'message' => 'This note does not have a file attached.',
                ], 422);
            }

            $filename = (string) ($note->original_filename ?: basename($storedPath));
            $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
            $mimeType = strtolower((string) ($note->mime_type ?? ''));

            if ($extension !== 'pdf' && ! str_contains($mimeType, 'pdf')) {
                return response()->json([
                    'success' => false,
                    'filename' => $filename,
                    'message' => 'Only PDF files can be summarized.',
                ], 422);
            }

            $disk = Storage::disk('private');
            if (! $disk->exists($storedPath)) {
                return response()->json([
                    'success' => false,
                    'filename' => $filename,
                    'message' => 'File not found on server.',
                ], 404);
            }

            $fullPath = $disk->path($storedPath);

            $cachedText = $this->prepareSummaryInput(
                (string) ($note->extracted_text ?: $note->text_content ?: '')
            );

            $text = '';
            $sourceMode = 'none';

            if ($this->hasEnoughSummaryText($cachedText)) {
                $text = $cachedText;
                $sourceMode = 'cached';
            } else {
                $parsedText = $this->extractPdfTextPreserveLayout($fullPath);

                if ($this->hasEnoughSummaryText($parsedText)) {
                    $text = $parsedText;
                    $sourceMode = 'pdf_parser';
                } else {
                    $ocrText = $this->extractTextWithOcrFallback($fullPath, 5);
                    $combined = trim($parsedText . "\n\n" . $ocrText);

                    if ($this->hasEnoughSummaryText($combined)) {
                        $text = $combined;
                        $sourceMode = $parsedText !== '' ? 'pdf_parser+ocr' : 'ocr';
                    }
                }
            }

            if (! $this->hasEnoughSummaryText($text)) {
                return response()->json([
                    'success' => false,
                    'filename' => $filename,
                    'message' => 'Could not extract enough text from this PDF.',
                ], 422);
            }

            $text = $this->prepareSummaryInput($text, 16000);

            $pythonUrl = 'http://127.0.0.1:8001/summarize-fast';
            $timeout = 75;
            $connectTimeout = 5;

            $pythonResponse = Http::connectTimeout($connectTimeout)
                ->timeout($timeout)
                ->post($pythonUrl, [
                    'text' => $text,
                    'model' => $this->ollamaModel(),
                    'max_words' => 115,
                    'fast_mode' => true,
                    'document_style' => 'slides',
                ]);

            if (! $pythonResponse->successful()) {
                Log::error('Python summary API failed', [
                    'status' => $pythonResponse->status(),
                    'body' => $pythonResponse->body(),
                    'source_mode' => $sourceMode,
                    'note_id' => $noteId,
                ]);

                return response()->json([
                    'success' => false,
                    'filename' => $filename,
                    'message' => 'Python summary service failed.',
                ], 502);
            }

            $summary = trim((string) $pythonResponse->json('summary'));
            $mode = (string) $pythonResponse->json('mode', 'unknown');
            $durationSec = (float) $pythonResponse->json('duration_sec', 0);
            $selectedSentences = (int) $pythonResponse->json('selected_sentences', 0);
            $modelUsed = (string) $pythonResponse->json('model', $this->ollamaModel());

            if ($summary === '') {
                return response()->json([
                    'success' => false,
                    'filename' => $filename,
                    'message' => 'Summary service returned an empty result.',
                ], 502);
            }

            try {
                $saved = Summary::create([
                    'user_id' => $request->user()->id,
                    'note_id' => $note->id,
                    'title' => trim((string) ($note->title ?: pathinfo($filename, PATHINFO_FILENAME))) ?: ('Summary for Note #' . $note->id),
                    'source_type' => 'pdf',
                    'summary_text' => $summary,
                ]);
            } catch (\Throwable $e) {
                Log::error('Failed to save summary', [
                    'note_id' => $noteId,
                    'user_id' => $request->user()->id,
                    'message' => $e->getMessage(),
                ]);

                return response()->json([
                    'success' => false,
                    'filename' => $filename,
                    'message' => 'Summary generated but could not be saved.',
                ], 500);
            }

            return response()->json([
                'success' => true,
                'summary' => $summary,
                'filename' => $filename,
                'message' => 'Summary generated successfully.',
                'summary_id' => $saved->id,
                'mode' => $mode,
                'duration_sec' => $durationSec,
                'selected_sentences' => $selectedSentences,
                'model' => $modelUsed,
                'text_source' => $sourceMode,
                'document_style' => 'slides',
            ]);
        } catch (\Throwable $e) {
            Log::error('Summarize error', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'note_id' => $noteId,
            ]);

            return response()->json([
                'success' => false,
                'message' => app()->isLocal() ? $e->getMessage() : 'Summary failed.',
                'file' => app()->isLocal() ? $e->getFile() : null,
                'line' => app()->isLocal() ? $e->getLine() : null,
            ], 500);
        }
    }

    public function chat(Request $request)
    {
        $validated = $request->validate([
            'note_id' => ['required', 'integer', 'exists:notes,id'],
            'message' => ['required', 'string', 'min:1', 'max:2000'],
        ]);

        $note = Note::query()
            ->where('user_id', $request->user()->id)
            ->whereKey((int) $validated['note_id'])
            ->firstOrFail();

        $noteText = (string) ($note->extracted_text ?: $note->text_content ?: $note->description ?: '');
        $noteText = $this->cleanText($noteText, 9000);

        if ($noteText === '') {
            return ApiResponse::success([
                'reply' => 'I could not find enough note content to answer.',
            ], 'OK');
        }

        try {
            $prompt = <<<PROMPT
You are a helpful study assistant. Answer the user's question using ONLY the note content below.
If the answer is not in the note, say: "Not found in the note."

Return plain text only.

NOTE:
{$noteText}

QUESTION:
{$validated['message']}
PROMPT;

            $reply = $this->ollamaGenerate($prompt, [
                'temperature' => 0.2,
                'num_predict' => 400,
            ], min(90, $this->ollamaTimeout()));

            $reply = trim($reply);
            if ($reply === '') {
                $reply = 'Not found in the note.';
            }

            return ApiResponse::success([
                'reply' => $reply,
            ], 'OK');
        } catch (\Throwable $e) {
            Log::error('Chat error', [
                'message' => $e->getMessage(),
            ]);

            return ApiResponse::success([
                'reply' => 'I could not answer right now.',
            ], 'OK');
        }
    }

    private function ollamaBaseUrl(): string
    {
        return rtrim((string) config('services.ollama.base_url', 'http://127.0.0.1:11434'), '/');
    }

    private function ollamaGenerateUrl(): string
    {
        return $this->ollamaBaseUrl() . '/api/generate';
    }

    private function ollamaModel(): string
    {
        return (string) config('services.ollama.model', 'qwen3:1.7b');
    }

    private function ollamaTimeout(): int
    {
        return (int) config('services.ollama.timeout', 120);
    }

    private function ollamaConnectTimeout(): int
    {
        return (int) config('services.ollama.connect_timeout', 10);
    }

    private function resolveNoteText(Request $request, $noteId, $noteText, int $maxChars): string
    {
        $text = '';

        if ($noteId !== null) {
            $note = Note::find($noteId);
            if ($note) {
                if ($request->user() && $note->user_id !== $request->user()->id) {
                    throw new \RuntimeException('Unauthorized note access');
                }

                $text = (string) ($note->extracted_text ?: $note->text_content ?: $note->description ?: '');
            }
        }

        if ($text === '') {
            $text = (string) ($noteText ?? '');
        }

        return $this->cleanText($text, $maxChars);
    }

    private function ollamaGenerate(string $prompt, array $options = [], ?int $timeoutSeconds = null): string
    {
        $timeout = (int) ($timeoutSeconds ?? $this->ollamaTimeout());
        $timeout = max(5, min($timeout, 300));
        $connectTimeout = max(1, min($this->ollamaConnectTimeout(), 30));

        if (function_exists('set_time_limit')) {
            @set_time_limit($timeout + 10);
        }

        $response = Http::connectTimeout($connectTimeout)
            ->timeout($timeout)
            ->post($this->ollamaGenerateUrl(), [
                'model' => $this->ollamaModel(),
                'prompt' => $prompt,
                'stream' => false,
                'options' => $options,
            ]);

        if (! $response->successful()) {
            throw new \RuntimeException('Ollama request failed: ' . $response->status());
        }

        return (string) $response->json('response', '');
    }

    private function decodeFirstJsonObject(string $text): ?array
    {
        $text = (string) $text;
        $text = trim($text);

        if ($text === '') {
            return null;
        }

        $text = str_replace(["```json", "```", "\r"], ['', '', "\n"], $text);

        $start = strpos($text, '{');
        $end = strrpos($text, '}');

        if ($start === false || $end === false || $end <= $start) {
            return null;
        }

        $candidate = substr($text, $start, $end - $start + 1);
        $candidate = trim($candidate);

        $decoded = json_decode($candidate, true);

        if (! is_array($decoded) || json_last_error() !== JSON_ERROR_NONE) {
            return null;
        }

        return $decoded;
    }

    private function buildGenerateOnePrompt(string $noteText, string $topic): string
    {
        $topicLine = $topic !== '' ? "Requested topic: {$topic}" : 'Requested topic: (not provided)';

        return <<<PROMPT
You generate exactly ONE educational question from a note.

Return ONLY valid JSON.

JSON schema:
{
  "topic": "short topic, 1-4 words",
  "question": "one clear question, max 18 words, end with ?"
}

Rules:
- No markdown.
- No extra keys.
- No explanation.
- If topic is missing, infer it.

{$topicLine}

NOTE:
{$noteText}
PROMPT;
    }

    private function buildCheckAnswerPrompt(string $question, string $expected, string $user): string
    {
        return <<<PROMPT
You are grading a student's answer.

Return ONLY valid JSON with this schema:
{
  "correct": true|false,
  "score": 0.0,
  "feedback": "<= 160 chars"
}

Rules:
- No markdown.
- No extra keys.
- score must be between 0 and 1.
- Mark correct if the user's answer matches the expected answer in meaning (not necessarily exact wording).

QUESTION:
{$question}

EXPECTED ANSWER:
{$expected}

USER ANSWER:
{$user}
PROMPT;
    }

    private function buildQuizPrompt(string $noteText, string $difficulty, int $count, string $topicFallback): string
    {
        return <<<PROMPT
Generate a multiple-choice quiz from the note.

Return ONLY valid JSON.

JSON schema:
{
  "topic": "string",
  "difficulty": "easy|medium|hard",
  "questions": [
    {
      "topic": "string",
      "question": "string",
      "options": ["string","string","string","string"],
      "correct_index": 0
    }
  ]
}

Rules:
- Exactly {$count} questions.
- Each question must have exactly 4 options.
- correct_index must be 0,1,2,or 3.
- No explanations.
- Keep questions grounded in the note.
- If topic is missing, use "{$topicFallback}".

Difficulty: {$difficulty}
Topic fallback: {$topicFallback}

NOTE:
{$noteText}
PROMPT;
    }

    private function buildQuizPromptStrict(string $noteText, string $difficulty, int $count, string $topicFallback): string
    {
        return <<<PROMPT
Return ONLY JSON (no text before/after).
The JSON MUST parse.

{
  "topic": "{$topicFallback}",
  "difficulty": "{$difficulty}",
  "questions": [
    {
      "topic": "{$topicFallback}",
      "question": "...",
      "options": ["...","...","...","..."],
      "correct_index": 0
    }
  ]
}

Constraints:
- Create exactly {$count} questions.
- options array length must be exactly 4.
- correct_index must be an integer 0-3.
- No markdown.
- No explanations.

NOTE:
{$noteText}
PROMPT;
    }

    private function normalizeQuizResult(?array $decoded, string $topicFallback, string $difficulty, int $count): ?array
    {
        if (! is_array($decoded)) {
            return null;
        }

        $topic = trim((string) ($decoded['topic'] ?? ''));
        if ($topic === '') {
            $topic = $topicFallback;
        }

        $diff = trim((string) ($decoded['difficulty'] ?? ''));
        if (! in_array($diff, ['easy', 'medium', 'hard'], true)) {
            $diff = $difficulty;
        }

        $questions = $decoded['questions'] ?? null;
        if (! is_array($questions)) {
            return null;
        }

        $normalizedQuestions = [];
        foreach ($questions as $q) {
            if (! is_array($q)) {
                continue;
            }

            $questionText = $this->cleanText((string) ($q['question'] ?? ''), 240);
            if ($questionText === '') {
                continue;
            }

            $qTopic = trim((string) ($q['topic'] ?? ''));
            if ($qTopic === '') {
                $qTopic = $this->guessTopicFromText($questionText);
            }
            if ($qTopic === '') {
                $qTopic = $topic !== '' ? $topic : 'General';
            }

            $options = $q['options'] ?? [];
            if (! is_array($options)) {
                continue;
            }

            $options = array_values(array_map(fn($o) => $this->cleanText((string) $o, 160), $options));
            $options = array_values(array_filter($options, fn($o) => $o !== ''));
            if (count($options) !== 4) {
                continue;
            }

            $correctIndex = $q['correct_index'] ?? null;
            if (! is_int($correctIndex) && is_numeric($correctIndex)) {
                $correctIndex = (int) $correctIndex;
            }

            if (! is_int($correctIndex) || $correctIndex < 0 || $correctIndex > 3) {
                continue;
            }

            $normalizedQuestions[] = [
                'topic' => $qTopic,
                'question' => $questionText,
                'options' => $options,
                'correct_index' => $correctIndex,
            ];

            if (count($normalizedQuestions) >= $count) {
                break;
            }
        }

        if (count($normalizedQuestions) === 0) {
            return null;
        }

        return [
            'topic' => $topic !== '' ? $topic : 'General',
            'difficulty' => $diff,
            'questions' => $normalizedQuestions,
        ];
    }

    private function normalizeCheckAnswerResult($decoded): ?array
    {
        if (! is_array($decoded)) {
            return null;
        }

        if (! array_key_exists('correct', $decoded) || ! array_key_exists('score', $decoded) || ! array_key_exists('feedback', $decoded)) {
            return null;
        }

        $correct = $decoded['correct'];
        if (! is_bool($correct)) {
            return null;
        }

        $score = $decoded['score'];
        if (! is_numeric($score)) {
            return null;
        }

        $score = max(0.0, min(1.0, (float) $score));

        $feedback = $this->cleanText((string) $decoded['feedback'], 160);
        if ($feedback === '') {
            $feedback = $correct ? 'Correct.' : 'Incorrect.';
        }

        return [
            'correct' => $correct,
            'score' => $score,
            'feedback' => $feedback,
        ];
    }

    private function fallbackCheckAnswer(string $expected, string $user): array
    {
        $expectedNorm = $this->normalizeLooseText($expected);
        $userNorm = $this->normalizeLooseText($user);

        if ($expectedNorm === '' || $userNorm === '') {
            return [
                'correct' => false,
                'score' => 0.0,
                'feedback' => 'Answer could not be evaluated.',
            ];
        }

        $correct = ($expectedNorm === $userNorm)
            || str_contains($expectedNorm, $userNorm)
            || str_contains($userNorm, $expectedNorm);

        $score = $correct ? 1.0 : 0.0;

        return [
            'correct' => $correct,
            'score' => $score,
            'feedback' => $correct ? 'Correct.' : 'Incorrect.',
        ];
    }

    private function normalizeLooseText(string $text): string
    {
        $text = mb_strtolower($text);
        $text = strip_tags($text);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/[^\pL\pN\s]/u', ' ', $text);
        $text = preg_replace('/\s+/u', ' ', $text);

        return trim($text);
    }

    private function normalizeQuestionText(string $text): string
    {
        $text = $this->cleanText($text, 200);

        if ($text === '') {
            return '';
        }

        $text = preg_replace('/^(question|q)\s*:\s*/i', '', $text);
        $text = trim($text, " \t\n\r\0\x0B\"'`");
        $text = preg_replace('/\s+/u', ' ', $text);
        $text = trim($text);

        if ($text === '') {
            return '';
        }

        if (! str_contains($text, '?')) {
            $text = rtrim(mb_substr($text, 0, 140), '.! ') . '?';
        }

        if (preg_match('/([^?]{5,180}\?)/u', $text, $m)) {
            return trim($m[1]);
        }

        return $text;
    }

    private function fallbackOneQuestion(string $noteText): string
    {
        $topic = $this->guessTopicFromText($noteText);

        if ($topic !== '' && $topic !== 'General') {
            return "What is the key idea about {$topic}?";
        }

        return 'What is the main idea of this note?';
    }

    private function guessTopicFromText(string $text): string
    {
        $text = $this->cleanText($text, 400);
        $text = preg_replace('/[^\pL\pN\s]/u', ' ', $text);
        $text = preg_replace('/\s+/u', ' ', $text);
        $text = trim($text);

        if ($text === '') {
            return 'General';
        }

        $words = preg_split('/\s+/u', $text);
        $words = array_values(array_filter($words, fn($w) => mb_strlen($w) >= 3));
        $slice = array_slice($words, 0, 4);

        return $slice ? implode(' ', $slice) : 'General';
    }

    private function cleanText(?string $text, int $maxChars = 700): string
    {
        $text = (string) $text;
        $text = strip_tags($text);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\s+/u', ' ', $text);
        $text = trim($text);

        if ($text === '') {
            return '';
        }

        return mb_substr($text, 0, $maxChars);
    }

    private function prepareSummaryInput(?string $text, int $maxChars = 50000): string
    {
        $text = (string) $text;
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = strip_tags($text);
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $text = preg_replace("/[ \t]+/u", ' ', $text);
        $text = preg_replace("/\n{3,}/u", "\n\n", $text);
        $text = trim($text);

        if ($text === '') {
            return '';
        }

        return mb_substr($text, 0, $maxChars);
    }

    private function hasEnoughSummaryText(string $text): bool
    {
        $text = trim($text);

        if ($text === '') {
            return false;
        }

        if (mb_strlen($text) < 260) {
            return false;
        }

        preg_match_all('/[\pL]/u', $text, $letters);
        $letterCount = count($letters[0] ?? []);

        if ($letterCount < 150) {
            return false;
        }

        $lines = preg_split("/\r\n|\n|\r/u", $text);
        $longLines = 0;

        foreach ($lines as $line) {
            if (mb_strlen(trim($line)) >= 20) {
                $longLines++;
            }
        }

        return $longLines >= 3 || mb_strlen($text) >= 650;
    }

    private function extractPdfTextPreserveLayout(string $fullPath): string
    {
        $content = '';

        try {
            if (class_exists(\Smalot\PdfParser\Parser::class)) {
                $parser = new \Smalot\PdfParser\Parser();
                $pdf = $parser->parseFile($fullPath);
                $content = (string) $pdf->getText();
            }
        } catch (\Throwable $e) {
            Log::error('PDF Parse failed in controller', [
                'error' => $e->getMessage(),
                'path' => $fullPath,
            ]);
        }

        return $this->prepareSummaryInput($content, 50000);
    }

    private function extractTextWithOcrFallback(string $pdfPath, int $maxPages = 5): string
    {
        $poppler = $this->popplerBinaryPath();
        $tesseract = $this->tesseractBinaryPath();

        if (! is_file($poppler) || ! is_file($tesseract)) {
            Log::warning('OCR fallback skipped because binaries were not found', [
                'poppler' => $poppler,
                'tesseract' => $tesseract,
            ]);

            return '';
        }

        $tempDir = storage_path('app/ocr_tmp/' . uniqid('summary_', true));

        if (! is_dir($tempDir) && ! @mkdir($tempDir, 0777, true) && ! is_dir($tempDir)) {
            return '';
        }

        try {
            $pageCount = $this->getPdfPageCount($pdfPath);
            $pages = $this->pickOcrSamplePages($pageCount, $maxPages);

            if (empty($pages)) {
                $pages = [1];
            }

            $allText = [];

            foreach ($pages as $page) {
                $prefix = $tempDir . DIRECTORY_SEPARATOR . 'page_' . $page;

                $cmd = escapeshellarg($poppler)
                    . ' -f ' . (int) $page
                    . ' -l ' . (int) $page
                    . ' -r 130 -png -singlefile '
                    . escapeshellarg($pdfPath) . ' '
                    . escapeshellarg($prefix)
                    . ' 2>&1';

                $output = [];
                $exitCode = 0;
                @exec($cmd, $output, $exitCode);

                if ($exitCode !== 0) {
                    Log::warning('pdftoppm page extraction failed', [
                        'page' => $page,
                        'exit_code' => $exitCode,
                        'output' => implode("\n", $output),
                    ]);
                    continue;
                }

                $imagePath = $prefix . '.png';

                if (! file_exists($imagePath)) {
                    continue;
                }

                try {
                    $pageText = (new TesseractOCR($imagePath))
                        ->executable($tesseract)
                        ->run();

                    $pageText = $this->prepareSummaryInput($pageText, 10000);

                    if ($pageText !== '') {
                        $allText[] = $pageText;
                    }
                } catch (\Throwable $e) {
                    Log::warning('OCR page failed', [
                        'image' => $imagePath,
                        'page' => $page,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            $this->cleanupOcrTempDir($tempDir);

            return $this->prepareSummaryInput(implode("\n\n", $allText), 50000);
        } catch (\Throwable $e) {
            Log::error('OCR fallback failed', [
                'message' => $e->getMessage(),
                'path' => $pdfPath,
            ]);

            $this->cleanupOcrTempDir($tempDir);

            return '';
        }
    }

    private function getPdfPageCount(string $pdfPath): int
    {
        $pdfInfo = $this->pdfInfoBinaryPath();

        if (! is_file($pdfInfo)) {
            return 0;
        }

        $cmd = escapeshellarg($pdfInfo) . ' ' . escapeshellarg($pdfPath) . ' 2>&1';

        $output = [];
        $exitCode = 0;
        @exec($cmd, $output, $exitCode);

        if ($exitCode !== 0) {
            return 0;
        }

        $joined = implode("\n", $output);

        if (preg_match('/Pages:\s+(\d+)/i', $joined, $m)) {
            return max(0, (int) $m[1]);
        }

        return 0;
    }

    private function pickOcrSamplePages(int $pageCount, int $maxPages = 5): array
    {
        if ($pageCount <= 0) {
            return [1];
        }

        if ($pageCount <= $maxPages) {
            return range(1, $pageCount);
        }

        $pages = [
            1,
            max(1, (int) round($pageCount * 0.20)),
            max(1, (int) round($pageCount * 0.40)),
            max(1, (int) round($pageCount * 0.65)),
            $pageCount,
        ];

        $pages = array_values(array_unique(array_map(
            fn($p) => max(1, min($pageCount, (int) $p)),
            $pages
        )));

        sort($pages);

        return array_slice($pages, 0, $maxPages);
    }

    private function cleanupOcrTempDir(string $tempDir): void
    {
        try {
            foreach (glob($tempDir . DIRECTORY_SEPARATOR . '*') ?: [] as $file) {
                @unlink($file);
            }
            @rmdir($tempDir);
        } catch (\Throwable $e) {
            Log::warning('OCR temp cleanup failed', [
                'dir' => $tempDir,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function popplerBinaryPath(): string
    {
        return 'C:\\Users\\obaid\\Downloads\\Release-25.12.0-0\\poppler-25.12.0\\Library\\bin\\pdftoppm.exe';
    }

    private function pdfInfoBinaryPath(): string
    {
        return 'C:\\Users\\obaid\\Downloads\\Release-25.12.0-0\\poppler-25.12.0\\Library\\bin\\pdfinfo.exe';
    }

    private function tesseractBinaryPath(): string
    {
        return 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
    }
}
