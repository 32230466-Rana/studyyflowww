<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Summary;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class LocalAiController extends Controller
{
    private string $fastApiUrl = 'http://127.0.0.1:8002';

    public function health(): JsonResponse
    {
        try {
            $response = Http::timeout(10)->get($this->fastApiUrl . '/');

            return response()->json([
                'success' => true,
                'message' => 'LocalAiController exists and Laravel reached FastAPI.',
                'fastapi_status' => $response->status(),
                'fastapi' => $response->json(),
            ]);
        } catch (Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => 'Controller exists, but Laravel could not reach FastAPI.',
                'error' => $e->getMessage(),
            ], 502);
        }
    }

    public function summarizeText(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'text' => ['required', 'string', 'min:5'],
            'title' => ['nullable', 'string', 'max:255'],
            'note_id' => ['nullable', 'integer'],
        ]);

        try {
            $response = Http::timeout(1200)
                ->connectTimeout(10)
                ->acceptJson()
                ->post($this->fastApiUrl . '/conversation', [
                    'human_input' => $validated['text'],
                ]);

            if (!$response->successful()) {
                return response()->json([
                    'success' => false,
                    'message' => 'FastAPI summary request failed.',
                    'status' => $response->status(),
                    'body' => $response->body(),
                ], 502);
            }

            $data = $response->json() ?? [];

            $summary = $data['output']
                ?? $data['summary']
                ?? $data['result']
                ?? null;

            if (!$summary || trim($summary) === '') {
                return response()->json([
                    'success' => false,
                    'message' => 'Summary service returned empty result.',
                    'raw' => $data,
                ], 502);
            }

            $saved = $this->saveSummarySafely(
                $request,
                $summary,
                $validated['title'] ?? 'Quick Summary',
                'text',
                $validated['note_id'] ?? null
            );

            return response()->json([
                'success' => true,
                'message' => $saved
                    ? 'Summary generated and saved to My Summaries.'
                    : 'Summary generated successfully, but was not saved.',
                'summary' => $summary,
                'processing_time_seconds' => $data['processing_time_seconds'] ?? null,
                'processing_time_minutes' => $data['processing_time_minutes'] ?? null,
                'saved_to_my_summaries' => (bool) $saved,
                'summary_id' => $saved?->id,
                'raw' => $data,
            ]);
        } catch (Throwable $e) {
            Log::error('Local AI text summary failed', [
                'message' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to generate summary.',
                'error' => $e->getMessage(),
            ], 502);
        }
    }

    public function summarizeFile(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'uploaded_file' => ['required', 'file', 'max:204800'],
            'title' => ['nullable', 'string', 'max:255'],
            'note_id' => ['nullable', 'integer'],
        ]);

        $file = $validated['uploaded_file'];

        try {
            $response = Http::timeout(1200)
                ->connectTimeout(10)
                ->acceptJson()
                ->attach(
                    'uploaded_file',
                    file_get_contents($file->getRealPath()),
                    $file->getClientOriginalName()
                )
                ->post($this->fastApiUrl . '/file/upload');

            if (!$response->successful()) {
                return response()->json([
                    'success' => false,
                    'message' => 'FastAPI file summary request failed.',
                    'status' => $response->status(),
                    'body' => $response->body(),
                ], 502);
            }

            $data = $response->json() ?? [];

            $summary = $data['result']
                ?? $data['output']
                ?? $data['summary']
                ?? null;

            if (!$summary || trim($summary) === '') {
                return response()->json([
                    'success' => false,
                    'message' => 'Summary service returned empty result.',
                    'raw' => $data,
                ], 502);
            }

            $title = $validated['title']
                ?? ('Summary of ' . $file->getClientOriginalName());

            $saved = $this->saveSummarySafely(
                $request,
                $summary,
                $title,
                $data['file_type'] ?? 'file',
                $validated['note_id'] ?? null
            );

            return response()->json([
                'success' => true,
                'message' => $saved
                    ? 'File summary generated and saved to My Summaries.'
                    : 'File summary generated successfully, but was not saved.',
                'summary' => $summary,
                'file_type' => $data['file_type'] ?? null,
                'processing_time_seconds' => $data['processing_time_seconds'] ?? null,
                'processing_time_minutes' => $data['processing_time_minutes'] ?? null,
                'saved_to_my_summaries' => (bool) $saved,
                'summary_id' => $saved?->id,
                'raw' => $data,
            ]);
        } catch (Throwable $e) {
            Log::error('Local AI file summary failed', [
                'message' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to generate summary from file.',
                'error' => $e->getMessage(),
            ], 502);
        }
    }

    public function quizText(Request $request): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'Quiz endpoint is not connected in this FastAPI version yet.',
        ], 501);
    }

    public function quizFile(Request $request): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'Quiz file endpoint is not connected in this FastAPI version yet.',
        ], 501);
    }

    private function saveSummarySafely(
        Request $request,
        string $summaryText,
        string $title,
        string $sourceType,
        ?int $noteId = null
    ): ?Summary {
        try {
            $user = $request->user();

            if (!$user) {
                return null;
            }

            $summary = new Summary();
            $summary->user_id = $user->id;

            if ($noteId !== null) {
                $summary->note_id = $noteId;
            }

            $summary->title = $title;
            $summary->source_type = $sourceType;
            $summary->summary_text = $summaryText;
            $summary->save();

            return $summary;
        } catch (Throwable $e) {
            Log::error('Failed to save local AI summary', [
                'message' => $e->getMessage(),
            ]);

            return null;
        }
    }
}