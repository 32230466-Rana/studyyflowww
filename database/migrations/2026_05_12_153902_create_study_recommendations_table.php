<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('study_recommendations', function (Blueprint $table) {
            $table->id();

            $table->foreignId('user_id')
                ->constrained()
                ->cascadeOnDelete();

            $table->unsignedBigInteger('note_id')->nullable();

            $table->string('pdf_title')->nullable();

            $table->unsignedInteger('slide_number')->nullable();
            $table->unsignedInteger('page_number')->nullable();

            $table->string('slide_title')->nullable();
            $table->text('reason')->nullable();

            $table->string('action_url')->nullable();

            $table->json('raw_payload')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('study_recommendations');
    }
};
