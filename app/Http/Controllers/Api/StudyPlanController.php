<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Note;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class StudyPlanController extends Controller
{
    public function generate(Request $request)
    {
        $data = $request->validate([
            'note_ids' => ['required', 'array', 'min:1'],
            'note_ids.*' => ['integer'],
            'exam_date' => ['required', 'date'],
            'hours_per_day' => ['required', 'integer', 'min:1', 'max:12'],
            'study_days' => ['required', 'integer', 'min:1', 'max:30'],
            'difficulty' => ['nullable', 'string'],
            'focus_mode' => ['nullable', 'string'],
        ]);

        $user = $request->user();
        $notes = Note::where('user_id', $user->id)
            ->whereIn('id', $data['note_ids'])
            ->get();

        if ($notes->isEmpty()) {
            return response()->json([
                'message' => 'No selected notes were found.',
            ], 404);
        }

        $title = $notes->pluck('title')->filter()->join(', ');

        $summary = $notes
            ->map(function ($note) {
                $noteTitle = $note->title ?? 'Untitled note';
                $noteSummary = $note->summary ?? $note->content ?? '';

                return "Note title: {$noteTitle}\nSummary:\n{$noteSummary}";
            })
            ->join("\n\n---\n\n");

        $payload = [
            'title' => $title ?: 'Selected Notes',
            'summary' => mb_substr($summary, 0, 8000),
            'exam_date' => $data['exam_date'],
            'hours_per_day' => (int) $data['hours_per_day'],
            'study_days' => (int) $data['study_days'],
            'difficulty' => $data['difficulty'] ?? 'Medium',
            'focus_mode' => $data['focus_mode'] ?? 'Mixed',
        ];

        try {
            $aiPlan = $this->generateWithOllama($payload);

            if ($aiPlan) {
                return response()->json([
                    'message' => 'Study plan generated successfully.',
                    'source' => 'ollama',
                    'overview' => $aiPlan['overview'],
                    'plan' => $aiPlan['plan'],
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('Ollama study plan failed', [
                'error' => $e->getMessage(),
            ]);
        }

        $fallback = $this->generateFallbackPlan($payload);

        return response()->json([
            'message' => 'Study plan generated with fallback engine.',
            'source' => 'fallback',
            'overview' => $fallback['overview'],
            'plan' => $fallback['plan'],
        ]);
    }

    private function generateWithOllama(array $payload): ?array
    {
        $ollamaHost = rtrim(env('OLLAMA_HOST', 'http://127.0.0.1:11434'), '/');
        $model = env('OLLAMA_MODEL', 'llama3.2:3b');

        $prompt = $this->buildPrompt($payload);

        $response = Http::timeout(180)->post($ollamaHost . '/api/generate', [
            'model' => $model,
            'prompt' => $prompt,
            'stream' => false,
            'options' => [
                'temperature' => 0.2,
                'num_predict' => 1400,
            ],
        ]);

        if (!$response->successful()) {
            return null;
        }

        $text = $response->json('response');

        if (!$text) {
            return null;
        }

        $json = $this->extractJson($text);

        if (!$json) {
            return null;
        }

        $decoded = json_decode($json, true);

        if (!is_array($decoded)) {
            return null;
        }

        if (!isset($decoded['overview']) || !isset($decoded['plan'])) {
            return null;
        }

        if (!is_array($decoded['plan']) || count($decoded['plan']) === 0) {
            return null;
        }

        return $decoded;
    }

    private function buildPrompt(array $payload): string
    {
        return <<<PROMPT
You are an AI study planner inside StudyFlow.

Create a personalized study plan using ONLY the provided note summary and user settings.
Do not invent topics outside the provided material.

Return VALID JSON ONLY.
No markdown.
No explanation outside JSON.

Required JSON format:
{
  "overview": {
    "note_title": "string",
    "exam_date": "string",
    "study_days": number,
    "hours_per_day": number,
    "difficulty": "string",
    "focus_mode": "string",
    "main_goal": "string"
  },
  "plan": [
    {
      "day": number,
      "title": "Day 1",
      "hours": number,
      "focus": "string",
      "tasks": [
        "task 1",
        "task 2",
        "task 3"
      ]
    }
  ]
}

Rules:
- Generate exactly {$payload['study_days']} days.
- Each day should fit {$payload['hours_per_day']} hours.
- Use the note summary to choose useful revision topics.
- Include summary review, quiz practice, Ask PDF, and revision when useful.
- The last day should focus on final revision and mistakes.
- Tasks must be clear and practical for a student.
- Do not mention that you are an AI.

User settings:
Note title: {$payload['title']}
Exam date: {$payload['exam_date']}
Study days: {$payload['study_days']}
Hours per day: {$payload['hours_per_day']}
Difficulty: {$payload['difficulty']}
Focus mode: {$payload['focus_mode']}

Note summary:
{$payload['summary']}
PROMPT;
    }

    private function extractJson(string $text): ?string
    {
        $text = trim($text);

        $start = strpos($text, '{');
        $end = strrpos($text, '}');

        if ($start === false || $end === false || $end <= $start) {
            return null;
        }

        return substr($text, $start, $end - $start + 1);
    }

    private function generateFallbackPlan(array $payload): array
    {
        $studyDays = (int) $payload['study_days'];
        $hoursPerDay = (int) $payload['hours_per_day'];
        $focusMode = $payload['focus_mode'];
        $title = $payload['title'];

        $plan = [];

        for ($day = 1; $day <= $studyDays; $day++) {
            if ($day === 1) {
                $tasks = [
                    "Read the summary of {$title}",
                    "Review the main definitions and key ideas",
                    "Ask PDF to explain unclear concepts",
                ];
                $focus = "Summary Review";
            } elseif ($day === $studyDays) {
                $tasks = [
                    "Final revision of all important concepts",
                    "Solve a mixed quiz",
                    "Review mistakes before the exam",
                ];
                $focus = "Final Revision";
            } elseif ($focusMode === 'Quiz') {
                $tasks = [
                    "Generate and solve MCQ questions",
                    "Practice True/False questions",
                    "Review wrong answers and explanations",
                ];
                $focus = "Quiz Practice";
            } elseif ($focusMode === 'Ask PDF') {
                $tasks = [
                    "Ask PDF to explain difficult topics",
                    "Ask PDF for simple examples",
                    "Write short revision notes from the answers",
                ];
                $focus = "Ask PDF Support";
            } elseif ($focusMode === 'Revision') {
                $tasks = [
                    "Revise weak topics",
                    "Review summary notes",
                    "Practice questions from previous mistakes",
                ];
                $focus = "Revision";
            } else {
                $tasks = [
                    "Review summary",
                    "Solve quiz practice",
                    "Use Ask PDF for weak or unclear topics",
                ];
                $focus = "Mixed Study";
            }

            $plan[] = [
                'day' => $day,
                'title' => "Day {$day}",
                'hours' => $hoursPerDay,
                'focus' => $focus,
                'tasks' => $tasks,
            ];
        }

        return [
            'overview' => [
                'note_title' => $title,
                'exam_date' => $payload['exam_date'],
                'study_days' => $studyDays,
                'hours_per_day' => $hoursPerDay,
                'difficulty' => $payload['difficulty'],
                'focus_mode' => $focusMode,
                'main_goal' => 'Study the note, practice quizzes, and revise weak topics before the exam.',
            ],
            'plan' => $plan,
        ];
    }
}
