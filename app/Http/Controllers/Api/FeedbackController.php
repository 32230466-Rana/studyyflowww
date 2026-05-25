<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Feedback;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class FeedbackController extends Controller
{
    public function store(Request $request)
    {
        $validated = $request->validate([
            'message' => 'required|string|min:3|max:2000',
            'rating' => 'nullable|integer|min:1|max:5',
            'type' => 'nullable|in:suggestion,problem,quiz issue,report',
        ]);

        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated. Please login first.',
            ], 401);
        }

        $payload = [
            'user_id' => $user->id,
            'name' => $user->name,
            'message' => $validated['message'],
            'rating' => $validated['rating'] ?? null,
            'is_visible' => true,
        ];

        if (Schema::hasColumn('feedback', 'type')) {
            $payload['type'] = $validated['type'] ?? 'suggestion';
        }

        if (Schema::hasColumn('feedback', 'status')) {
            $payload['status'] = 'open';
        }

        $feedback = Feedback::create($payload);

        return ApiResponse::success([
            'id' => $feedback->id,
            'name' => $feedback->name,
            'type' => $feedback->type ?? 'suggestion',
            'message' => $feedback->message,
            'status' => $feedback->status ?? 'open',
            'rating' => $feedback->rating,
            'created_at' => $feedback->created_at,
        ], 'Feedback submitted', 201);
    }
    public function recent(Request $request)
    {
        $limit = (int) $request->query('limit', 6);
        $limit = max(1, min(20, $limit));

        $items = Feedback::query()
            ->where('is_visible', true)
            ->latest('created_at')
            ->limit($limit)
            ->get(['id', 'name', 'message', 'rating', 'created_at'])
            ->values();

        return ApiResponse::success($items, 'Recent feedback loaded');
    }
}
