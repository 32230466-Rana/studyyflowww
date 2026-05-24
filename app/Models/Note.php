<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Note extends Model
{
    protected $fillable = [
        'user_id',
        'title',
        'description',
        'original_filename',
        'stored_path',
        'mime_type',
        'file_size',
        'status',
        'source_type',
        'is_featured',
        'text_content',
        'quiz',
        'ai_summary',
        'ai_summary_generated_at',
    ];

    protected function casts(): array
    {
        return [
            'file_size' => 'integer',
            'is_featured' => 'boolean',
            'quiz' => 'array',
            'ai_summary_generated_at' => 'datetime',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function summaries()
    {
        return $this->hasMany(Summary::class);
    }

    public function latestSummary()
    {
        return $this->hasOne(Summary::class)->latestOfMany();
    }
}
