<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\Note;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use App\Services\ActivityLogger;

class NoteController extends Controller
{
    // GET /api/notes
    public function index(Request $request)
    {
        $notes = Note::where('user_id', $request->user()->id)
            ->latest()
            ->get();

        return response()->json([
            'data' => $notes
        ]);
    }

    // POST /api/notes  (Upload PDF)
    public function store(Request $request)
    {
        $request->validate([
            'title' => 'required|string|max:255',
            'description' => 'nullable|string',
            'file' => 'nullable|file|mimes:pdf,txt,ppt,pptx',
            'text_content' => 'nullable|string'
        ]);

        $originalFilename = null;
        $storedPath = null;
        $mimeType = null;
        $fileSize = null;

        if ($request->hasFile('file')) {
            $file = $request->file('file');

            $originalFilename = $file->getClientOriginalName();
            $storedPath = $file->store('notes', 'public');
            $mimeType = $file->getMimeType();
            $fileSize = $file->getSize();
        }

        $note = \App\Models\Note::create([
            'user_id' => $request->user()->id,
            'title' => $request->title,
            'description' => $request->description,
            'original_filename' => $originalFilename,
            'stored_path' => $storedPath,
            'mime_type' => $mimeType,
            'file_size' => $fileSize,
            'text_content' => $request->text_content,
            'source_type' => $request->hasFile('file') ? 'file' : 'text',
            'status' => 'uploaded'
        ]);

        ActivityLogger::log(
            $request->user()->id,
            'note_uploaded',
            'Note uploaded',
            $note->title ?? 'Untitled note',
            \App\Models\Note::class,
            $note->id
        );
        return response()->json([
            'message' => 'Note created successfully',
            'note' => $note
        ]);
    }
    // GET /api/notes/{id}
    public function show(Request $request, $id)
    {
        if (!ctype_digit((string) $id)) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid note id.',
            ], 422);
        }

        $id = (int) $id;

        $note = Note::where('user_id', $request->user()->id)
            ->findOrFail($id);

        return response()->json([
            'success' => true,
            'data' => $note,
        ]);
    }
    // PUT/PATCH /api/notes/{id}
    public function update(Request $request, $id)
    {
        $note = Note::where('id', $id)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            // optional replace pdf
            'pdf' => ['sometimes', 'file', 'mimes:pdf', 'max:51200'],
        ]);

        if (array_key_exists('title', $data)) {
            $note->title = $data['title'];
        }
        if (array_key_exists('description', $data)) {
            $note->description = $data['description'];
        }

        if ($request->hasFile('pdf')) {
            // delete old
            if ($note->pdf_path && Storage::disk('public')->exists($note->pdf_path)) {
                Storage::disk('public')->delete($note->pdf_path);
            }

            $file = $request->file('pdf');
            $path = $file->store('notes_pdfs', 'public');

            $note->pdf_path = $path;
            $note->mime_type = $file->getClientMimeType();
            $note->file_size = $file->getSize();
            $note->status = 'uploaded';
        }

        $note->save();

        return response()->json([
            'message' => 'Note updated.',
            'data' => $note,
        ]);
    }

    // DELETE /api/notes/{id}
    public function destroy(Request $request, $id)
    {
        $note = Note::where('id', $id)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        if ($note->pdf_path && Storage::disk('public')->exists($note->pdf_path)) {
            Storage::disk('public')->delete($note->pdf_path);
        }

        $note->delete();

        return response()->json([
            'message' => 'Note deleted.'
        ]);
    }
}
