<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AiUsage extends Model
{
    protected $fillable = [
        'user_id',
        'feature',
        'note_id',
        'metadata',
    ];

    protected $casts = [
        'metadata' => 'array',
    ];
}
