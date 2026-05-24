<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\StoreNoteRequest;
use App\Http\Resources\NoteResource;
use App\Models\Note;
use App\Services\Notes\NoteContentExtractor;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use App\Services\ActivityLogger;

class NoteController extends Controller
{
    public function index(Request $request)
    {
        $notes = $request->user()
            ->notes()
            ->where(function ($query) {
                $query->whereNull('status')
                    ->orWhere('status', '!=', 'inactive');
            })
            ->latest()
            ->paginate(15);

        $payload = NoteResource::collection($notes)->response()->getData(true);

        return ApiResponse::success(
            $payload['data'] ?? [],
            'OK',
            200,
            [
                'links' => $payload['links'] ?? null,
                'pagination' => $payload['meta'] ?? null,
            ]
        );
    }

    public function store(StoreNoteRequest $request)
    {
        $uploadedFile = $request->file('pdf');

        $storedPath = null;
        $originalFilename = null;
        $mimeType = null;
        $fileSize = null;

        if ($uploadedFile) {
            $storedPath = $uploadedFile->store('notes', 'private');
            $originalFilename = $uploadedFile->getClientOriginalName();
            $mimeType = $uploadedFile->getMimeType();
            $fileSize = $uploadedFile->getSize();
        }

        $textContent = '';

        if (! $uploadedFile) {
            $textContent = trim((string) $request->input('text_content', ''));
        }

        $note = Note::create([
            'user_id' => $request->user()->id,
            'title' => $request->input('title'),
            'description' => $request->input('description'),
            'original_filename' => $originalFilename,
            'stored_path' => $storedPath,
            'mime_type' => $mimeType,
            'file_size' => $fileSize,
            'source_type' => $uploadedFile ? 'file' : 'text',
            'text_content' => $textContent,
            'status' => 'uploaded',
        ]);

        ActivityLogger::log(
            $request->user()->id,
            'note_uploaded',
            'Note uploaded',
            $note->title ?? 'Untitled note',
            Note::class,
            $note->id
        );
        // Best-effort extraction: never fail the upload if extraction is empty/unavailable.
        if ($uploadedFile && $storedPath) {
            try {
                $extractor = app(NoteContentExtractor::class);
                $extractedText = $extractor->extractFromStorage($storedPath, $originalFilename);

                if (filled($extractedText)) {
                    $note->forceFill([
                        'text_content' => $extractedText,
                        'extracted_text' => $extractedText,
                        'extracted_text_length' => mb_strlen($extractedText),
                    ])->save();
                }
            } catch (\Throwable $e) {
                // Intentionally ignored: scanned/image PDFs may not contain extractable text yet.
            }
        }

        return ApiResponse::success(
            (new NoteResource($note))->resolve($request),
            'Note created.',
            201
        );
    }

    public function show(Request $request, int $id)
    {
        $note = $this->userNoteOrFail($request, $id);

        return ApiResponse::success(
            (new NoteResource($note))->resolve($request),
            'OK'
        );
    }

    public function update(Request $request, int $id)
    {
        $note = $this->userNoteOrFail($request, $id);

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],
        ]);

        $note->forceFill([
            'title' => trim((string) $validated['title']),
            'description' => array_key_exists('description', $validated)
                ? (is_null($validated['description']) ? null : trim((string) $validated['description']))
                : $note->description,
        ])->save();

        return ApiResponse::success(
            (new NoteResource($note))->resolve($request),
            'Note updated.'
        );
    }

    public function destroy(Request $request, int $id)
    {
        $note = $this->userNoteOrFail($request, $id);

        if ($note->stored_path) {
            Storage::disk('private')->delete($note->stored_path);
        }

        $note->delete();

        return ApiResponse::success(null, 'Note deleted.');
    }

    public function download(Request $request, int $id)
    {
        $note = $this->userNoteOrFail($request, $id);

        if (! $note->stored_path) {
            return ApiResponse::error('No file available for this note.', 404);
        }

        if (! Storage::disk('private')->exists($note->stored_path)) {
            return ApiResponse::error('File not found.', 404);
        }

        $filename = $note->original_filename ?: ('note-' . $note->id);

        $fullPath = Storage::disk('private')->path($note->stored_path);

        return response()->download(
            $fullPath,
            $filename,
            $note->mime_type ? ['Content-Type' => $note->mime_type] : []
        );
    }

    private function userNoteOrFail(Request $request, int $id): Note
    {
        return Note::query()
            ->where('user_id', $request->user()->id)
            ->where(function ($query) {
                $query->whereNull('status')
                    ->orWhere('status', '!=', 'inactive');
            })
            ->whereKey($id)
            ->firstOrFail();
    }
}
