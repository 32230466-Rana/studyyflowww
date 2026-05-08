<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class NoteChatMessage extends Model
{
    protected $fillable = [
        'note_chat_session_id',
        'role',
        'content',
    ];

    public function session()
    {
        return $this->belongsTo(NoteChatSession::class, 'note_chat_session_id');
    }
}
