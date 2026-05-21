<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
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

        $quizCount = $this->countTable('quiz_attempts');

        $summaryCount = Schema::hasTable('summaries')
            ? DB::table('summaries')->count()
            : $this->countNotesWithSummary();

        $stats = [
            'total_users' => $this->countTable('users'),
            'total_notes' => $this->countTable('notes'),
            'total_admins' => $this->countWhereBoolean('users', 'is_admin', true),
            'admin_users' => $this->countWhereBoolean('users', 'is_admin', true),
            'featured_notes' => $this->countWhereBoolean('notes', 'is_featured', true),
            'ai_summaries' => $summaryCount,
            'active_users' => $this->countWhereValue('users', 'status', 'active'),
            'ai_usage_count' => $this->countTable('ai_usages'),
            'ai_usage' => $this->countTable('ai_usages'),
            'quizzes_created' => $quizCount,
            'quiz_count' => $quizCount,
            'files_uploaded' => $this->countUploadedFiles(),
            'today_users' => $this->countWhereDate('users', 'created_at', today()),
            'today_notes' => $this->countWhereDate('notes', 'created_at', today()),
            'today_ai_usage' => $this->countWhereDate('ai_usages', 'created_at', today()),
        ];

        $recentUsers = $this->recentUsers();
        $recentNotes = $this->recentNotes();
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
            'system_health' => [
                [
                    'name' => 'Laravel API',
                    'status' => 'Online',
                    'type' => 'online',
                ],
                [
                    'name' => 'Admin Dashboard API',
                    'status' => 'Online',
                    'type' => 'online',
                ],
                [
                    'name' => 'Summary Service',
                    'status' => 'Connected',
                    'type' => 'connected',
                ],
                [
                    'name' => 'Quiz Generator',
                    'status' => 'Ready',
                    'type' => 'ready',
                ],
                [
                    'name' => 'Current AI Model',
                    'status' => 'Local Ollama',
                    'type' => 'default',
                ],
            ],
        ], 'Admin dashboard loaded');
    }

    private function countTable(string $table): int
    {
        if (!Schema::hasTable($table)) {
            return 0;
        }

        return DB::table($table)->count();
    }

    private function countWhereBoolean(string $table, string $column, bool $value): int
    {
        if (!Schema::hasTable($table) || !Schema::hasColumn($table, $column)) {
            return 0;
        }

        return DB::table($table)->where($column, $value)->count();
    }

    private function countWhereValue(string $table, string $column, mixed $value): int
    {
        if (!Schema::hasTable($table) || !Schema::hasColumn($table, $column)) {
            return 0;
        }

        return DB::table($table)->where($column, $value)->count();
    }

    private function countWhereDate(string $table, string $column, $date): int
    {
        if (!Schema::hasTable($table) || !Schema::hasColumn($table, $column)) {
            return 0;
        }

        return DB::table($table)->whereDate($column, $date)->count();
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

    private function countNotesWithSummary(): int
    {
        if (!Schema::hasTable('notes') || !Schema::hasColumn('notes', 'ai_summary')) {
            return 0;
        }

        return Note::whereNotNull('ai_summary')
            ->where('ai_summary', '!=', '')
            ->count();
    }

    private function countUploadedFiles(): int
    {
        if (!Schema::hasTable('notes')) {
            return 0;
        }

        foreach (['stored_path', 'file_path', 'original_filename'] as $column) {
            if (Schema::hasColumn('notes', $column)) {
                return Note::whereNotNull($column)
                    ->where($column, '!=', '')
                    ->count();
            }
        }

        return Note::count();
    }

    private function recentUsers()
    {
        if (!Schema::hasTable('users')) {
            return collect();
        }

        $select = ['id', 'name', 'email', 'created_at'];

        if (Schema::hasColumn('users', 'is_admin')) {
            $select[] = 'is_admin';
        }

        if (Schema::hasColumn('users', 'status')) {
            $select[] = 'status';
        }

        return User::query()
            ->latest('created_at')
            ->limit(8)
            ->get($select)
            ->map(fn(User $user) => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => ($user->is_admin ?? false) ? 'admin' : 'user',
                'is_admin' => (bool) ($user->is_admin ?? false),
                'status' => $user->status ?? 'active',
                'created_at' => $user->created_at,
            ])
            ->values();
    }

    private function recentNotes()
    {
        if (!Schema::hasTable('notes')) {
            return collect();
        }

        $select = ['id', 'title', 'created_at'];

        $hasUserId = Schema::hasColumn('notes', 'user_id');

        if ($hasUserId) {
            $select[] = 'user_id';
        }

        if (Schema::hasColumn('notes', 'source_type')) {
            $select[] = 'source_type';
        }

        if (Schema::hasColumn('notes', 'is_featured')) {
            $select[] = 'is_featured';
        }

        $query = Note::query();

        if ($hasUserId && Schema::hasTable('users')) {
            $query->with(['user:id,name,email']);
        }

        return $query
            ->latest('created_at')
            ->limit(8)
            ->get($select)
            ->map(fn(Note $note) => [
                'id' => $note->id,
                'title' => $note->title ?? 'Untitled',
                'source_type' => $note->source_type ?? '-',
                'source' => $note->source_type ?? '-',
                'type' => $note->source_type ?? '-',
                'is_featured' => (bool) ($note->is_featured ?? false),
                'created_at' => $note->created_at,
                'user' => $note->user ? [
                    'id' => $note->user->id,
                    'name' => $note->user->name,
                    'email' => $note->user->email,
                ] : null,
                'user_name' => $note->user?->name ?? '-',
            ])
            ->values();
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
                ? (int) ($row->total_questions ?? 0)
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
                $gradeText = (string) $score;
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

        if (!Schema::hasTable('notes') || !Schema::hasColumn('notes', 'ai_summary')) {
            return collect();
        }

        $select = ['id', 'title', 'ai_summary', 'created_at'];

        if (Schema::hasColumn('notes', 'user_id')) {
            $select[] = 'user_id';
        }

        if (Schema::hasColumn('notes', 'updated_at')) {
            $select[] = 'updated_at';
        }

        if (Schema::hasColumn('notes', 'ai_summary_generated_at')) {
            $select[] = 'ai_summary_generated_at';
            $orderColumn = 'ai_summary_generated_at';
        } elseif (Schema::hasColumn('notes', 'updated_at')) {
            $orderColumn = 'updated_at';
        } else {
            $orderColumn = 'created_at';
        }

        return Note::query()
            ->with(['user:id,name,email'])
            ->whereNotNull('ai_summary')
            ->where('ai_summary', '!=', '')
            ->latest($orderColumn)
            ->limit(8)
            ->get($select)
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
        $hasStatus = Schema::hasColumn($table, 'status');
        $hasCreatedAt = Schema::hasColumn($table, 'created_at');

        $summaryColumn = collect([
            'summary',
            'summary_text',
            'content',
            'text',
            'generated_summary',
            'ai_summary',
            'result',
            'response',
        ])->first(fn($column) => Schema::hasColumn($table, $column));

        $wordsColumn = collect([
            'words_count',
            'word_count',
            'words',
        ])->first(fn($column) => Schema::hasColumn($table, $column));

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

        if ($summaryColumn) {
            $select[] = "$table.$summaryColumn as summary_text";
        }

        if ($wordsColumn) {
            $select[] = "$table.$wordsColumn as words_count_value";
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

        return $rows->map(function ($row) use ($wordsColumn) {
            $text = (string) ($row->summary_text ?? '');

            return [
                'id' => $row->id,
                'note_title' => $row->note_title ?? $row->title ?? ('Summary #' . $row->id),
                'title' => $row->title ?? $row->note_title ?? ('Summary #' . $row->id),
                'user_name' => $row->user_name ?? '-',
                'status' => $row->status ?? 'generated',
                'words_count' => $wordsColumn
                    ? (int) ($row->words_count_value ?? 0)
                    : str_word_count(strip_tags($text)),
                'created_at' => $row->created_at ?? null,
            ];
        })->values();
    }
}
