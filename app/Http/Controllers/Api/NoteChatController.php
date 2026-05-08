<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Note;
use App\Models\NoteChatMessage;
use App\Models\NoteChatSession;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

class NoteChatController extends Controller
{
    public function sessions(Request $request, Note $note)
    {
        $this->authorizeNote($request, $note);

        $sessions = NoteChatSession::where('note_id', $note->id)
            ->where('user_id', $request->user()->id)
            ->latest('updated_at')
            ->get();

        return response()->json([
            'success' => true,
            'sessions' => $sessions,
        ]);
    }

    public function createSession(Request $request, Note $note)
    {
        $this->authorizeNote($request, $note);

        $session = NoteChatSession::create([
            'note_id' => $note->id,
            'user_id' => $request->user()->id,
            'title' => $request->input('title', 'New Chat'),
        ]);

        return response()->json([
            'success' => true,
            'session' => $session,
        ]);
    }

    public function messages(Request $request, NoteChatSession $session)
    {
        $this->authorizeSession($request, $session);

        $messages = NoteChatMessage::where('note_chat_session_id', $session->id)
            ->oldest()
            ->get(['id', 'role', 'content', 'created_at']);

        return response()->json([
            'success' => true,
            'messages' => $messages,
        ]);
    }
public function sendMessage(Request $request, NoteChatSession $session)
{
    @set_time_limit(120);
    ini_set('max_execution_time', '120');

    $this->authorizeSession($request, $session);

    $request->validate([
        'message' => ['required', 'string', 'max:2000'],
    ]);

    $userMessage = trim($request->message);

    $savedUserMessage = NoteChatMessage::create([
        'note_chat_session_id' => $session->id,
        'role' => 'user',
        'content' => $userMessage,
    ]);

    if ($session->title === 'New Chat') {
        $session->update([
            'title' => Str::limit($userMessage, 40),
        ]);
    }

    $note = $session->note;

    $noteText =
        $note->extracted_text
        ?? $note->content
        ?? $note->description
        ?? '';

    if (!trim($noteText)) {
        $answer = 'I could not find readable text inside this note.';

        NoteChatMessage::create([
            'note_chat_session_id' => $session->id,
            'role' => 'ai',
            'content' => $answer,
        ]);

        $session->touch();

        return response()->json([
            'success' => true,
            'answer' => $answer,
            'session' => $session->fresh(),
        ]);
    }

    /*
    |--------------------------------------------------------------------------
    | Better follow-up handling
    |--------------------------------------------------------------------------
    | If the user says "just?", "more?", "continue", etc.,
    | search the PDF using the previous real user question too.
    */
    $contextQuestion = $userMessage;

    if (preg_match('/^(just\??|only\??|more\??|continue|explain more|what else|why\??)$/i', trim($userMessage))) {
        $lastUserMessage = NoteChatMessage::where('note_chat_session_id', $session->id)
            ->where('role', 'user')
            ->where('id', '!=', $savedUserMessage->id)
            ->latest()
            ->value('content');

        if ($lastUserMessage) {
            $contextQuestion = $lastUserMessage . ' ' . $userMessage;
        }
    }

    // IMPORTANT: send only relevant PDF text, not the full PDF
    $context = $this->buildRelevantContext($noteText, $contextQuestion, 2600);

if (!trim($context)) {
    $answer = 'I could not find this information in the note.';

    NoteChatMessage::create([
        'note_chat_session_id' => $session->id,
        'role' => 'ai',
        'content' => $answer,
    ]);

    $session->touch();

    return response()->json([
        'success' => true,
        'answer' => $answer,
        'session' => $session->fresh(),
    ]);
}

$directAnswer = $this->directAnswerFromContext($context, $userMessage);

if ($directAnswer) {
    NoteChatMessage::create([
        'note_chat_session_id' => $session->id,
        'role' => 'ai',
        'content' => $directAnswer,
    ]);

    $session->touch();

    return response()->json([
        'success' => true,
        'answer' => $directAnswer,
        'session' => $session->fresh(),
    ]);
}
    $previousMessages = NoteChatMessage::where('note_chat_session_id', $session->id)
        ->where('id', '!=', $savedUserMessage->id)
        ->latest()
        ->take(6)
        ->get()
        ->reverse()
        ->map(function ($msg) {
            $role = $msg->role === 'ai' ? 'AI' : 'USER';
            return "{$role}: {$msg->content}";
        })
        ->implode("\n");

    $formatInstruction = 'Answer in one short clear paragraph only. Do not use bullet points.';

    if (preg_match('/points|bullet points|bullets|list|steps|types|advantages|disadvantages/i', $userMessage)) {
        $formatInstruction = 'Answer using bullet points only. Each bullet must start with "- " on a new line. Include all relevant items found in the NOTE CONTENT. Do not answer with only one item unless the NOTE CONTENT has only one item.';
    } elseif (preg_match('/detailed paragraph|explain in detail|more details|detailed/i', $userMessage)) {
        $formatInstruction = 'Answer in one detailed paragraph only. Do not use bullet points.';
    } elseif (preg_match('/small paragraph|short paragraph|briefly|short answer|brief/i', $userMessage)) {
        $formatInstruction = 'Answer in one short paragraph only. Do not use bullet points.';
    }

    $prompt = <<<PROMPT
You are StudyFlow AI.

You must answer using ONLY the NOTE CONTENT below.

VERY STRICT SOURCE RULES:
- Use ONLY facts explicitly written in the NOTE CONTENT.
- Do NOT use outside knowledge.
- Do NOT add writing advice or general explanations from your own knowledge.
- Do NOT add terms that are not in the NOTE CONTENT.
- Do NOT invent examples.
- If answering in points, each bullet must be directly copied or closely cleaned from the NOTE CONTENT.
- If the NOTE CONTENT contains multiple relevant items, include all of them.
- Do not continue after the final relevant item.

If the answer is not found in the NOTE CONTENT, say exactly:
"I could not find this information in the note."

CURRENT FORMAT INSTRUCTION:
{$formatInstruction}

CHAT CONTEXT RULE:
Use PREVIOUS CONVERSATION only to understand follow-up words like "it", "this", "just?", "summarize it", "explain more", or "what else".
Do NOT use previous conversation as a source of facts.
Facts must come ONLY from NOTE CONTENT.

NOTE CONTENT:
{$context}

PREVIOUS CONVERSATION:
{$previousMessages}

CURRENT USER MESSAGE:
{$userMessage}

Answer only from the NOTE CONTENT:
PROMPT;

    try {
        $response = Http::connectTimeout(5)
            ->timeout(90)
            ->post('http://127.0.0.1:11434/api/generate', [
                'model' => env('OLLAMA_CHAT_MODEL', 'qwen2.5:1.5b'),
                'prompt' => $prompt,
                'stream' => false,
                'think' => false,
                'options' => [
                    'temperature' => 0.0,
                    'top_p' => 0.5,
                    'repeat_penalty' => 1.15,
                    'num_ctx' => 2048,
                    'num_predict' => 190,
                ],
            ]);

        if (!$response->successful()) {
            return response()->json([
                'success' => false,
                'message' => 'Ollama failed.',
                'error' => $response->body(),
            ], 500);
        }

        $answer = trim($response->json('response') ?? '');
        $answer = $this->cleanAnswer($answer);

        if (!$answer) {
            $answer = 'No answer returned.';
        }

        NoteChatMessage::create([
            'note_chat_session_id' => $session->id,
            'role' => 'ai',
            'content' => $answer,
        ]);

        $session->touch();

        return response()->json([
            'success' => true,
            'answer' => $answer,
            'session' => $session->fresh(),
        ]);
    } catch (\Throwable $e) {
        return response()->json([
            'success' => false,
            'message' => 'Failed to send message.',
            'error' => $e->getMessage(),
        ], 500);
    }
}
private function buildRelevantContext(string $noteText, string $userMessage, int $maxChars = 2600): string
{
    $noteText = trim($noteText);

    if ($noteText === '') {
        return '';
    }

    $cleanText = preg_replace('/\s+/', ' ', $noteText);

    if (strlen($cleanText) <= $maxChars) {
        return $cleanText;
    }

    $stopWords = [
        'tell', 'about', 'points', 'point', 'bullet', 'bullets',
        'list', 'explain', 'what', 'this', 'from', 'note', 'pdf',
        'give', 'me', 'the', 'and', 'with', 'into', 'just', 'only',
        'more', 'continue'
    ];

    $queryWords = collect(preg_split('/\s+/', strtolower($userMessage)))
        ->map(fn ($word) => preg_replace('/[^a-z0-9]/i', '', $word))
        ->filter(fn ($word) => strlen($word) >= 4)
        ->reject(fn ($word) => in_array($word, $stopWords))
        ->unique()
        ->values();

    $chunks = str_split($cleanText, 650);

    $scored = collect($chunks)->map(function ($chunk, $index) use ($queryWords, $userMessage) {
        $lowerChunk = strtolower($chunk);
        $lowerQuestion = strtolower($userMessage);
        $score = 0;

        foreach ($queryWords as $word) {
            if (str_contains($lowerChunk, $word)) {
                $score += 6;
            }
        }

        /*
        |--------------------------------------------------------------------------
        | Strong boosts for common lecture headings / exact topics
        |--------------------------------------------------------------------------
        */

        // English paragraph PDF
        if (
            str_contains($lowerChunk, 'drafting well-organized') ||
            str_contains($lowerChunk, 'drafting well organized') ||
            str_contains($lowerChunk, 'effective paragraphs') ||
            str_contains($lowerChunk, 'topic sentence') ||
            str_contains($lowerChunk, 'support sentences') ||
            str_contains($lowerChunk, 'paragraph coherence')
        ) {
            $score += 25;
        }

        // Machine learning PDF
        if (
            str_contains($lowerChunk, 'types of machine learning problems') ||
            str_contains($lowerChunk, 'regression') ||
            str_contains($lowerChunk, 'classification') ||
            str_contains($lowerChunk, 'label y is quantitative') ||
            str_contains($lowerChunk, 'label y is categorical') ||
            str_contains($lowerChunk, 'input features x')
        ) {
            $score += 25;
        }

        if (
            str_contains($lowerChunk, 'what is machine learning') ||
            str_contains($lowerChunk, 'learn the rules from data') ||
            str_contains($lowerChunk, 'training data') ||
            str_contains($lowerChunk, 'target or the label')
        ) {
            $score += 18;
        }

        if (
            str_contains($lowerQuestion, 'ashenfelter') &&
            (
                str_contains($lowerChunk, 'ashenfelter') ||
                str_contains($lowerChunk, 'summer temperature') ||
                str_contains($lowerChunk, 'winter rainfall') ||
                str_contains($lowerChunk, 'bordeaux')
            )
        ) {
            $score += 25;
        }

        return [
            'index' => $index,
            'score' => $score,
            'text' => $chunk,
        ];
    });

    $best = $scored->sortByDesc('score')->first();

    if (!$best || $best['score'] <= 0) {
        return substr($cleanText, 0, $maxChars);
    }

    $bestIndex = $best['index'];

    // Take best chunk + neighbors, so the answer has complete nearby context
    $selected = collect([$bestIndex - 1, $bestIndex, $bestIndex + 1])
        ->filter(fn ($i) => isset($chunks[$i]))
        ->map(fn ($i) => $chunks[$i])
        ->implode("\n\n");

    return substr($selected, 0, $maxChars);
}

    private function authorizeSession(Request $request, NoteChatSession $session): void
    {
        if ($session->user_id !== $request->user()->id) {
            abort(403);
        }
    }

    private function cleanAnswer(string $answer): string
    {
        $answer = preg_replace('/<think>.*?<\/think>/is', '', $answer);
        $answer = preg_replace('/```[a-zA-Z]*\s*/', '', $answer);
        $answer = str_replace('```', '', $answer);

        return trim($answer);
    }
}
