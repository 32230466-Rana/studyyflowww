<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\AiUsage;
use App\Models\User;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class AdminAiUsageController extends Controller
{
    public function index(Request $request)
    {
        $start = now()->startOfWeek();
        $end = now()->endOfWeek();
        $limit = (int) config('admin_features.weekly_ai_usage_limit', 50);

        $query = User::query()->select([
            'id',
            'name',
            'email',
            'is_admin',
            'status',
            'last_login_at',
            'last_seen_at',
            'created_at',
        ]);

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($inner) use ($search) {
                $inner->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        $users = $query->orderBy('name')->get();

        $usageCounts = Schema::hasTable('ai_usages')
            ? AiUsage::query()
                ->whereBetween('created_at', [$start, $end])
                ->selectRaw('user_id, COUNT(*) as count')
                ->groupBy('user_id')
                ->pluck('count', 'user_id')
            : collect();

        $rows = $users->map(function (User $user) use ($usageCounts, $limit) {
            $used = (int) ($usageCounts[$user->id] ?? 0);

            return [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->is_admin ? 'admin' : 'user',
                'status' => $user->status ?? 'active',
                'weekly_usage' => $used,
                'weekly_ai_usage' => $used,
                'weekly_limit' => $limit,
                'remaining' => max(0, $limit - $used),
                'last_login_at' => $user->last_login_at,
                'last_seen_at' => $user->last_seen_at,
            ];
        })->values();

        return ApiResponse::success([
            'weekly_limit' => $limit,
            'period' => [
                'start' => $start->toDateString(),
                'end' => $end->toDateString(),
            ],
            'users' => $rows,
        ], 'AI usage loaded');
    }
}
