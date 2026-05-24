<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QuizIssueReport extends Model
{
    protected $fillable = [
        'user_id',
        'quiz_id',
        'note_id',
        'question_text',
        'issue_message',
        'status',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
