<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StudyPlan extends Model
{
    protected $fillable = [
        'user_id',
        'title',
        'content',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
