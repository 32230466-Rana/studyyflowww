<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Note;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class NoteAiController extends Controller
{
    private string $askPdfBaseUrl = 'http://127.0.0.1:8001';

    public function askText(Request $request, Note $note)
    {
        $request->validate([
            'question' => ['required', 'string', 'max:2000'],
        ]);

        if ($request->user() && $note->user_id !== $request->user()->id) {
            return response()->json([
                'message' => 'Unauthorized.',
            ], 403);
        }

        $question = trim((string) $request->input('question'));

        if ($question === '') {
            return response()->json([
                'message' => 'Question is required.',
            ], 422);
        }

        try {
            /*
            |--------------------------------------------------------------------------
            | If this note is a PDF, use AskPDF backend
            |--------------------------------------------------------------------------
            */
            if ($this->isPdfNote($note)) {
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
                    $processResponse = Http::timeout(300)
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
                    Log::error('AskPDF /process failed', [
                        'note_id' => $note->id,
                        'status' => $processResponse->status(),
                        'body' => $processResponse->body(),
                    ]);

                    return response()->json([
                        'message' => 'Ask PDF failed while processing the PDF.',
                        'error' => $processResponse->body(),
                    ], 500);
                }

                $operationId =
                    $processResponse->json('operation_id')
                    ?? $processResponse->json('operationId')
                    ?? $processResponse->json('document_id')
                    ?? $processResponse->json('documentId');

                if (!$operationId) {
                    return response()->json([
                        'message' => 'Ask PDF processed the PDF, but no operation_id was returned.',
                        'debug' => $processResponse->json(),
                    ], 500);
                }

                $answerResponse = Http::timeout(300)->post($this->askPdfBaseUrl . '/generate', [
                    'question' => $question,
                    'message' => $question,
                    'operation_id' => $operationId,
                    'operationId' => $operationId,
                ]);

                if (!$answerResponse->successful()) {
                    Log::error('AskPDF /generate failed', [
                        'note_id' => $note->id,
                        'operation_id' => $operationId,
                        'status' => $answerResponse->status(),
                        'body' => $answerResponse->body(),
                    ]);

                    return response()->json([
                        'message' => 'Ask PDF failed while generating the answer.',
                        'error' => $answerResponse->body(),
                    ], 500);
                }

                $answer =
                    $answerResponse->json('answer')
                    ?? $answerResponse->json('response')
                    ?? $answerResponse->json('message')
                    ?? $answerResponse->json('text')
                    ?? '';

                return response()->json([
                    'answer' => trim((string) $answer),
                    'sources' => $answerResponse->json('sources') ?? [],
                    'pages' => $answerResponse->json('pages') ?? [],
                    'operation_id' => $operationId,
                    'chunks_used' => $answerResponse->json('chunks_used'),
                    'model' => $answerResponse->json('model'),
                ]);
            }

            /*
            |--------------------------------------------------------------------------
            | Non-PDF notes: keep old text behavior
            |--------------------------------------------------------------------------
            */
            $noteText =
                $note->text_content
                ?? $note->extracted_text
                ?? $note->content
                ?? $note->description
                ?? '';

            if (!trim($noteText)) {
                return response()->json([
                    'message' => 'This note has no text content.',
                    'answer' => 'I could not find readable text inside this note.',
                ], 422);
            }

            $prompt = "
You are StudyFlow AI.

Answer the user's question using ONLY the note content below.
If the answer is not found in the note, say:
I could not find this in the note.

NOTE CONTENT:
{$noteText}

USER QUESTION:
{$question}

ANSWER:
";

            $response = Http::timeout(180)->post('http://127.0.0.1:11434/api/generate', [
                'model' => env('OLLAMA_MODEL', 'qwen3:1.7b'),
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

            return response()->json([
                'answer' => trim($response->json('response') ?? ''),
                'sources' => [],
            ]);
        } catch (\Throwable $e) {
            Log::error('Ask Note service failed', [
                'note_id' => $note->id,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'message' => 'Ask Note service failed.',
                'error' => $e->getMessage(),
            ], 500);
        }
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
