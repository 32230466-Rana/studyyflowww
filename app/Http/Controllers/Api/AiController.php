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

class AiController extends Controller
{
    public function askPdfQuery(Request $request)
    {
        $validated = $request->validate([
            'question' => ['required', 'string', 'min:1', 'max:2000'],
            'pdf_id' => ['required', 'string'],
            'session_id' => ['nullable', 'string'],
        ]);

        try {
            $sessionId = trim((string) ($validated['session_id'] ?? ''));

            $payload = [
                'question' => $validated['question'],
                'model' => 'phi3:mini',
                'pdf_ids' => [$validated['pdf_id']],
            ];

            if ($sessionId !== '') {
                $payload['session_id'] = $sessionId;
            }

            $fastApiResponse = Http::connectTimeout(10)
                ->timeout(180)
                ->post('http://127.0.0.1:8001/api/v1/query', $payload);

            if (! $fastApiResponse->successful()) {
                Log::error('Ask PDF query failed', [
                    'status' => $fastApiResponse->status(),
                    'body' => $fastApiResponse->body(),
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'Ask PDF service failed.',
                ], 502);
            }

            return response()->json([
                'success' => true,
                'answer' => (string) $fastApiResponse->json('answer', ''),
                'sources' => $fastApiResponse->json('sources', []),
                'session_id' => (string) $fastApiResponse->json('session_id', $sessionId),
            ]);
        } catch (\Throwable $e) {
            Log::error('Ask PDF error', [
                'message' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Ask PDF failed.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

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


    private function isGreeting(string $message): bool
    {
        $greetings = ['hi', 'hello', 'hey', 'help', 'who are you', 'how are you', 'hola', 'helo'];
        return in_array($message, $greetings, true);
    }

    private function normalizeUserIntent(string $message): string
    {
        $lower = mb_strtolower(trim($message));

        if (str_word_count($lower) <= 2 && ! preg_match('/(explain|summarize|what|how|why)/', $lower)) {
            return "Explain the topic \"{$message}\" from the note in a simple way with 1 example if possible.";
        }

        $patterns = [
            '/^summarize\s+(.+)/i' => 'Give a short focused summary of the topic "$1" from the note.',
            '/^talk\s+about\s+(.+)/i' => 'Explain the topic "$1" from the note clearly with 1 short example.',
            '/^explain\s+(.+)/i' => 'Explain the topic "$1" from the note in simple, easy-to-understand words.',
            '/(this part ma fhmt|i don\'t understand this|explain this simply)/i' => 'I don\'t understand this part of the note. Can you explain it in very simple words with an example?',
        ];

        foreach ($patterns as $pattern => $replacement) {
            if (preg_match($pattern, $message)) {
                return (string) preg_replace($pattern, $replacement, $message);
            }
        }

        return $message;
    }
    public function summarize(Request $request)
    {
        @set_time_limit(600);
        ini_set('max_execution_time', '600');
        ini_set('default_socket_timeout', '600');

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
            $mimeType = (string) ($note->mime_type ?? '');

            if ($extension !== 'pdf' && ! str_contains(strtolower($mimeType), 'pdf')) {
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

            $pythonUrl = env('SUMMARY_API_URL', 'http://127.0.0.1:8002/summarize');

            // Determine if we send file or text
            $response = null;
            if ($note->source_type === 'text' || !empty($note->text_content)) {
                $response = Http::connectTimeout(10)
                    ->timeout(600)
                    ->post($pythonUrl, [
                        'text' => $note->text_content ?: $note->description ?: ''
                    ]);
            } else {
                $response = Http::connectTimeout(10)
                    ->timeout(600)
                    ->attach('file', file_get_contents($fullPath), $filename)
                    ->post($pythonUrl);
            }

            if (!$response->successful()) {
                Log::error('Python summary API failed', [
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);

                return response()->json([
                    'success' => false,
                    'filename' => $filename,
                    'message' => 'Python summary service failed.',
                ], 502);
            }

            $summary = trim((string) $response->json('summary', ''));

            if ($summary === '') {
                Log::warning('Python summary API returned empty summary', [
                    'note_id' => $noteId,
                    'body' => $response->json(),
                ]);

                return response()->json([
                    'success' => false,
                    'filename' => $filename,
                    'message' => 'Summary service returned an empty result.',
                ], 502);
            }

            $title = trim((string) ($note->title ?: pathinfo($filename, PATHINFO_FILENAME)));

            if ($title === '') {
                $title = 'Summary for Note #' . $note->id;
            }

            $saved = Summary::create([
                'user_id' => $request->user()->id,
                'note_id' => $note->id,
                'title' => $title,
                'source_type' => 'pdf',
                'summary_text' => $summary,
            ]);

            return response()->json([
                'success' => true,
                'summary' => $summary,
                'filename' => $filename,
                'message' => 'Summary generated successfully.',
                'summary_id' => $saved->id,
            ]);
        } catch (\Throwable $e) {
            Log::error('Summarize error', [
                'message' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Summary failed.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }


    private function extractRelevantContext(string $query, string $fullText): string
    {
        $maxChars = 7000;

        if (strlen($fullText) <= $maxChars) {
            return $fullText;
        }

        $keywords = explode(' ', mb_strtolower(trim($query)));
        $keywords = array_filter($keywords, fn($k) => strlen($k) > 3);

        if (empty($keywords)) {
            return mb_substr($fullText, 0, $maxChars);
        }

        $sections = explode("\n\n", $fullText);
        $scoredSections = [];

        foreach ($sections as $index => $section) {
            $score = 0;
            $lowerSection = mb_strtolower($section);

            foreach ($keywords as $word) {
                if (str_contains($lowerSection, $word)) {
                    $score += 10;

                    if (strlen($section) < 100 && $index < count($sections) - 1) {
                        $score += 5;
                    }
                }
            }

            if ($score > 0) {
                $scoredSections[] = [
                    'text' => $section,
                    'score' => $score,
                    'index' => $index,
                ];
            }
        }

        if (empty($scoredSections)) {
            return mb_substr($fullText, 0, $maxChars);
        }

        usort($scoredSections, fn($a, $b) => $b['score'] <=> $a['score']);

        $resultText = '';
        $includedIndices = [];

        foreach (array_slice($scoredSections, 0, 3) as $best) {
            for ($i = -1; $i <= 1; $i++) {
                $idx = $best['index'] + $i;

                if (isset($sections[$idx]) && ! isset($includedIndices[$idx])) {
                    $resultText .= $sections[$idx] . "\n\n";
                    $includedIndices[$idx] = true;
                }
            }

            if (strlen($resultText) > $maxChars) {
                break;
            }
        }

        return $resultText !== '' ? $resultText : mb_substr($fullText, 0, $maxChars);
    }

    private function retryWithFullContext(string $normalizedPrompt, string $fullText)
    {
        $trimmedText = mb_substr($fullText, 0, 8000);
        $prompt = "You are a friendly study assistant. Using the NOTE CONTENT: \n{$trimmedText}\n\nUSER REQUEST: {$normalizedPrompt}";

        try {
            $reply = $this->ollamaGenerate($prompt, [
                'temperature' => 0.2,
                'num_predict' => 500,
            ]);

            return ApiResponse::success([
                'reply' => trim($reply)
            ], 'OK');
        } catch (\Throwable $e) {
            return ApiResponse::success([
                'reply' => "I couldn't find that in the note."
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
        return (string) config('services.ollama.model', 'phi3:mini');
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
        $text = trim((string) $text);

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

    private function isSummaryRequest(string $message): bool
    {
        $phrases = [
            'summarize',
            'summary',
            'summarise',
            'short summary',
            'key points',
            'bullet points',
            'give me a summary',
            'summarize the pdf',
            'summarize this file',
            'summarize this document'
        ];

        foreach ($phrases as $phrase) {
            if (str_contains($message, $phrase)) {
                return true;
            }
        }

        return false;
    }

    private function handleChatSummary(Request $request, Note $note, string $userMessage)
    {
        try {
            $pythonUrl = env('SUMMARY_API_URL', 'http://127.0.0.1:8002/summarize');
            $response = null;

            if ($note->source_type === 'text' || !empty($note->text_content)) {
                $response = Http::connectTimeout(10)
                    ->timeout(300)
                    ->post($pythonUrl, [
                        'human_input' => $note->text_content ?: $note->description ?: ''
                    ]);
            } else {
                $disk = Storage::disk('private');
                $storedPath = (string) ($note->stored_path ?? $note->file_path ?? '');

                if ($disk->exists($storedPath)) {
                    $response = Http::connectTimeout(10)
                        ->timeout(300)
                        ->attach('file', file_get_contents($disk->path($storedPath)), basename($storedPath))
                        ->post($pythonUrl);
                }
            }

            if ($response && $response->successful()) {
                $summaryText = trim((string) $response->json('summary', ''));

                if ($summaryText !== '') {
                    $saved = Summary::create([
                        'user_id' => $request->user()->id,
                        'note_id' => $note->id,
                        'title' => 'Summary of ' . ($note->title ?: 'Note #' . $note->id),
                        'source_type' => $note->source_type ?: 'text',
                        'summary_text' => $summaryText,
                    ]);

                    return ApiResponse::success([
                        'type' => 'summary',
                        'reply' => $summaryText . "\n\n✨ _Saved to MySummaries_",
                        'summary_id' => $saved->id,
                        'saved_to_my_summaries' => true,
                    ], 'Summary generated and saved.');
                }
            }

            return ApiResponse::success([
                'reply' => "I'm sorry, I couldn't generate a summary for this note right now."
            ], 'OK');
        } catch (\Throwable $e) {
            Log::error('Chat summary error', [
                'message' => $e->getMessage(),
            ]);

            return ApiResponse::success([
                'reply' => "I encountered an error while trying to summarize this document."
            ], 'OK');
        }
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

        if (
            ! array_key_exists('correct', $decoded)
            || ! array_key_exists('score', $decoded)
            || ! array_key_exists('feedback', $decoded)
        ) {
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
}
