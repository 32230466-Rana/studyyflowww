<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('exam_reminders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('title');
            $table->text('message');
            $table->dateTime('exam_date')->nullable();
            $table->string('status')->default('pending'); // pending, sent
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exam_reminders');
    }
};
