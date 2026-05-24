<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ExamReminder extends Model
{
    protected $fillable = [
        'user_id',
        'title',
        'message',
        'exam_date',
        'status',
    ];

    protected $casts = [
        'exam_date' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
