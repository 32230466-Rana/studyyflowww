<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\RecentActivity;
use App\Models\ExamReminder;
use App\Models\QuizIssueReport;
use App\Models\StudyPlan;
use App\Services\ActivityLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;

class AdminFeatureController extends Controller
{
    public function recentActivities(Request $request)
    {
        $query = RecentActivity::with('user')->latest();

        if ($request->filled('type')) {
            $query->where('type', $request->type);
        }

        if ($request->filled('date')) {
            $query->whereDate('created_at', $request->date);
        }

        return response()->json([
            'activities' => $query->take(50)->get(),
        ]);
    }

    public function examReminders()
    {
        return response()->json([
            'reminders' => ExamReminder::with('user')->latest()->get(),
            'users' => User::select('id', 'name', 'email', 'last_login_at')->orderBy('name')->get(),
        ]);
    }

    public function storeExamReminder(Request $request)
    {
        $data = $request->validate([
            'user_id' => ['nullable', 'exists:users,id'],
            'title' => ['required', 'string', 'max:255'],
            'message' => ['required', 'string'],
            'exam_date' => ['nullable', 'date'],
        ]);

        $reminder = ExamReminder::create($data);

        ActivityLogger::log(
            $data['user_id'] ?? null,
            'exam_reminder_created',
            'Exam reminder created',
            $data['title'],
            ExamReminder::class,
            $reminder->id
        );

        return response()->json([
            'message' => 'Exam reminder created successfully.',
            'reminder' => $reminder,
        ]);
    }

    public function sendExamReminder($id)
    {
        $reminder = ExamReminder::findOrFail($id);

        $users = $reminder->user_id
            ? User::where('id', $reminder->user_id)->get()
            : User::all();

        foreach ($users as $user) {
            Mail::raw($reminder->message, function ($mail) use ($user, $reminder) {
                $mail->to($user->email)
                    ->subject($reminder->title);
            });

            ActivityLogger::log(
                $user->id,
                'exam_reminder_sent',
                'Exam reminder sent',
                $reminder->title,
                ExamReminder::class,
                $reminder->id
            );
        }

        $reminder->update([
            'status' => 'sent',
        ]);

        return response()->json([
            'message' => 'Exam reminder email sent successfully.',
        ]);
    }

    public function quizReports()
    {
        return response()->json([
            'reports' => QuizIssueReport::with('user')->latest()->get(),
        ]);
    }

    public function updateQuizReportStatus(Request $request, $id)
    {
        $data = $request->validate([
            'status' => ['required', 'in:open,reviewed,resolved'],
        ]);

        $report = QuizIssueReport::findOrFail($id);
        $report->update($data);

        return response()->json([
            'message' => 'Quiz issue status updated.',
            'report' => $report,
        ]);
    }

    public function studyPlans(Request $request)
    {
        $query = StudyPlan::with('user')->latest();

        if ($request->filled('search')) {
            $search = $request->search;

            $query->whereHas('user', function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        return response()->json([
            'plans' => $query->get(),
        ]);
    }

    public function deleteStudyPlan($id)
    {
        $plan = StudyPlan::findOrFail($id);
        $plan->delete();

        return response()->json([
            'message' => 'Study plan deleted successfully.',
        ]);
    }

    public function sendWeMissYouEmail($userId)
    {
        $user = User::findOrFail($userId);

        Mail::raw(
            "Hi {$user->name},\n\nWe miss you on StudyFlow! Come back to review your notes, generate summaries, take quizzes, and continue your study progress.\n\nBest,\nStudyFlow Team",
            function ($mail) use ($user) {
                $mail->to($user->email)
                    ->subject('We miss you on StudyFlow');
            }
        );

        ActivityLogger::log(
            $user->id,
            'we_miss_you_sent',
            'We Miss You email sent',
            'Admin sent a we miss you email to ' . $user->email
        );

        return response()->json([
            'message' => 'We Miss You email sent successfully.',
        ]);
    }

    public function sendRecommendationEmail(Request $request)
    {
        $data = $request->validate([
            'user_id' => ['required', 'exists:users,id'],
            'subject' => ['required', 'string', 'max:255'],
            'message' => ['required', 'string'],
        ]);

        $user = User::findOrFail($data['user_id']);

        Mail::raw($data['message'], function ($mail) use ($user, $data) {
            $mail->to($user->email)
                ->subject($data['subject']);
        });

        ActivityLogger::log(
            $user->id,
            'recommendation_email_sent',
            'Recommendation email sent',
            $data['subject']
        );

        return response()->json([
            'message' => 'Recommendation email sent successfully.',
        ]);
    }

    public function users()
    {
        return response()->json([
            'users' => User::select('id', 'name', 'email', 'last_login_at', 'created_at')
                ->latest()
                ->get(),
        ]);
    }
}
