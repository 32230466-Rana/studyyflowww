<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class AnnouncementController extends Controller
{
    public function index(Request $request)
    {
        $limit = (int) $request->query('limit', 10);
        $limit = max(1, min(50, $limit));

        $now = now();

        $announcements = Announcement::query()
            ->where('is_active', true)
            ->where(function ($query) use ($now) {
                $query->whereNull('starts_at')
                    ->orWhere('starts_at', '<=', $now);
            })
            ->where(function ($query) use ($now) {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>=', $now);
            })
            ->latest('created_at')
            ->limit($limit)
            ->get()
            ->map(fn (Announcement $announcement) => [
                'id' => $announcement->id,
                'title' => $announcement->title,
                'message' => $announcement->message,
                'is_active' => (bool) $announcement->is_active,
                'starts_at' => $announcement->starts_at,
                'expires_at' => $announcement->expires_at,
                'created_at' => $announcement->created_at,
            ])
            ->values();

        return ApiResponse::success($announcements, 'Announcements loaded');
    }
}
