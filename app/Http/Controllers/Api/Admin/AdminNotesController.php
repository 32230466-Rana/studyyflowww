<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Note;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminNotesController extends Controller
{
    public function index(Request $request)
    {
        $query = Note::query()->with(['user:id,name,email', 'latestSummary']);

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%")
                    ->orWhere('source_type', 'like', "%{$search}%")
                    ->orWhere('ai_summary', 'like', "%{$search}%")
                    ->orWhereHas('user', function ($userQuery) use ($search) {
                        $userQuery->where('name', 'like', "%{$search}%")
                            ->orWhere('email', 'like', "%{$search}%");
                    })
                    ->orWhereHas('latestSummary', function ($summaryQuery) use ($search) {
                        $summaryQuery->where('title', 'like', "%{$search}%")
                            ->orWhere('summary_text', 'like', "%{$search}%");
                    });
            });
        }

        if ($request->has('is_featured')) {
            $query->where('is_featured', $request->boolean('is_featured'));
        }

        if ($request->filled('status')) {
            $query->where('status', (string) $request->input('status'));
        }

        if ($request->filled('source_type')) {
            $query->where('source_type', (string) $request->input('source_type'));
        }

        if ($request->has('has_summary')) {
            if ($request->boolean('has_summary')) {
                $query->where(function ($q) {
                    $q->whereNotNull('ai_summary')
                        ->where('ai_summary', '!=', '')
                        ->orWhereHas('latestSummary');
                });
            } else {
                $query->where(function ($q) {
                    $q->where(function ($inner) {
                        $inner->whereNull('ai_summary')
                            ->orWhere('ai_summary', '');
                    })->whereDoesntHave('latestSummary');
                });
            }
        }

        $perPage = (int) $request->input('per_page', 10);
        $perPage = max(5, min(100, $perPage));

        $direction = strtolower((string) $request->input('direction', 'desc')) === 'asc' ? 'asc' : 'desc';
        $sort = (string) $request->input('sort', 'created_at');

        if (in_array($sort, ['title', 'status', 'source_type', 'created_at', 'updated_at'], true)) {
            $query->orderBy($sort, $direction);
        } else {
            $query->orderByDesc('created_at');
        }

        $notes = $query->paginate($perPage);

        $mapped = collect($notes->items())->map(fn (Note $n) => [
            'id' => $n->id,
            'title' => $n->title,
            'description' => $n->description,
            'status' => $n->status,
            'source_type' => $n->source_type,
            'is_featured' => (bool) $n->is_featured,
            'has_summary' => filled($n->ai_summary) || (bool) $n->latestSummary,
            'summary' => $this->summaryText($n),
            'summary_words_count' => str_word_count(strip_tags($this->summaryText($n))),
            'summary_created_at' => $n->ai_summary_generated_at ?? $n->latestSummary?->created_at,
            'created_at' => $n->created_at,
            'user' => $n->user ? [
                'id' => $n->user->id,
                'name' => $n->user->name,
                'email' => $n->user->email,
            ] : null,
        ])->values();

        return ApiResponse::success([
            'notes' => $mapped,
            'pagination' => [
                'current_page' => $notes->currentPage(),
                'per_page' => $notes->perPage(),
                'total' => $notes->total(),
                'last_page' => $notes->lastPage(),
            ],
        ], 'Notes retrieved');
    }

    public function update(Request $request, Note $note)
    {
        $validated = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'source_type' => ['nullable', 'string', 'max:50'],
            'status' => ['sometimes', Rule::in(['active', 'inactive', 'uploaded', 'processing', 'failed'])],
        ]);

        $note->fill($validated);
        $note->save();

        return ApiResponse::success([
            'id' => $note->id,
            'title' => $note->title,
            'description' => $note->description,
            'source_type' => $note->source_type,
            'status' => $note->status,
            'is_featured' => (bool) $note->is_featured,
            'created_at' => $note->created_at,
        ], 'Note updated');
    }

    public function destroy(Request $request, Note $note)
    {
        $note->delete();

        return ApiResponse::success(null, 'Note deleted');
    }

    public function toggleFeatured(Request $request, Note $note)
    {
        $note->update(['is_featured' => ! (bool) $note->is_featured]);

        return ApiResponse::success([
            'id' => $note->id,
            'is_featured' => (bool) $note->is_featured,
        ], 'Note featured toggled');
    }

    public function toggleStatus(Request $request, Note $note)
    {
        $next = ($note->status ?? 'active') === 'inactive' ? 'active' : 'inactive';

        $note->update(['status' => $next]);

        return ApiResponse::success([
            'id' => $note->id,
            'status' => $note->status,
        ], 'Note status toggled');
    }

    private function summaryText(Note $note): string
    {
        return (string) ($note->ai_summary ?: $note->latestSummary?->summary_text ?: '');
    }
}
