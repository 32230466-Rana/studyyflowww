<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_conversation_messages', function (Blueprint $table) {
            $table->id();

            $table->foreignId('ai_conversation_id')
                ->constrained('ai_conversations')
                ->cascadeOnDelete();

            $table->foreignId('user_id')
                ->constrained()
                ->cascadeOnDelete();

            $table->enum('role', ['user', 'assistant', 'system']);

            $table->longText('content');

            // optional: later نخزن source note/page/chunks/model وغيره
            $table->json('metadata')->nullable();

            $table->timestamps();

            $table->index(['ai_conversation_id', 'created_at']);
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_conversation_messages');
    }
};
