<?php

namespace Database\Seeders;

use App\Models\AiUsage;
use App\Models\Announcement;
use App\Models\Feedback;
use App\Models\Note;
use App\Models\QuizIssueReport;
use App\Models\RecentActivity;
use App\Models\StudyPlan;
use App\Models\Summary;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

class DemoDataSeeder extends Seeder
{
    public function run(): void
    {
        $adminValues = [
            'name' => 'StudyFlow Admin',
            'password' => Hash::make('password123'),
            'email_verified_at' => now(),
            'is_admin' => true,
            'status' => 'active',
            'last_login_at' => now(),
            'last_seen_at' => now(),
        ];

        if (Schema::hasColumn('users', 'is_active')) {
            $adminValues['is_active'] = true;
        }

        $admin = User::updateOrCreate(
            ['email' => 'admin@studyflow.test'],
            $adminValues
        );

        $students = collect([
            ['name' => 'Maya Student', 'email' => 'student1@studyflow.test', 'status' => 'active'],
            ['name' => 'Omar Student', 'email' => 'student2@studyflow.test', 'status' => 'active'],
            ['name' => 'Lina Student', 'email' => 'student3@studyflow.test', 'status' => 'inactive'],
        ])->map(function (array $data) {
            $studentValues = [
                'name' => $data['name'],
                'password' => Hash::make('password123'),
                'email_verified_at' => now(),
                'is_admin' => false,
                'status' => $data['status'],
                'last_login_at' => $data['status'] === 'active' ? now()->subDays(rand(0, 4)) : now()->subDays(9),
                'last_seen_at' => $data['status'] === 'active' ? now()->subHours(rand(1, 20)) : now()->subDays(9),
            ];

            if (Schema::hasColumn('users', 'is_active')) {
                $studentValues['is_active'] = $data['status'] === 'active';
            }

            return User::updateOrCreate(['email' => $data['email']], $studentValues);
        });

        $students->each(function (User $student, int $index) {
            $note = Note::updateOrCreate(
                [
                    'user_id' => $student->id,
                    'title' => 'Demo note ' . ($index + 1),
                ],
                [
                    'description' => 'Sample uploaded note for the university demo.',
                    'source_type' => 'pdf',
                    'status' => $index === 2 ? 'failed' : 'uploaded',
                    'original_filename' => 'demo-note-' . ($index + 1) . '.pdf',
                    'stored_path' => 'demo/demo-note-' . ($index + 1) . '.pdf',
                    'mime_type' => 'application/pdf',
                    'file_size' => 120000 + ($index * 10000),
                    'text_content' => 'Demo study content for notes, summaries, quizzes, and study planning.',
                    'ai_summary' => $index === 2 ? null : 'Short sample summary for demo note ' . ($index + 1) . '.',
                    'ai_summary_generated_at' => $index === 2 ? null : now()->subDays($index),
                ]
            );

            Summary::updateOrCreate(
                [
                    'user_id' => $student->id,
                    'note_id' => $note->id,
                    'title' => 'Demo summary ' . ($index + 1),
                ],
                [
                    'source_type' => 'pdf',
                    'summary_text' => 'A short sample summary for the admin demo dashboard.',
                ]
            );

            StudyPlan::updateOrCreate(
                [
                    'user_id' => $student->id,
                    'title' => 'Demo study plan ' . ($index + 1),
                ],
                [
                    'content' => "Day 1: Review notes.\nDay 2: Practice quizzes.\nDay 3: Revise weak topics.",
                ]
            );

            for ($i = 0; $i < 5 + $index; $i++) {
                $createdAt = now()->startOfWeek()->addDays($index)->addMinutes($i);
                $feature = $i % 2 === 0 ? 'ask_note' : 'summary';

                $exists = AiUsage::query()
                    ->where('user_id', $student->id)
                    ->where('feature', $feature)
                    ->where('note_id', $note->id)
                    ->where('created_at', $createdAt)
                    ->exists();

                if (! $exists) {
                    $usage = AiUsage::create([
                        'user_id' => $student->id,
                        'feature' => $feature,
                        'note_id' => $note->id,
                    ]);

                    $usage->forceFill([
                        'created_at' => $createdAt,
                        'updated_at' => $createdAt,
                    ])->save();
                }
            }
        });

        $firstFeedback = [
            'name' => $students[0]->name,
            'rating' => 5,
            'is_visible' => true,
        ];

        if (Schema::hasColumn('feedback', 'type')) {
            $firstFeedback['type'] = 'suggestion';
        }

        if (Schema::hasColumn('feedback', 'status')) {
            $firstFeedback['status'] = 'open';
        }

        Feedback::updateOrCreate(
            ['user_id' => $students[0]->id, 'message' => 'Please add more quiz issue reporting.'],
            $firstFeedback
        );

        $secondFeedback = [
            'name' => $students[1]->name,
            'rating' => 3,
            'is_visible' => true,
        ];

        if (Schema::hasColumn('feedback', 'type')) {
            $secondFeedback['type'] = 'problem';
        }

        if (Schema::hasColumn('feedback', 'status')) {
            $secondFeedback['status'] = 'open';
        }

        Feedback::updateOrCreate(
            ['user_id' => $students[1]->id, 'message' => 'I had a problem opening one uploaded PDF.'],
            $secondFeedback
        );

        $announcementValues = [
            'user_id' => $admin->id,
            'message' => 'Review your saved notes and summaries before the exam.',
            'is_active' => true,
        ];

        if (Schema::hasColumn('announcements', 'created_by')) {
            $announcementValues['created_by'] = $admin->id;
        }

        if (Schema::hasColumn('announcements', 'body')) {
            $announcementValues['body'] = 'Review your saved notes and summaries before the exam.';
        }

        if (Schema::hasColumn('announcements', 'type')) {
            $announcementValues['type'] = 'Exam reminder';
        }

        if (Schema::hasColumn('announcements', 'send_email')) {
            $announcementValues['send_email'] = false;
        }

        Announcement::updateOrCreate(
            ['title' => 'Midterm review reminder'],
            $announcementValues
        );

        QuizIssueReport::updateOrCreate(
            ['issue_message' => 'One generated quiz answer looked unclear.'],
            [
                'user_id' => $students[0]->id,
                'question_text' => 'Demo quiz question',
                'status' => 'open',
            ]
        );

        foreach ([
            [$admin->id, 'user_login', 'Login activity', 'Admin logged in'],
            [$students[0]->id, 'note_uploaded', 'New note uploaded', 'A student uploaded a note'],
            [$students[0]->id, 'quiz_generated', 'Quiz generated', 'A student generated a quiz'],
            [$students[1]->id, 'summary_generated', 'Summary generated', 'A student generated a summary'],
            [$students[1]->id, 'feedback_submitted', 'Feedback submitted', 'A student submitted feedback'],
        ] as [$userId, $type, $title, $description]) {
            RecentActivity::firstOrCreate([
                'user_id' => $userId,
                'type' => $type,
                'title' => $title,
                'description' => $description,
            ]);
        }
    }
}
