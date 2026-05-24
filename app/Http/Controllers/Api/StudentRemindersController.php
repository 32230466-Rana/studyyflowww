<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Reminder;
use App\Models\ReminderDismissal;
use App\Support\ApiResponse;
use Carbon\Carbon;
use Illuminate\Http\Request;

class StudentRemindersController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        if (! $user) {
            return ApiResponse::error('Unauthenticated.', 401);
        }

        $previousLastSeen = $request->attributes->get('previous_last_seen_at');
        $previousLastSeen = $previousLastSeen instanceof Carbon ? $previousLastSeen : $user->last_seen_at;

        $activeRecentlyDays = 2;
        $needsReminderDays = 7;

        $inactiveKey = 'needs_reminder';
        $inactiveLabel = 'Needs reminder';
        $showWeMissYou = true;

        if ($previousLastSeen) {
            $activeCutoff = now()->subDays($activeRecentlyDays);
            $awayCutoff = now()->subDays($needsReminderDays);

            if ($previousLastSeen->greaterThanOrEqualTo($activeCutoff)) {
                $inactiveKey = 'active_recently';
                $inactiveLabel = 'Active recently';
                $showWeMissYou = false;
            } elseif ($previousLastSeen->greaterThanOrEqualTo($awayCutoff)) {
                $inactiveKey = 'away_for_a_while';
                $inactiveLabel = 'Away for a while';
                $showWeMissYou = true;
            }
        }

        $daysInactive = $previousLastSeen ? $previousLastSeen->diffInDays(now()) : null;

        $query = Reminder::query()
            ->where('is_active', true)
            ->where(function ($q) use ($user) {
                $q->where('audience', 'all');

                if (! (bool) $user->is_admin) {
                    $q->orWhere('audience', 'students');
                }

                $q->orWhere(function ($q2) use ($user) {
                    $q2->where('audience', 'specific_user')
                        ->where('target_user_id', $user->id);
                });
            })
            ->whereDoesntHave('dismissals', function ($q) use ($user) {
                $q->where('user_id', $user->id);
            })
            ->with(['creator:id,name,email'])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->take(25);

        $reminders = $query->get()->map(function (Reminder $reminder) {
            return [
                'id' => $reminder->id,
                'title' => $reminder->title,
                'message' => $reminder->message,
                'audience' => $reminder->audience,
                'type' => $reminder->type,
                'created_at' => optional($reminder->created_at)->toISOString(),
                'creator' => $reminder->relationLoaded('creator') && $reminder->creator ? [
                    'id' => $reminder->creator->id,
                    'name' => $reminder->creator->name,
                    'email' => $reminder->creator->email,
                ] : null,
            ];
        })->values();

        return ApiResponse::success([
            'inactivity' => [
                'key' => $inactiveKey,
                'label' => $inactiveLabel,
                'days' => $daysInactive,
                'show_we_miss_you' => $showWeMissYou && in_array($inactiveKey, ['away_for_a_while', 'needs_reminder'], true),
                'previous_last_seen_at' => optional($previousLastSeen)->toISOString(),
            ],
            'reminders' => $reminders,
        ], 'Student reminders loaded');
    }

    public function dismiss(Request $request, Reminder $reminder)
    {
        $user = $request->user();

        if (! $user) {
            return ApiResponse::error('Unauthenticated.', 401);
        }

        $isRelevant = $reminder->audience === 'all'
            || ($reminder->audience === 'students' && ! (bool) $user->is_admin)
            || ($reminder->audience === 'specific_user' && (int) $reminder->target_user_id === (int) $user->id);

        if (! $isRelevant) {
            return ApiResponse::error('Reminder not found.', 404);
        }

        ReminderDismissal::updateOrCreate(
            [
                'reminder_id' => $reminder->id,
                'user_id' => $user->id,
            ],
            [
                'dismissed_at' => now(),
            ]
        );

        return ApiResponse::success(null, 'Reminder dismissed');
    }
}
