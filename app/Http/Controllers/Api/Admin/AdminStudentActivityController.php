<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\ApiResponse;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AdminStudentActivityController extends Controller
{
    public function index(Request $request)
    {
        $activeRecentlyDays = 2;
        $needsReminderDays = 7;

        $students = User::query()
            ->where('is_admin', false)
            ->orderBy('name')
            ->get([
                'id',
                'name',
                'email',
                'status',
                'last_seen_at',
            ]);

        $studentIds = $students->pluck('id')->all();

        $lastNoteAt = $this->latestCreatedAtByUser('notes', $studentIds);
        $lastSummaryAt = $this->latestCreatedAtByUser('summaries', $studentIds);
        $lastAiAt = $this->latestCreatedAtByUser('ai_usages', $studentIds);
        $lastQuizAt = $this->latestCreatedAtByUser('quiz_attempts', $studentIds);

        $rows = $students->map(function (User $student) use (
            $activeRecentlyDays,
            $needsReminderDays,
            $lastNoteAt,
            $lastSummaryAt,
            $lastAiAt,
            $lastQuizAt
        ) {
            $noteAt = $this->asCarbon($lastNoteAt[$student->id] ?? null);
            $summaryAt = $this->asCarbon($lastSummaryAt[$student->id] ?? null);
            $aiAt = $this->asCarbon($lastAiAt[$student->id] ?? null);
            $quizAt = $this->asCarbon($lastQuizAt[$student->id] ?? null);

            $candidates = [
                ['type' => 'Upload', 'at' => $noteAt],
                ['type' => 'Summary', 'at' => $summaryAt],
                ['type' => 'AskPDF', 'at' => $aiAt],
                ['type' => 'Quiz', 'at' => $quizAt],
            ];

            $lastActivity = collect($candidates)
                ->filter(fn($item) => $item['at'] instanceof Carbon)
                ->sortByDesc(fn($item) => $item['at']->timestamp)
                ->first();

            $lastActivityAt = $lastActivity['at'] ?? null;
            $lastActivityType = $lastActivity['type'] ?? null;

            if (! $lastActivityAt && $student->last_seen_at) {
                $lastActivityAt = $student->last_seen_at;
                $lastActivityType = 'Site visit';
            }

            $seenAt = $student->last_seen_at ?: $lastActivityAt;

            $inactiveDays = $seenAt ? $seenAt->diffInDays(now()) : null;

            $statusLabel = 'Needs reminder';
            $statusKey = 'needs_reminder';

            if ($seenAt) {
                $activeCutoff = now()->subDays($activeRecentlyDays);
                $awayCutoff = now()->subDays($needsReminderDays);

                if ($seenAt->greaterThanOrEqualTo($activeCutoff)) {
                    $statusLabel = 'Active recently';
                    $statusKey = 'active_recently';
                } elseif ($seenAt->greaterThanOrEqualTo($awayCutoff)) {
                    $statusLabel = 'Away for a while';
                    $statusKey = 'away_for_a_while';
                }
            }

            return [
                'id' => $student->id,
                'name' => $student->name,
                'email' => $student->email,
                'status' => $student->status,
                'last_seen_at' => optional($student->last_seen_at)->toISOString(),
                'last_activity_type' => $lastActivityType,
                'last_activity_at' => optional($lastActivityAt)->toISOString(),
                'inactivity_status' => $statusLabel,
                'inactivity_key' => $statusKey,
                'inactive_days' => $inactiveDays,
            ];
        })->sortBy(function (array $row) {
            return match ($row['inactivity_key']) {
                'needs_reminder' => 0,
                'away_for_a_while' => 1,
                default => 2,
            };
        })->values();

        return ApiResponse::success([
            'thresholds' => [
                'active_recently_days' => $activeRecentlyDays,
                'needs_reminder_days' => $needsReminderDays,
            ],
            'students' => $rows,
        ], 'Student activity loaded');
    }

    private function latestCreatedAtByUser(string $table, array $userIds): array
    {
        if (empty($userIds)) {
            return [];
        }

        if (! Schema::hasTable($table)) {
            return [];
        }

        if (! Schema::hasColumn($table, 'user_id') || ! Schema::hasColumn($table, 'created_at')) {
            return [];
        }

        return DB::table($table)
            ->whereIn('user_id', $userIds)
            ->selectRaw('user_id, MAX(created_at) as last_at')
            ->groupBy('user_id')
            ->pluck('last_at', 'user_id')
            ->toArray();
    }

    private function asCarbon(mixed $value): ?Carbon
    {
        if (! $value) {
            return null;
        }

        try {
            return Carbon::parse($value);
        } catch (\Throwable) {
            return null;
        }
    }
}
