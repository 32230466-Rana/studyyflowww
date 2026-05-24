<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RecentActivity extends Model
{
    protected $fillable = [
        'user_id',
        'type',
        'title',
        'description',
        'related_type',
        'related_id',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
