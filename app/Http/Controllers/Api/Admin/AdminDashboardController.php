<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Note;
use App\Models\User;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminDashboardController extends Controller
{
    public function dashboard(Request $request)
    {
        $days = (int) $request->query('days', 14);
        $days = max(7, min(90, $days));

        $start = now()->subDays($days - 1)->startOfDay();
        $end = now()->endOfDay();

        $stats = [
            'total_users' => User::count(),
            'total_notes' => Note::count(),
            'total_admins' => User::where('is_admin', true)->count(),
            'featured_notes' => Note::where('is_featured', true)->count(),
            'ai_summaries' => Note::whereNotNull('ai_summary')->count(),
            'active_users' => User::where('status', 'active')->count(),
        ];

        $labels = [];
        for ($i = 0; $i < $days; $i++) {
            $labels[] = $start->copy()->addDays($i)->toDateString();
        }

        $usersByDay = User::query()
            ->whereBetween('created_at', [$start, $end])
            ->selectRaw('DATE(created_at) as day, COUNT(*) as count')
            ->groupBy(DB::raw('DATE(created_at)'))
            ->pluck('count', 'day')
            ->toArray();

        $notesByDay = Note::query()
            ->whereBetween('created_at', [$start, $end])
            ->selectRaw('DATE(created_at) as day, COUNT(*) as count')
            ->groupBy(DB::raw('DATE(created_at)'))
            ->pluck('count', 'day')
            ->toArray();

        $aiByDay = Note::query()
            ->whereNotNull('ai_summary_generated_at')
            ->whereBetween('ai_summary_generated_at', [$start, $end])
            ->selectRaw('DATE(ai_summary_generated_at) as day, COUNT(*) as count')
            ->groupBy(DB::raw('DATE(ai_summary_generated_at)'))
            ->pluck('count', 'day')
            ->toArray();

        $series = function (array $map) use ($labels): array {
            return array_map(fn ($d) => (int) ($map[$d] ?? 0), $labels);
        };

        $recentUsers = User::query()
            ->latest('created_at')
            ->limit(8)
            ->get(['id', 'name', 'email', 'is_admin', 'status', 'created_at'])
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'is_admin' => (bool) $u->is_admin,
                'status' => $u->status,
                'created_at' => $u->created_at,
            ])
            ->values();

        $recentNotes = Note::query()
            ->with(['user:id,name,email'])
            ->latest('created_at')
            ->limit(8)
            ->get(['id', 'user_id', 'title', 'source_type', 'is_featured', 'created_at'])
            ->map(fn (Note $n) => [
                'id' => $n->id,
                'title' => $n->title,
                'source_type' => $n->source_type,
                'is_featured' => (bool) $n->is_featured,
                'created_at' => $n->created_at,
                'user' => $n->user ? [
                    'id' => $n->user->id,
                    'name' => $n->user->name,
                    'email' => $n->user->email,
                ] : null,
            ])
            ->values();

        return ApiResponse::success([
            'stats' => $stats,
            'charts' => [
                'range' => [
                    'days' => $days,
                    'start' => $start->toDateString(),
                    'end' => $end->toDateString(),
                ],
                'users_growth' => [
                    'labels' => $labels,
                    'values' => $series($usersByDay),
                ],
                'notes_uploads' => [
                    'labels' => $labels,
                    'values' => $series($notesByDay),
                ],
                'ai_usage' => [
                    'labels' => $labels,
                    'values' => $series($aiByDay),
                ],
            ],
            'recent_users' => $recentUsers,
            'recent_notes' => $recentNotes,
        ], 'Admin dashboard loaded');
    }
}
