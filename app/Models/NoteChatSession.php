<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class NoteChatSession extends Model
{
    protected $fillable = [
        'note_id',
        'user_id',
        'title',
    ];

    public function note()
    {
        return $this->belongsTo(Note::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function messages()
    {
        return $this->hasMany(NoteChatMessage::class);
    }
}
