<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Feedback;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class AdminFeedbackController extends Controller
{
    public function index(Request $request)
    {
        $query = Feedback::query()->with(['user:id,name,email,status,last_seen_at']);

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('message', 'like', "%{$search}%")
                    ->orWhereHas('user', function ($userQuery) use ($search) {
                        $userQuery->where('name', 'like', "%{$search}%")
                            ->orWhere('email', 'like', "%{$search}%");
                    });
            });
        }

        if ($request->filled('rating')) {
            $query->where('rating', (int) $request->input('rating'));
        }

        if ($request->has('is_visible')) {
            $query->where('is_visible', $request->boolean('is_visible'));
        }

        $perPage = (int) $request->input('per_page', 10);
        $perPage = max(5, min(100, $perPage));

        $feedback = $query->latest('created_at')->paginate($perPage);

        return ApiResponse::success([
            'feedback' => collect($feedback->items())
                ->map(fn (Feedback $item) => $this->mapFeedback($item))
                ->values(),
            'pagination' => [
                'current_page' => $feedback->currentPage(),
                'per_page' => $feedback->perPage(),
                'total' => $feedback->total(),
                'last_page' => $feedback->lastPage(),
            ],
        ], 'Feedback retrieved');
    }

    public function toggleVisibility(Request $request, Feedback $feedback)
    {
        $feedback->update(['is_visible' => ! (bool) $feedback->is_visible]);

        return ApiResponse::success(
            $this->mapFeedback($feedback->load('user:id,name,email,status,last_seen_at')),
            'Feedback visibility toggled'
        );
    }

    public function destroy(Request $request, Feedback $feedback)
    {
        $feedback->delete();

        return ApiResponse::success(null, 'Feedback deleted');
    }

    private function mapFeedback(Feedback $feedback): array
    {
        $user = $feedback->user;
        $isOnline = $user?->last_seen_at
            && ($user->status ?? 'active') === 'active'
            && $user->last_seen_at->greaterThanOrEqualTo(now()->subMinutes(5));

        return [
            'id' => $feedback->id,
            'name' => $feedback->name,
            'message' => $feedback->message,
            'rating' => $feedback->rating,
            'is_visible' => (bool) $feedback->is_visible,
            'created_at' => $feedback->created_at,
            'user' => $user ? [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'status' => $user->status,
                'last_seen_at' => $user->last_seen_at,
                'is_online' => (bool) $isOnline,
            ] : null,
            'user_name' => $user?->name ?? $feedback->name,
            'email' => $user?->email,
        ];
    }
}
