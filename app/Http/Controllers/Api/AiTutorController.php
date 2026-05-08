<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class AiTutorController extends Controller
{
    public function health()
    {
        $baseUrl = rtrim(config('services.ai_tutor.url'), '/');

        try {
            $response = Http::timeout(10)->get($baseUrl . '/health');

            return response()->json(
                $response->json() ?? ['raw' => $response->body()],
                $response->status()
            );
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'AI Tutor service is not reachable.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function generateQuiz(Request $request)
    {
        $validated = $request->validate([
            'content' => ['required', 'string', 'min:200'],
            'title' => ['nullable', 'string'],
            'quiz_type' => ['required', 'string', 'in:mcq,true_false,subjective'],
            'difficulty' => ['nullable', 'string'],
            'questions_count' => ['nullable', 'integer', 'min:1', 'max:10'],
        ]);

        $baseUrl = rtrim(config('services.ai_tutor.url'), '/');
        $timeout = (int) config('services.ai_tutor.timeout', 700);

        try {
            $response = Http::timeout($timeout)
                ->connectTimeout(20)
                ->post($baseUrl . '/studyflow/generate-quiz', [
                    'content' => $validated['content'],
                    'title' => $validated['title'] ?? null,
                    'quiz_type' => $validated['quiz_type'],
                    'difficulty' => $validated['difficulty'] ?? 'Mixed',
                    'questions_count' => $validated['questions_count'] ?? 5,
                ]);

            $data = $response->json();

            if (!$response->successful()) {
                return response()->json([
                    'message' => 'AI Tutor quiz generation failed.',
                    'status' => $response->status(),
                    'error' => $data ?? $response->body(),
                ], $response->status());
            }

            if (isset($data['error'])) {
                return response()->json($data, 500);
            }

            return response()->json($data);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Could not connect to AI Tutor service.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}
