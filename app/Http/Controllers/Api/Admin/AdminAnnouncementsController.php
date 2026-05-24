<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class AdminAnnouncementsController extends Controller
{
    public function index(Request $request)
    {
        $query = Announcement::query()->with(['user:id,name,email']);

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                    ->orWhere('message', 'like', "%{$search}%");
            });
        }

        if ($request->has('is_active')) {
            $query->where('is_active', $request->boolean('is_active'));
        }

        $perPage = (int) $request->input('per_page', 10);
        $perPage = max(5, min(100, $perPage));

        $announcements = $query->latest('created_at')->paginate($perPage);

        return ApiResponse::success([
            'announcements' => collect($announcements->items())
                ->map(fn (Announcement $announcement) => $this->mapAnnouncement($announcement))
                ->values(),
            'pagination' => [
                'current_page' => $announcements->currentPage(),
                'per_page' => $announcements->perPage(),
                'total' => $announcements->total(),
                'last_page' => $announcements->lastPage(),
            ],
        ], 'Announcements retrieved');
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'message' => ['required', 'string', 'max:5000'],
            'is_active' => ['sometimes', 'boolean'],
            'starts_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date', 'after_or_equal:starts_at'],
        ]);

        $announcement = Announcement::create([
            ...$validated,
            'user_id' => $request->user()?->id,
            'is_active' => (bool) ($validated['is_active'] ?? true),
        ]);

        return ApiResponse::success(
            $this->mapAnnouncement($announcement->load('user:id,name,email')),
            'Announcement created',
            201
        );
    }

    public function update(Request $request, Announcement $announcement)
    {
        $validated = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'message' => ['sometimes', 'string', 'max:5000'],
            'is_active' => ['sometimes', 'boolean'],
            'starts_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date', 'after_or_equal:starts_at'],
        ]);

        $announcement->fill($validated);
        $announcement->save();

        return ApiResponse::success(
            $this->mapAnnouncement($announcement->load('user:id,name,email')),
            'Announcement updated'
        );
    }

    public function destroy(Request $request, Announcement $announcement)
    {
        $announcement->delete();

        return ApiResponse::success(null, 'Announcement deleted');
    }

    public function toggleStatus(Request $request, Announcement $announcement)
    {
        $announcement->update(['is_active' => ! (bool) $announcement->is_active]);

        return ApiResponse::success(
            $this->mapAnnouncement($announcement->load('user:id,name,email')),
            'Announcement status toggled'
        );
    }

    private function mapAnnouncement(Announcement $announcement): array
    {
        return [
            'id' => $announcement->id,
            'title' => $announcement->title,
            'message' => $announcement->message,
            'is_active' => (bool) $announcement->is_active,
            'starts_at' => $announcement->starts_at,
            'expires_at' => $announcement->expires_at,
            'created_at' => $announcement->created_at,
            'updated_at' => $announcement->updated_at,
            'author' => $announcement->user ? [
                'id' => $announcement->user->id,
                'name' => $announcement->user->name,
                'email' => $announcement->user->email,
            ] : null,
        ];
    }
}
