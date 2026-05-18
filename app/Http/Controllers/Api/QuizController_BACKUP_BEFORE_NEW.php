<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\QuizGenerationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use InvalidArgumentException;
use RuntimeException;
use Smalot\PdfParser\Parser as PdfParser;
use Throwable;

class QuizController extends Controller
{
    public function __construct(
        private QuizGenerationService $quizGenerationService
    ) {}

    public function generate(Request $request): JsonResponse
    {
        set_time_limit(300);

        $validated = $request->validate([
            'pdf' => ['required', 'file', 'mimes:pdf', 'max:20480'],
            'difficulty' => ['nullable', 'in:easy,medium,hard'],
            'existing_questions' => ['nullable', 'string'],
            'count' => ['nullable', 'integer', 'min:1', 'max:10'],
        ]);

        $uploadedFile = $request->file('pdf');

        if (! $uploadedFile) {
            return response()->json([
                'message' => 'PDF file is required.',
            ], 422);
        }

        $storedPath = $uploadedFile->store('quiz_uploads', 'public');
        $absolutePath = Storage::disk('public')->path($storedPath);
        $pdfTitle = pathinfo($uploadedFile->getClientOriginalName(), PATHINFO_FILENAME);

        try {
            $extractedText = $this->extractPdfText($absolutePath);

            Log::info('QUIZ PDF TEXT PREVIEW', [
                'file_name' => $uploadedFile->getClientOriginalName(),
                'title' => $pdfTitle,
                'length' => Str::length($extractedText),
                'preview' => Str::limit($extractedText, 1000),
            ]);

            if ($extractedText === '' || Str::length($extractedText) < 200) {
                return response()->json([
                    'message' => 'Extracted PDF text is too short or unreadable to generate quiz questions.',
                ], 422);
            }

            $existingQuestions = json_decode($validated['existing_questions'] ?? '[]', true);

            if (! is_array($existingQuestions)) {
                $existingQuestions = [];
            }

            $quiz = $this->quizGenerationService->generateFromText(
                $extractedText,
                $validated['difficulty'] ?? 'medium',
                $pdfTitle,
                $existingQuestions,
                (int) ($validated['count'] ?? 5)
            );

            return response()->json([
                'message' => 'Quiz generated successfully.',
                'data' => [
                    'file_name' => $uploadedFile->getClientOriginalName(),
                    'title' => $pdfTitle,
                    'difficulty' => $quiz['difficulty'],
                    'count' => count($quiz['questions']),
                    'questions' => $quiz['questions'],
                ],
            ], 200);
        } catch (InvalidArgumentException $e) {
            return response()->json([
                'message' => 'Quiz input is invalid.',
                'error' => $e->getMessage(),
            ], 422);
        } catch (RuntimeException $e) {
            return response()->json([
                'message' => 'Quiz generation failed.',
                'error' => $e->getMessage(),
            ], 422);
        } catch (Throwable $e) {
            return response()->json([
                'message' => 'Unexpected server error.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    private function extractPdfText(string $absolutePath): string
    {
        try {
            $parser = new PdfParser();
            $pdf = $parser->parseFile($absolutePath);
            $text = $pdf->getText();

            return $this->cleanText($text);
        } catch (Throwable $e) {
            throw new RuntimeException('Failed to extract text from PDF: ' . $e->getMessage());
        }
    }

    private function cleanText(string $text): string
    {
        $text = strip_tags($text);
        $text = preg_replace('/\R+/', "\n", $text);
        $text = preg_replace('/[ \t]+/', ' ', $text);
        $text = trim($text);

        if (Str::length($text) > 1500) {
            $text = Str::substr($text, 0, 1500);
        }

        return $text;
    }
}
