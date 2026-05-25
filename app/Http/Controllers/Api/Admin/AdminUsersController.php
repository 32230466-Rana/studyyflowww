<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\AiUsage;
use App\Models\User;
use App\Services\ActivityLogger;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class AdminUsersController extends Controller
{
    public function index(Request $request)
    {
        $query = User::query();

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        if ($request->has('is_admin')) {
            $query->where('is_admin', $request->boolean('is_admin'));
        }

        if ($request->filled('status')) {
            $query->where('status', (string) $request->input('status'));
        }

        if ($request->filled('activity') && Schema::hasColumn('users', 'last_seen_at')) {
            $activity = (string) $request->input('activity');
            $onlineCutoff = now()->subMinutes(5);

            if ($activity === 'online') {
                $query->where('status', 'active')
                    ->where('last_seen_at', '>=', $onlineCutoff);
            } elseif ($activity === 'offline') {
                $query->where(function ($q) use ($onlineCutoff) {
                    $q->whereNull('last_seen_at')
                        ->orWhere('last_seen_at', '<', $onlineCutoff)
                        ->orWhere('status', '!=', 'active');
                });
            } elseif ($activity === 'never') {
                $query->whereNull('last_login_at');
            }
        }

        $perPage = (int) $request->input('per_page', 10);
        $perPage = max(5, min(100, $perPage));

        $direction = strtolower((string) $request->input('direction', 'desc')) === 'asc' ? 'asc' : 'desc';
        $sort = (string) $request->input('sort', 'created_at');

        if (in_array($sort, ['last_login_at', 'last_seen_at', 'name', 'email', 'created_at'], true)) {
            $query->orderBy($sort, $direction);
        } else {
            $query->orderByDesc('created_at');
        }

        $users = $query->paginate($perPage);

        $weekStart = now()->startOfWeek();
        $weekEnd = now()->endOfWeek();
        $weeklyLimit = (int) config('admin_features.weekly_ai_usage_limit', 50);
        $usageCounts = Schema::hasTable('ai_usages')
            ? AiUsage::query()
                ->whereBetween('created_at', [$weekStart, $weekEnd])
                ->whereIn('user_id', collect($users->items())->pluck('id')->all())
                ->selectRaw('user_id, COUNT(*) as count')
                ->groupBy('user_id')
                ->pluck('count', 'user_id')
            : collect();

        $mappedUsers = collect($users->items())->map(function (User $user) use ($request, $usageCounts, $weeklyLimit) {
            $weeklyUsage = (int) ($usageCounts[$user->id] ?? 0);
            $resource = (new UserResource($user))->resolve($request);

            return array_merge($resource, [
                'role' => $user->is_admin ? 'admin' : 'user',
                'is_active' => (bool) ($user->is_active ?? (($user->status ?? 'active') === 'active')),
                'weekly_ai_usage' => $weeklyUsage,
                'weekly_usage' => $weeklyUsage,
                'weekly_limit' => $weeklyLimit,
                'weekly_remaining' => max(0, $weeklyLimit - $weeklyUsage),
            ]);
        })->values();

        return ApiResponse::success([
            'users' => $mappedUsers,
            'pagination' => [
                'current_page' => $users->currentPage(),
                'per_page' => $users->perPage(),
                'total' => $users->total(),
                'last_page' => $users->lastPage(),
            ],
        ], 'Users retrieved');
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            'is_admin' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
        ]);

        $status = $validated['status'] ?? ((bool) ($validated['is_active'] ?? true) ? 'active' : 'inactive');

        $userData = [
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($validated['password']),
            'is_admin' => (bool) ($validated['is_admin'] ?? false),
            'status' => $status,
            'email_verified_at' => now(),
        ];

        if (Schema::hasColumn('users', 'is_active')) {
            $userData['is_active'] = $status === 'active';
        }

        $user = User::create($userData);

        return ApiResponse::success(new UserResource($user), 'User created', 201);
    }

    public function update(Request $request, User $user)
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'password' => ['nullable', 'string', 'min:8', 'confirmed'],
            'is_admin' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
        ]);

        if (array_key_exists('is_active', $validated) && ! array_key_exists('status', $validated)) {
            $validated['status'] = $validated['is_active'] ? 'active' : 'inactive';
        }

        if (array_key_exists('is_admin', $validated)) {
            $wantAdmin = (bool) $validated['is_admin'];

            if (! $wantAdmin && (bool) $user->is_admin && User::where('is_admin', true)->count() === 1) {
                return ApiResponse::error('Cannot remove admin status from the only admin', 403);
            }

            if ($user->id === $request->user()?->id && ! $wantAdmin) {
                return ApiResponse::error('You cannot remove your own admin access', 403);
            }
        }

        if (array_key_exists('status', $validated) && $validated['status'] !== 'active') {
            if ($request->user()?->id === $user->id) {
                return ApiResponse::error('You cannot deactivate your own account', 403);
            }

            if ((bool) $user->is_admin) {
                $activeAdminCount = User::where('is_admin', true)->where('status', 'active')->count();

                if ($activeAdminCount <= 1) {
                    return ApiResponse::error('Cannot deactivate the only active admin', 403);
                }
            }
        }

        if (array_key_exists('status', $validated)) {
            $validated['is_active'] = $validated['status'] === 'active';
        }

        if (! Schema::hasColumn('users', 'is_active')) {
            unset($validated['is_active']);
        }

        $user->fill(collect($validated)->except(['password'])->toArray());

        if (! empty($validated['password'])) {
            $user->password = Hash::make($validated['password']);
        }

        $user->save();

        if (($user->status ?? 'active') !== 'active') {
            $user->tokens()->delete();
            $user->forceFill([
                'last_seen_at' => now()->subMinutes(10),
            ])->save();
        }

        return ApiResponse::success(new UserResource($user), 'User updated');
    }

    public function destroy(Request $request, User $user)
    {
        if ($request->user()?->id === $user->id) {
            return ApiResponse::error('Cannot delete your own account', 403);
        }

        if ((bool) $user->is_admin && User::where('is_admin', true)->count() === 1) {
            return ApiResponse::error('Cannot delete the only admin', 403);
        }

        $user->delete();

        return ApiResponse::success(null, 'User deleted');
    }

    public function toggleAdmin(Request $request, User $user)
    {
        $next = ! (bool) $user->is_admin;

        if (! $next && (bool) $user->is_admin && User::where('is_admin', true)->count() === 1) {
            return ApiResponse::error('Cannot remove admin status from the only admin', 403);
        }

        if ($request->user()?->id === $user->id && ! $next) {
            return ApiResponse::error('You cannot remove your own admin access', 403);
        }

        $user->update(['is_admin' => $next]);

        return ApiResponse::success(new UserResource($user), 'User admin role toggled');
    }

    public function toggleStatus(Request $request, User $user)
    {
        $current = (string) ($user->status ?? 'active');
        $next = $current === 'active' ? 'inactive' : 'active';

        if ($next !== 'active' && (bool) $user->is_admin) {
            $activeAdminCount = User::where('is_admin', true)->where('status', 'active')->count();
            if ($activeAdminCount <= 1) {
                return ApiResponse::error('Cannot deactivate the only active admin', 403);
            }
        }

        if ($request->user()?->id === $user->id && $next !== 'active') {
            return ApiResponse::error('You cannot deactivate your own account', 403);
        }

        $updates = [
            'status' => $next,
        ];

        if (Schema::hasColumn('users', 'is_active')) {
            $updates['is_active'] = $next === 'active';
        }

        $user->update($updates);

        if ($next !== 'active') {
            $user->tokens()->delete();
            $user->forceFill([
                'last_seen_at' => now()->subMinutes(10),
            ])->save();
        }

        return ApiResponse::success(new UserResource($user), 'User status toggled');
    }

    public function updateRole(Request $request, User $user)
    {
        $validated = $request->validate([
            'role' => ['nullable', Rule::in(['user', 'admin'])],
            'is_admin' => ['nullable', 'boolean'],
        ]);

        $wantAdmin = array_key_exists('is_admin', $validated)
            ? (bool) $validated['is_admin']
            : (($validated['role'] ?? ($user->is_admin ? 'admin' : 'user')) === 'admin');

        if (! $wantAdmin && (bool) $user->is_admin && User::where('is_admin', true)->count() === 1) {
            return ApiResponse::error('Cannot remove admin status from the only admin', 403);
        }

        if ($request->user()?->id === $user->id && ! $wantAdmin) {
            return ApiResponse::error('You cannot remove your own admin access', 403);
        }

        $user->update(['is_admin' => $wantAdmin]);

        ActivityLogger::log(
            $request->user()?->id,
            'admin_user_role_changed',
            'User role changed',
            $user->email . ' role changed to ' . ($wantAdmin ? 'admin' : 'user'),
            User::class,
            $user->id
        );

        return ApiResponse::success(new UserResource($user), 'User role updated');
    }

    public function updateStatus(Request $request, User $user)
    {
        $validated = $request->validate([
            'status' => ['nullable', Rule::in(['active', 'inactive'])],
            'is_active' => ['nullable', 'boolean'],
        ]);

        $status = $validated['status'] ?? ((bool) ($validated['is_active'] ?? true) ? 'active' : 'inactive');

        if ($status !== 'active' && $request->user()?->id === $user->id) {
            return ApiResponse::error('You cannot deactivate your own account', 403);
        }

        if ($status !== 'active' && (bool) $user->is_admin) {
            $activeAdminCount = User::where('is_admin', true)->where('status', 'active')->count();

            if ($activeAdminCount <= 1) {
                return ApiResponse::error('Cannot deactivate the only active admin', 403);
            }
        }

        $updates = [
            'status' => $status,
        ];

        if (Schema::hasColumn('users', 'is_active')) {
            $updates['is_active'] = $status === 'active';
        }

        $user->update($updates);

        if ($status !== 'active') {
            $user->tokens()->delete();
            $user->forceFill(['last_seen_at' => now()->subMinutes(10)])->save();
        }

        ActivityLogger::log(
            $request->user()?->id,
            'admin_user_status_changed',
            'User status changed',
            $user->email . ' status changed to ' . $status,
            User::class,
            $user->id
        );

        return ApiResponse::success(new UserResource($user), 'User status updated');
    }

    public function resetWeeklyUsage(Request $request, User $user)
    {
        $deleted = Schema::hasTable('ai_usages')
            ? AiUsage::query()
                ->where('user_id', $user->id)
                ->whereBetween('created_at', [now()->startOfWeek(), now()->endOfWeek()])
                ->delete()
            : 0;

        ActivityLogger::log(
            $request->user()?->id,
            'admin_ai_usage_reset',
            'Weekly AI usage reset',
            $user->email . ' weekly AI usage reset',
            User::class,
            $user->id
        );

        return ApiResponse::success([
            'deleted' => $deleted,
            'weekly_limit' => (int) config('admin_features.weekly_ai_usage_limit', 50),
        ], 'Weekly AI usage reset');
    }

    public function sendWeMissYou(Request $request, User $user)
    {
        if (! config('admin_features.emails', true)) {
            return ApiResponse::error('This feature is temporarily disabled.', 503);
        }

        try {
            Mail::raw(
                "Hi {$user->name},\n\nWe miss you in StudyFlow. Come back to review your notes, summaries, quizzes, and study plan so your progress keeps moving.\n\nStudyFlow Team",
                function ($mail) use ($user) {
                    $mail->to($user->email)->subject('We miss you in StudyFlow');
                }
            );

            ActivityLogger::log(
                $request->user()?->id,
                'we_miss_you_sent',
                'We Miss You email sent',
                'Admin sent a we miss you email to ' . $user->email,
                User::class,
                $user->id
            );

            return ApiResponse::success(null, 'We Miss You email sent');
        } catch (\Throwable $e) {
            Log::warning('We Miss You email failed', [
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return ApiResponse::error('Email could not be sent right now.', 500);
        }
    }
}
