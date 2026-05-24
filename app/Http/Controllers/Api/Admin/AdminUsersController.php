<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
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

        return ApiResponse::success([
            'users' => UserResource::collection($users->items()),
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
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
        ]);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($validated['password']),
            'is_admin' => (bool) ($validated['is_admin'] ?? false),
            'status' => $validated['status'] ?? 'active',
            'email_verified_at' => now(),
        ]);

        return ApiResponse::success(new UserResource($user), 'User created', 201);
    }

    public function update(Request $request, User $user)
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'password' => ['nullable', 'string', 'min:8', 'confirmed'],
            'is_admin' => ['sometimes', 'boolean'],
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
        ]);

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

        $user->update(['status' => $next]);

        if ($next !== 'active') {
            $user->tokens()->delete();
            $user->forceFill([
                'last_seen_at' => now()->subMinutes(10),
            ])->save();
        }

        return ApiResponse::success(new UserResource($user), 'User status toggled');
    }
}
