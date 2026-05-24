<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\QuizIssueReport;
use App\Services\ActivityLogger;
use Illuminate\Http\Request;

class QuizIssueReportController extends Controller
{
    public function store(Request $request)
    {
        $data = $request->validate([
            'quiz_id' => ['nullable', 'integer'],
            'note_id' => ['nullable', 'integer'],
            'question_text' => ['nullable', 'string'],
            'issue_message' => ['required', 'string', 'max:2000'],
        ]);

        $report = QuizIssueReport::create([
            'user_id' => $request->user()->id,
            ...$data,
        ]);

        ActivityLogger::log(
            $request->user()->id,
            'quiz_issue_reported',
            'Quiz issue reported',
            $data['issue_message'],
            QuizIssueReport::class,
            $report->id
        );

        return response()->json([
            'message' => 'Quiz issue reported successfully.',
            'report' => $report,
        ]);
    }
}
