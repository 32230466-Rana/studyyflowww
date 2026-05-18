<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\AiUsage;
use App\Models\Note;
use App\Models\User;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AdminDashboardController extends Controller
{
    public function dashboard(Request $request)
    {
        $days = (int) $request->query('days', 14);
        $days = max(7, min(90, $days));

        $start = now()->subDays($days - 1)->startOfDay();
        $end = now()->endOfDay();

        $labels = [];
        for ($i = 0; $i < $days; $i++) {
            $labels[] = $start->copy()->addDays($i)->toDateString();
        }

        $series = function (array $map) use ($labels): array {
            return array_map(fn($day) => (int) ($map[$day] ?? 0), $labels);
        };

        $usersByDay = $this->countByDay('users', 'created_at', $start, $end);
        $notesByDay = $this->countByDay('notes', 'created_at', $start, $end);
        $aiByDay = $this->countByDay('ai_usages', 'created_at', $start, $end);
        $quizByDay = $this->countByDay('quiz_attempts', 'created_at', $start, $end);
        $summaryByDay = $this->countByDay('summaries', 'created_at', $start, $end);

        $quizCount = Schema::hasTable('quiz_attempts')
            ? DB::table('quiz_attempts')->count()
            : 0;

        $summaryCount = Schema::hasTable('summaries')
            ? DB::table('summaries')->count()
            : Note::whereNotNull('ai_summary')->count();

        $stats = [
            'total_users' => User::count(),
            'total_notes' => Note::count(),
            'total_admins' => User::where('is_admin', true)->count(),
            'featured_notes' => Note::where('is_featured', true)->count(),
            'ai_summaries' => $summaryCount,
            'active_users' => User::where('status', 'active')->count(),
            'ai_usage_count' => AiUsage::count(),
            'quizzes_created' => $quizCount,
            'quiz_count' => $quizCount,
            'files_uploaded' => $this->countUploadedFiles(),
            'today_users' => User::whereDate('created_at', today())->count(),
            'today_notes' => Note::whereDate('created_at', today())->count(),
            'today_ai_usage' => AiUsage::whereDate('created_at', today())->count(),
        ];

        $recentUsers = User::query()
            ->latest('created_at')
            ->limit(8)
            ->get(['id', 'name', 'email', 'is_admin', 'status', 'created_at'])
            ->map(fn(User $user) => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->is_admin ? 'admin' : 'user',
                'is_admin' => (bool) $user->is_admin,
                'status' => $user->status,
                'created_at' => $user->created_at,
            ])
            ->values();

        $recentNotes = Note::query()
            ->with(['user:id,name,email'])
            ->latest('created_at')
            ->limit(8)
            ->get(['id', 'user_id', 'title', 'source_type', 'is_featured', 'created_at'])
            ->map(fn(Note $note) => [
                'id' => $note->id,
                'title' => $note->title,
                'source_type' => $note->source_type,
                'source' => $note->source_type,
                'type' => $note->source_type,
                'is_featured' => (bool) $note->is_featured,
                'created_at' => $note->created_at,
                'user' => $note->user ? [
                    'id' => $note->user->id,
                    'name' => $note->user->name,
                    'email' => $note->user->email,
                ] : null,
                'user_name' => $note->user?->name,
            ])
            ->values();

        $recentQuizzes = $this->recentQuizzes();
        $recentSummaries = $this->recentSummaries();

        $recentActivity = collect()
            ->merge($recentNotes->take(3)->map(fn($note) => [
                'icon' => '📁',
                'title' => 'New note uploaded: ' . ($note['title'] ?? 'Untitled'),
                'created_at' => $note['created_at'] ?? null,
            ]))
            ->merge($recentQuizzes->take(3)->map(fn($quiz) => [
                'icon' => '📝',
                'title' => 'Quiz activity: ' . ($quiz['note_title'] ?? 'Quiz'),
                'created_at' => $quiz['created_at'] ?? null,
            ]))
            ->merge($recentSummaries->take(3)->map(fn($summary) => [
                'icon' => '🤖',
                'title' => 'Summary generated: ' . ($summary['note_title'] ?? 'Summary'),
                'created_at' => $summary['created_at'] ?? null,
            ]))
            ->sortByDesc('created_at')
            ->take(8)
            ->values();

        return ApiResponse::success([
            'stats' => $stats,
            'charts' => [
                'range' => [
                    'days' => $days,
                    'start' => $start->toDateString(),
                    'end' => $end->toDateString(),
                    'labels' => $labels,
                ],
                'user_growth' => $series($usersByDay),
                'users_growth' => $series($usersByDay),
                'notes_growth' => $series($notesByDay),
                'notes_uploads' => $series($notesByDay),
                'ai_usage' => $series($aiByDay),
                'quiz_growth' => $series($quizByDay),
                'summary_growth' => $series($summaryByDay),
            ],
            'recent_users' => $recentUsers,
            'recent_notes' => $recentNotes,
            'recent_quizzes' => $recentQuizzes,
            'recent_summaries' => $recentSummaries,
            'recent_activity' => $recentActivity,
        ], 'Admin dashboard loaded');
    }

    private function countByDay(string $table, string $column, $start, $end): array
    {
        if (!Schema::hasTable($table) || !Schema::hasColumn($table, $column)) {
            return [];
        }

        return DB::table($table)
            ->whereBetween($column, [$start, $end])
            ->selectRaw("DATE($column) as day, COUNT(*) as count")
            ->groupBy(DB::raw("DATE($column)"))
            ->pluck('count', 'day')
            ->toArray();
    }

    private function countUploadedFiles(): int
    {
        if (Schema::hasColumn('notes', 'stored_path')) {
            return Note::whereNotNull('stored_path')
                ->where('stored_path', '!=', '')
                ->count();
        }

        if (Schema::hasColumn('notes', 'file_path')) {
            return Note::whereNotNull('file_path')
                ->where('file_path', '!=', '')
                ->count();
        }

        if (Schema::hasColumn('notes', 'original_filename')) {
            return Note::whereNotNull('original_filename')
                ->where('original_filename', '!=', '')
                ->count();
        }

        return Note::count();
    }

    private function recentQuizzes()
    {
        if (!Schema::hasTable('quiz_attempts')) {
            return collect();
        }

        $table = 'quiz_attempts';

        $hasNoteId = Schema::hasColumn($table, 'note_id');
        $hasUserId = Schema::hasColumn($table, 'user_id');
        $hasDifficulty = Schema::hasColumn($table, 'difficulty');
        $hasScore = Schema::hasColumn($table, 'score');
        $hasPercentage = Schema::hasColumn($table, 'percentage');
        $hasCorrectAnswers = Schema::hasColumn($table, 'correct_answers');
        $hasTotalQuestions = Schema::hasColumn($table, 'total_questions');
        $hasCreatedAt = Schema::hasColumn($table, 'created_at');

        $query = DB::table($table);

        if ($hasNoteId && Schema::hasTable('notes')) {
            $query->leftJoin('notes', "$table.note_id", '=', 'notes.id');
        }

        if ($hasUserId && Schema::hasTable('users')) {
            $query->leftJoin('users', "$table.user_id", '=', 'users.id');
        }

        $select = ["$table.id as id"];

        if ($hasNoteId) {
            $select[] = "$table.note_id as note_id";
        }

        if ($hasUserId) {
            $select[] = "$table.user_id as user_id";
        }

        if ($hasDifficulty) {
            $select[] = "$table.difficulty as difficulty";
        }

        if ($hasScore) {
            $select[] = "$table.score as score";
        }

        if ($hasPercentage) {
            $select[] = "$table.percentage as percentage";
        }

        if ($hasCorrectAnswers) {
            $select[] = "$table.correct_answers as correct_answers";
        }

        if ($hasTotalQuestions) {
            $select[] = "$table.total_questions as total_questions";
        }

        if ($hasCreatedAt) {
            $select[] = "$table.created_at as created_at";
        }

        if ($hasNoteId && Schema::hasTable('notes')) {
            $select[] = 'notes.title as note_title';
        }

        if ($hasUserId && Schema::hasTable('users')) {
            $select[] = 'users.name as user_name';
        }

        $rows = $query
            ->select($select)
            ->when($hasCreatedAt, fn($q) => $q->latest("$table.created_at"))
            ->limit(8)
            ->get();

        return $rows->map(function ($row) use ($hasTotalQuestions) {
            $questionsCount = $hasTotalQuestions
                ? ($row->total_questions ?? 0)
                : $this->countQuizResponses($row->id);

            $score = $row->score ?? null;
            $percentage = $row->percentage ?? null;
            $correctAnswers = $row->correct_answers ?? null;

            if ($percentage === null && $score !== null && $questionsCount > 0) {
                $percentage = round(($score / $questionsCount) * 100);
            }

            $gradeText = '-';

            if ($correctAnswers !== null && $questionsCount > 0) {
                $gradeText = $correctAnswers . '/' . $questionsCount;
            } elseif ($score !== null && $questionsCount > 0) {
                $gradeText = $score . '/' . $questionsCount;
            } elseif ($percentage !== null) {
                $gradeText = $percentage . '%';
            } elseif ($score !== null) {
                $gradeText = $score;
            }

            return [
                'id' => $row->id,
                'note_id' => $row->note_id ?? null,
                'note_title' => $row->note_title ?? ('Quiz Attempt #' . $row->id),
                'user_name' => $row->user_name ?? '-',
                'difficulty' => $row->difficulty ?? 'Mixed',
                'questions_count' => $questionsCount,

                'score' => $score,
                'percentage' => $percentage,
                'correct_answers' => $correctAnswers,
                'grade' => $gradeText,

                'status' => 'generated',
                'created_at' => $row->created_at ?? null,
            ];
        })->values();
    }

    private function countQuizResponses($attemptId): int
    {
        if (!Schema::hasTable('quiz_responses')) {
            return 0;
        }

        if (Schema::hasColumn('quiz_responses', 'quiz_attempt_id')) {
            return DB::table('quiz_responses')
                ->where('quiz_attempt_id', $attemptId)
                ->count();
        }

        if (Schema::hasColumn('quiz_responses', 'attempt_id')) {
            return DB::table('quiz_responses')
                ->where('attempt_id', $attemptId)
                ->count();
        }

        return 0;
    }

    private function recentSummaries()
    {
        if (Schema::hasTable('summaries')) {
            return $this->recentSummariesFromTable();
        }

        return Note::query()
            ->with(['user:id,name,email'])
            ->whereNotNull('ai_summary')
            ->latest('ai_summary_generated_at')
            ->limit(8)
            ->get(['id', 'user_id', 'title', 'ai_summary', 'ai_summary_generated_at', 'updated_at', 'created_at'])
            ->map(fn(Note $note) => [
                'id' => $note->id,
                'note_title' => $note->title ?? 'Summary',
                'title' => $note->title ?? 'Summary',
                'user_name' => $note->user?->name ?? '-',
                'status' => 'generated',
                'words_count' => str_word_count(strip_tags((string) $note->ai_summary)),
                'created_at' => $note->ai_summary_generated_at ?? $note->updated_at ?? $note->created_at,
            ])
            ->values();
    }

    private function recentSummariesFromTable()
    {
        $table = 'summaries';

        $hasNoteId = Schema::hasColumn($table, 'note_id');
        $hasUserId = Schema::hasColumn($table, 'user_id');
        $hasTitle = Schema::hasColumn($table, 'title');
        $hasSummary = Schema::hasColumn($table, 'summary');
        $hasContent = Schema::hasColumn($table, 'content');
        $hasText = Schema::hasColumn($table, 'text');
        $hasStatus = Schema::hasColumn($table, 'status');
        $hasCreatedAt = Schema::hasColumn($table, 'created_at');

        $query = DB::table($table);

        if ($hasNoteId && Schema::hasTable('notes')) {
            $query->leftJoin('notes', "$table.note_id", '=', 'notes.id');
        }

        if ($hasUserId && Schema::hasTable('users')) {
            $query->leftJoin('users', "$table.user_id", '=', 'users.id');
        }

        $select = ["$table.id as id"];

        if ($hasNoteId) {
            $select[] = "$table.note_id as note_id";
        }

        if ($hasUserId) {
            $select[] = "$table.user_id as user_id";
        }

        if ($hasTitle) {
            $select[] = "$table.title as title";
        }

        if ($hasSummary) {
            $select[] = "$table.summary as summary_text";
        } elseif ($hasContent) {
            $select[] = "$table.content as summary_text";
        } elseif ($hasText) {
            $select[] = "$table.text as summary_text";
        }

        if ($hasStatus) {
            $select[] = "$table.status as status";
        }

        if ($hasCreatedAt) {
            $select[] = "$table.created_at as created_at";
        }

        if ($hasNoteId && Schema::hasTable('notes')) {
            $select[] = 'notes.title as note_title';
        }

        if ($hasUserId && Schema::hasTable('users')) {
            $select[] = 'users.name as user_name';
        }

        $rows = $query
            ->select($select)
            ->when($hasCreatedAt, fn($q) => $q->latest("$table.created_at"))
            ->limit(8)
            ->get();

        return $rows->map(fn($row) => [
            'id' => $row->id,
            'note_title' => $row->note_title ?? $row->title ?? ('Summary #' . $row->id),
            'title' => $row->title ?? $row->note_title ?? ('Summary #' . $row->id),
            'user_name' => $row->user_name ?? '-',
            'status' => $row->status ?? 'generated',
            'words_count' => str_word_count(strip_tags((string) ($row->summary_text ?? ''))),
            'created_at' => $row->created_at ?? null,
        ])->values();
    }
}
