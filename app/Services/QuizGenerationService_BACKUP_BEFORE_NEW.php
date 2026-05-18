<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;
use RuntimeException;

class QuizGenerationService
{
    private const ALLOWED_DIFFICULTIES = ['easy', 'medium', 'hard'];
    private const DEFAULT_BATCH_SIZE = 5;
    private const MAX_TOTAL_QUESTIONS = 10;

    public function generateFromText(
        string $text,
        string $difficulty = 'medium',
        ?string $title = null,
        array $existingQuestions = [],
        int $count = self::DEFAULT_BATCH_SIZE
    ): array {
        $text = $this->cleanText($text);

        if ($text === '') {
            throw new InvalidArgumentException('Extracted text is empty.');
        }

        $difficulty = strtolower(trim($difficulty));
        if (! in_array($difficulty, self::ALLOWED_DIFFICULTIES, true)) {
            $difficulty = 'medium';
        }

        $count = max(1, min(5, $count));
        $title = $title ? trim($title) : 'Uploaded PDF';

        $existingQuestions = array_values(array_filter($existingQuestions, function ($q) {
            return is_array($q) && ! empty($q['question']);
        }));

        if (count($existingQuestions) >= self::MAX_TOTAL_QUESTIONS) {
            return [
                'difficulty' => $difficulty,
                'questions' => [],
            ];
        }

        $remainingAllowed = self::MAX_TOTAL_QUESTIONS - count($existingQuestions);
        $count = min($count, $remainingAllowed);

        $text = $this->selectBestChunks($text, 1, 1200);

        $prompt = $this->buildPrompt($text, $difficulty, $title, $existingQuestions, $count);
        $raw = $this->sendToOllama($prompt);
        Log::info('QUIZ RAW OUTPUT', [
            'raw' => $raw,
        ]);

        Log::info('QUIZ RAW OUTPUT PREVIEW', [
            'preview' => mb_substr($raw, 0, 3000),
        ]);
        Log::info('QUIZ RAW OUTPUT', ['raw' => $raw]);

        $questions = $this->parseQuizOutput($raw);
        Log::info('QUIZ PARSED QUESTIONS COUNT', [
            'count' => count($questions),
        ]);
        $questions = $this->filterAgainstExistingQuestions($questions, $existingQuestions, $count);
        if (count($questions) === 0) {
            throw new RuntimeException('Model output could not be parsed into valid questions.');
        }
        return [
            'difficulty' => $difficulty,
            'questions' => array_slice($questions, 0, $count),
        ];
    }

    private function buildPrompt(
        string $text,
        string $difficulty,
        string $title,
        array $existingQuestions,
        int $count
    ): string {
        $difficultyHint = $this->difficultyHint($difficulty);
        $existingList = '';

        if (! empty($existingQuestions)) {
            foreach ($existingQuestions as $index => $question) {
                if (! empty($question['question'])) {
                    $existingList .= ($index + 1) . '. ' . $question['question'] . "\n";
                }
            }
        } else {
            $existingList = "None\n";
        }

        return <<<PROMPT
You are an expert university instructor creating high-quality multiple-choice questions from study material.

Generate exactly {$count} short MCQ questions
Keep explanations very short (1 sentence only)

Rules:
- Use only the provided source text.
- Each question must test a different concept.
- Do not repeat existing questions.
- Keep the questions clear and concise.
- Each question must include a "topic" (1-3 words) identifying the specific sub-topic being tested.
- Each question must have exactly 4 options.
- Each question must have exactly 1 correct answer.
- Each question must include a short explanation.
- Return ONLY valid JSON.
- Do not wrap the JSON in markdown fences.
- Do not include commentary before or after the JSON.

Difficulty guidance:
{$difficultyHint}

Existing questions to avoid:
{$existingList}

Source title:
{$title}

Return this exact schema:
{
  "questions": [
    {
      "question": "string",
      "topic": "string",
      "options": {
        "A": "string",
        "B": "string",
        "C": "string",
        "D": "string"
      },
      "correct_answer": "A",
      "explanation": "string"
    }
  ]
}

Source text:
{$text}
PROMPT;
    }

    private function difficultyHint(string $difficulty): string
    {
        return match ($difficulty) {
            'easy' => 'Focus on direct definitions, basic understanding, and simple recall questions.',

            'medium' => 'Focus on understanding concepts, applying ideas, comparing related concepts, and identifying correct practical usage. Avoid very basic definition-only questions.',

            'hard' => 'Focus on deeper reasoning, analysis, comparisons, scenario-based thinking, and strong distractors. Avoid simple recall questions.',

            default => 'Focus on understanding concepts, applying ideas, and moderate reasoning. Avoid overly simple definition questions.',
        };
    }

    private function sendToOllama(string $prompt): string
    {
        $baseUrl = rtrim(config('services.ollama.base_url', 'http://127.0.0.1:11434'), '/');
        $model = config('services.ollama.model', 'phi3:mini');
        $timeout = (int) config('services.ollama.timeout', 180);
        $connectTimeout = (int) config('services.ollama.connect_timeout', 10);

        $response = Http::acceptJson()
            ->timeout($timeout)
            ->connectTimeout($connectTimeout)
            ->retry(1, 1000)
            ->post($baseUrl . '/api/generate', [
                'model' => $model,
                'prompt' => $prompt,
                'stream' => false,
                'options' => [
                    'temperature' => 0.1,
                    'top_p' => 0.8,
                    'num_predict' => 800,
                    'num_ctx' => 1024,
                ],
            ]);

        if (! $response->successful()) {
            throw new RuntimeException(
                'Ollama request failed with status ' . $response->status() . ': ' . $response->body()
            );
        }

        $json = $response->json();
        $raw = $json['response'] ?? $json['message']['content'] ?? null;

        if (! is_string($raw) || trim($raw) === '') {
            throw new RuntimeException('Ollama returned an empty response.');
        }

        return trim($raw);
    }

    private function parseQuizOutput(string $raw): array
    {
        $raw = trim($raw);

        $jsonQuestions = $this->parseJsonQuizOutput($raw);
        if (count($jsonQuestions) > 0) {
            return $jsonQuestions;
        }

        return $this->parsePlainQuizOutput($raw);
    }

    private function parseJsonQuizOutput(string $raw): array
    {
        $clean = trim($raw);

        $clean = preg_replace('/^```(?:json)?\s*/i', '', $clean) ?? $clean;
        $clean = preg_replace('/\s*```\s*$/', '', $clean) ?? $clean;
        $clean = trim($clean);

        $start = strpos($clean, '{');
        $end = strrpos($clean, '}');

        if ($start !== false && $end !== false && $end > $start) {
            $clean = substr($clean, $start, $end - $start + 1);
        }

        $decoded = json_decode($clean, true);

        if (! is_array($decoded)) {
            return [];
        }

        $questions = $decoded['questions'] ?? null;

        if (! is_array($questions) || ! array_is_list($questions)) {
            return [];
        }

        $normalized = [];

        foreach ($questions as $question) {
            if (! is_array($question)) {
                continue;
            }

            $questionText = trim((string) ($question['question'] ?? ''));
            $topic = trim((string) ($question['topic'] ?? 'General'));
            $explanation = trim((string) (
                $question['explanation']
                ?? $question['explangy']
                ?? ''
            ));
            $options = $this->normalizeOptions($question['options'] ?? null);
            $correctAnswer = $this->normalizeCorrectAnswer($question['correct_answer'] ?? '', $options ?? []);

            if (
                $questionText === '' ||
                $explanation === '' ||
                $options === null ||
                $correctAnswer === null ||
                $this->hasDuplicateOptions($options)
            ) {
                continue;
            }

            $normalized[] = [
                'question' => $questionText,
                'topic' => $topic,
                'options' => $options,
                'correct_answer' => $correctAnswer,
                'explanation' => $explanation,
            ];
        }

        return $normalized;
    }

    private function parsePlainQuizOutput(string $raw): array
    {
        $raw = str_replace("\r", "", trim($raw));

        $pattern = '/Q\d+\s*:\s*(.*?)\n+'
            . 'A[\)\.\-:]\s*(.*?)\n+'
            . 'B[\)\.\-:]\s*(.*?)\n+'
            . 'C[\)\.\-:]\s*(.*?)\n+'
            . 'D[\)\.\-:]\s*(.*?)\n+'
            . '(?:Correct|Correct Answer)\s*:\s*([ABCD1-4])\n+'
            . 'Explanation\s*:\s*(.*?)(?=\n+Q\d+\s*:|\z)/si';

        preg_match_all($pattern, $raw, $matches, PREG_SET_ORDER);

        $questions = [];

        foreach ($matches as $match) {
            $questionText = trim($match[1] ?? '');
            $options = [
                'A' => trim($match[2] ?? ''),
                'B' => trim($match[3] ?? ''),
                'C' => trim($match[4] ?? ''),
                'D' => trim($match[5] ?? ''),
            ];
            $correctAnswer = strtoupper(trim($match[6] ?? ''));
            $explanation = trim($match[7] ?? '');

            if ($correctAnswer === '1') $correctAnswer = 'A';
            if ($correctAnswer === '2') $correctAnswer = 'B';
            if ($correctAnswer === '3') $correctAnswer = 'C';
            if ($correctAnswer === '4') $correctAnswer = 'D';

            if (
                $questionText === '' ||
                $explanation === '' ||
                in_array('', $options, true) ||
                ! in_array($correctAnswer, ['A', 'B', 'C', 'D'], true)
            ) {
                continue;
            }

            if ($this->hasDuplicateOptions($options)) {
                continue;
            }

            $questions[] = [
                'question' => $questionText,
                'options' => $options,
                'correct_answer' => $correctAnswer,
                'explanation' => $explanation,
            ];
        }

        return $questions;
    }

    private function filterAgainstExistingQuestions(
        array $questions,
        array $existingQuestions,
        int $limit
    ): array {
        $newQuestions = [];

        foreach ($questions as $question) {
            if (! is_array($question) || empty($question['question'])) {
                continue;
            }

            $isDuplicate = false;

            foreach ($existingQuestions as $existing) {
                if (
                    isset($existing['question']) &&
                    $this->normalizeQuestionText($existing['question']) ===
                    $this->normalizeQuestionText($question['question'])
                ) {
                    $isDuplicate = true;
                    break;
                }
            }

            foreach ($newQuestions as $existingNew) {
                if (
                    $this->normalizeQuestionText($existingNew['question']) ===
                    $this->normalizeQuestionText($question['question'])
                ) {
                    $isDuplicate = true;
                    break;
                }
            }

            if (! $isDuplicate) {
                $newQuestions[] = $question;
            }

            if (count($newQuestions) >= $limit) {
                break;
            }
        }

        return array_slice($newQuestions, 0, $limit);
    }

    private function normalizeOptions(mixed $options): ?array
    {
        if (! is_array($options)) {
            return null;
        }

        $normalized = [
            'A' => trim((string) ($options['A'] ?? $options['a'] ?? '')),
            'B' => trim((string) ($options['B'] ?? $options['b'] ?? '')),
            'C' => trim((string) ($options['C'] ?? $options['c'] ?? '')),
            'D' => trim((string) ($options['D'] ?? $options['d'] ?? '')),
        ];

        if (in_array('', $normalized, true)) {
            return null;
        }

        return $normalized;
    }

    private function normalizeCorrectAnswer(mixed $correctAnswer, array $options): ?string
    {
        $correctAnswer = strtoupper(trim((string) $correctAnswer));

        if (in_array($correctAnswer, ['A', 'B', 'C', 'D'], true)) {
            return $correctAnswer;
        }

        foreach ($options as $key => $value) {
            if (mb_strtolower(trim((string) $value)) === mb_strtolower(trim((string) $correctAnswer))) {
                return $key;
            }
        }

        return null;
    }

    private function hasDuplicateOptions(array $options): bool
    {
        $normalized = array_map(
            fn($value) => mb_strtolower(trim((string) $value)),
            $options
        );

        return count($normalized) !== count(array_unique($normalized));
    }

    private function normalizeQuestionText(string $text): string
    {
        $text = mb_strtolower($text);
        $text = preg_replace('/[^\p{L}\p{N}\s]+/u', ' ', $text) ?? $text;
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;

        return trim($text);
    }

    private function cleanText(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $text = preg_replace('/[ \t]+/u', ' ', $text) ?? $text;
        $text = preg_replace("/\n{3,}/u", "\n\n", $text) ?? $text;

        return trim($text);
    }

    private function splitIntoChunks(string $text, int $maxChunkLength = 2200): array
    {
        $paragraphs = preg_split("/\n\s*\n/u", $text) ?: [];
        $paragraphs = array_values(array_filter(array_map('trim', $paragraphs)));

        $chunks = [];
        $current = '';

        foreach ($paragraphs as $paragraph) {
            if ($paragraph === '') {
                continue;
            }

            $candidate = $current === '' ? $paragraph : $current . "\n\n" . $paragraph;

            if (mb_strlen($candidate) <= $maxChunkLength) {
                $current = $candidate;
            } else {
                if ($current !== '') {
                    $chunks[] = $current;
                }
                $current = $paragraph;
            }
        }

        if ($current !== '') {
            $chunks[] = $current;
        }

        return array_values(array_filter($chunks, fn($chunk) => mb_strlen($chunk) >= 100));
    }

    private function scoreChunk(string $chunk): int
    {
        $lengthScore = min(40, (int) floor(mb_strlen($chunk) / 60));

        $keywordMatches = preg_match_all(
            '/\b(is|are|means|defined|definition|concept|process|steps|types|example|examples|function|important|because|therefore|used|called|formula|method)\b/iu',
            $chunk
        );

        return $lengthScore + (($keywordMatches ?: 0) * 3);
    }

    private function selectBestChunks(string $text, int $maxChunks = 5, int $maxTotalLength = 12000): string
    {
        $chunks = $this->splitIntoChunks($text);

        if (empty($chunks)) {
            return mb_substr($text, 0, $maxTotalLength);
        }

        usort($chunks, fn($a, $b) => $this->scoreChunk($b) <=> $this->scoreChunk($a));

        $selected = [];
        $totalLength = 0;

        foreach ($chunks as $chunk) {
            $chunkLength = mb_strlen($chunk);

            if ($totalLength + $chunkLength > $maxTotalLength) {
                continue;
            }

            $selected[] = $chunk;
            $totalLength += $chunkLength;

            if (count($selected) >= $maxChunks) {
                break;
            }
        }

        return empty($selected)
            ? mb_substr($text, 0, $maxTotalLength)
            : implode("\n\n", $selected);
    }
}
