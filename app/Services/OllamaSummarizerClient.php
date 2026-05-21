<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class OllamaSummarizerClient
{
    private function baseUrl(): string
    {
        return rtrim((string) config('services.ollama_summarizer.url', 'http://127.0.0.1:8002'), '/');
    }

    private function timeout(): int
    {
        return (int) config('services.ollama_summarizer.timeout', 1200);
    }

    private function connectTimeout(): int
    {
        return (int) config('services.ollama_summarizer.connect_timeout', 10);
    }

    public function health(): array
    {
        $response = Http::connectTimeout($this->connectTimeout())
            ->timeout(30)
            ->acceptJson()
            ->get($this->baseUrl() . '/');

        $this->throwIfFailed($response, 'FastAPI health check failed');

        return $response->json() ?? [
            'message' => 'FastAPI responded',
            'status' => $response->status(),
        ];
    }

    public function summarizeText(string $text): array
    {
        $response = Http::connectTimeout($this->connectTimeout())
            ->timeout($this->timeout())
            ->acceptJson()
            ->post($this->baseUrl() . '/conversation', [
                'human_input' => $text,
            ]);

        $this->throwIfFailed($response, 'Text summary failed');

        return $this->normalizeSummaryResponse($response->json() ?? [], 'text');
    }

    public function summarizeFile(UploadedFile $file): array
    {
        $handle = fopen($file->getRealPath(), 'r');

        try {
            $response = Http::connectTimeout($this->connectTimeout())
                ->timeout($this->timeout())
                ->acceptJson()
                ->attach(
                    'uploaded_file',
                    $handle,
                    $file->getClientOriginalName(),
                    ['Content-Type' => $file->getMimeType() ?: 'application/octet-stream']
                )
                ->post($this->baseUrl() . '/file/upload');
        } finally {
            if (is_resource($handle)) {
                fclose($handle);
            }
        }

        $this->throwIfFailed($response, 'File summary failed');

        return $this->normalizeSummaryResponse($response->json() ?? [], 'file');
    }

    public function generateQuizFromText(string $text, int $numberOfQuestions = 5, string $difficulty = 'Mixed'): array
    {
        $response = Http::connectTimeout($this->connectTimeout())
            ->timeout($this->timeout())
            ->acceptJson()
            ->post($this->baseUrl() . '/quiz/text', [
                'text' => $text,
                'number_of_questions' => $numberOfQuestions,
                'difficulty' => $difficulty,
            ]);

        $this->throwIfFailed($response, 'Text quiz generation failed');

        return $this->normalizeQuizResponse($response->json() ?? []);
    }

    public function generateQuizFromFile(UploadedFile $file, int $numberOfQuestions = 5, string $difficulty = 'Mixed'): array
    {
        $handle = fopen($file->getRealPath(), 'r');

        try {
            $url = $this->baseUrl() . '/quiz/file/upload'
                . '?number_of_questions=' . urlencode((string) $numberOfQuestions)
                . '&difficulty=' . urlencode($difficulty);

            $response = Http::connectTimeout($this->connectTimeout())
                ->timeout($this->timeout())
                ->acceptJson()
                ->attach(
                    'uploaded_file',
                    $handle,
                    $file->getClientOriginalName(),
                    ['Content-Type' => $file->getMimeType() ?: 'application/octet-stream']
                )
                ->post($url);
        } finally {
            if (is_resource($handle)) {
                fclose($handle);
            }
        }

        $this->throwIfFailed($response, 'File quiz generation failed');

        return $this->normalizeQuizResponse($response->json() ?? []);
    }

    private function normalizeSummaryResponse(array $json, string $sourceType): array
    {
        return [
            'message' => $json['message'] ?? 'Summary generated successfully',
            'summary' => $json['result'] ?? $json['output'] ?? $json['summary'] ?? null,
            'source_type' => $sourceType,
            'file_type' => $json['file_type'] ?? $sourceType,
            'model' => $json['model'] ?? null,
            'processing_time_seconds' => $json['processing_time_seconds'] ?? null,
            'processing_time_minutes' => $json['processing_time_minutes'] ?? null,
            'raw' => $json,
        ];
    }

    private function normalizeQuizResponse(array $json): array
    {
        $questions = $json['questions'] ?? data_get($json, 'answer.questions') ?? [];

        return [
            'message' => $json['message'] ?? 'Quiz generated successfully',
            'questions' => $questions,
            'model' => $json['model'] ?? null,
            'difficulty' => $json['difficulty'] ?? null,
            'number_of_questions' => $json['number_of_questions'] ?? count($questions),
            'processing_time_seconds' => $json['processing_time_seconds'] ?? null,
            'processing_time_minutes' => $json['processing_time_minutes'] ?? null,
            'raw' => $json,
        ];
    }

    private function throwIfFailed($response, string $message): void
    {
        if ($response->successful()) {
            return;
        }

        $body = mb_substr($response->body(), 0, 1500);

        throw new RuntimeException(
            $message . ' | Status: ' . $response->status() . ' | Body: ' . $body
        );
    }
}
