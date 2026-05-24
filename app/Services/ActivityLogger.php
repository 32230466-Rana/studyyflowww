<?php

namespace App\Services;

use App\Models\RecentActivity;

class ActivityLogger
{
    public static function log(
        ?int $userId,
        string $type,
        ?string $title = null,
        ?string $description = null,
        ?string $relatedType = null,
        ?int $relatedId = null
    ): void {
        RecentActivity::create([
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'description' => $description,
            'related_type' => $relatedType,
            'related_id' => $relatedId,
        ]);
    }
}
