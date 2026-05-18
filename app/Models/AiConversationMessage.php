<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class AiConversationMessage extends Model
{
    use HasFactory;

    protected $fillable = [
        'ai_conversation_id',
        'user_id',
        'role',
        'content',
        'metadata',
    ];

    protected $casts = [
        'metadata' => 'array',
    ];

    public function conversation()
    {
        return $this->belongsTo(AiConversation::class, 'ai_conversation_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
