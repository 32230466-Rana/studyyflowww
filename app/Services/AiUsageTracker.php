<?php

namespace App\Services;

use App\Models\AiUsage;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

class AiUsageTracker
{
    public function track(string $feature, ?int $noteId = null, array $metadata = []): void
    {
        $userId = Auth::id();

        if (!$userId) {
            return;
        }

        $weeklyLimit = max(50, (int) config('admin_features.weekly_ai_usage_limit', 50));
        $weeklyUsage = AiUsage::query()
            ->where('user_id', $userId)
            ->whereBetween('created_at', [now()->startOfWeek(), now()->endOfWeek()])
            ->count();

        if ($weeklyUsage >= $weeklyLimit) {
            throw new HttpResponseException(response()->json([
                'success' => false,
                'message' => 'You reached your weekly AI usage limit of 50. Please try again next week.',
                'weekly_limit' => $weeklyLimit,
                'weekly_usage' => $weeklyUsage,
            ], 429));
        }

        try {
            AiUsage::create([
                'user_id' => $userId,
                'feature' => $feature,
                'note_id' => $noteId,
                'metadata' => $metadata ?: null,
            ]);
        } catch (\Throwable $e) {
            Log::warning('AI usage tracking failed', [
                'feature' => $feature,
                'note_id' => $noteId,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
