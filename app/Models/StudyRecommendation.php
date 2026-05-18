<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class StudyRecommendation extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'note_id',
        'pdf_title',
        'slide_number',
        'page_number',
        'slide_title',
        'reason',
        'action_url',
        'raw_payload',
    ];

    protected $casts = [
        'raw_payload' => 'array',
    ];
}
