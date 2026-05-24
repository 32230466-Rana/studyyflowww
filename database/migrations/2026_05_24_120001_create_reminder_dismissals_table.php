<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reminder_dismissals', function (Blueprint $table) {
            $table->id();

            $table->foreignId('reminder_id')
                ->constrained('reminders')
                ->cascadeOnDelete();

            $table->foreignId('user_id')
                ->constrained('users')
                ->cascadeOnDelete();

            $table->timestamp('dismissed_at')->useCurrent();

            $table->timestamps();

            $table->unique(['reminder_id', 'user_id']);
            $table->index(['user_id', 'dismissed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reminder_dismissals');
    }
};
