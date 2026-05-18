<?php

namespace App\Services;

use App\Models\AiUsage;
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
