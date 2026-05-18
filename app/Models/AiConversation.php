<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Support\Str;

class AiConversation extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'user_id',
        'note_id',
        'title',
        'summary',
        'messages_count',
        'last_message_at',
    ];

    protected $casts = [
        'last_message_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (AiConversation $conversation) {
            if (empty($conversation->uuid)) {
                $conversation->uuid = (string) Str::uuid();
            }
        });
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function note()
    {
        return $this->belongsTo(Note::class);
    }

    public function messages()
    {
        return $this->hasMany(AiConversationMessage::class);
    }
}
