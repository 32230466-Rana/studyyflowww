<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Note;
use App\Models\Summary;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class SummaryController extends Controller
{
    public function index(Request $request)
    {
        $validated = $request->validate([
            'search' => ['nullable', 'string', 'max:200'],
            'sort' => ['nullable', 'string', 'in:newest,oldest,title'],
        ]);

        $search = trim((string) ($validated['search'] ?? ''));
        $sort = (string) ($validated['sort'] ?? 'newest');

        $query = Summary::query()
            ->where('user_id', $request->user()->id);

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', '%' . $search . '%')
                    ->orWhere('summary_text', 'like', '%' . $search . '%');
            });
        }

        if ($sort === 'oldest') {
            $query->orderBy('created_at', 'asc')->orderBy('id', 'asc');
        } elseif ($sort === 'title') {
            $query->orderBy('title', 'asc')->orderBy('created_at', 'desc');
        } else {
            $query->orderBy('created_at', 'desc')->orderBy('id', 'desc');
        }

        $summaries = $query->get([
            'id',
            'note_id',
            'title',
            'source_type',
            'summary_text',
            'created_at',
            'updated_at',
        ])->map(function (Summary $summary) {
            return [
                'id' => $summary->id,
                'note_id' => $summary->note_id,
                'title' => $summary->title,
                'source_type' => $summary->source_type,
                'summary_text' => $summary->summary_text,
                'created_at' => optional($summary->created_at)->toISOString(),
                'updated_at' => optional($summary->updated_at)->toISOString(),
            ];
        });

        return ApiResponse::success($summaries, 'OK');
    }

    public function show(Request $request, int $id)
    {
        $summary = Summary::query()
            ->where('user_id', $request->user()->id)
            ->whereKey($id)
            ->first();

        if (!$summary) {
            return ApiResponse::error('Summary not found.', 404);
        }

        return ApiResponse::success([
            'id' => $summary->id,
            'note_id' => $summary->note_id,
            'title' => $summary->title,
            'source_type' => $summary->source_type,
            'summary_text' => $summary->summary_text,
            'created_at' => optional($summary->created_at)->toISOString(),
            'updated_at' => optional($summary->updated_at)->toISOString(),
        ], 'OK');
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'note_id' => ['nullable', 'integer', 'min:1'],
            'title' => ['required', 'string', 'max:255'],
            'source_type' => ['required', 'string', 'in:pdf,text'],
            'summary_text' => ['required', 'string', 'min:1'],
        ]);

        $noteId = array_key_exists('note_id', $validated)
            ? (int) $validated['note_id']
            : null;

        if ($noteId) {
            $note = Note::query()
                ->where('user_id', $request->user()->id)
                ->whereKey($noteId)
                ->first();

            if (!$note) {
                return ApiResponse::error('Invalid note_id.', 422);
            }
        }

        $summary = Summary::create([
            'user_id' => $request->user()->id,
            'note_id' => $noteId ?: null,
            'title' => trim((string) $validated['title']),
            'source_type' => (string) $validated['source_type'],
            'summary_text' => (string) $validated['summary_text'],
        ]);

        return ApiResponse::success([
            'id' => $summary->id,
            'note_id' => $summary->note_id,
            'title' => $summary->title,
            'source_type' => $summary->source_type,
            'summary_text' => $summary->summary_text,
            'created_at' => optional($summary->created_at)->toISOString(),
            'updated_at' => optional($summary->updated_at)->toISOString(),
        ], 'Summary saved.', 201);
    }

    public function destroy(Request $request, int $id)
    {
        $summary = Summary::query()
            ->where('user_id', $request->user()->id)
            ->whereKey($id)
            ->first();

        if (!$summary) {
            return ApiResponse::error('Summary not found.', 404);
        }

        $summary->delete();

        return ApiResponse::success(null, 'Summary deleted.');
    }
}
