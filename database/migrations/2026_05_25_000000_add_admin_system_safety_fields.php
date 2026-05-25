<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('users')) {
            Schema::table('users', function (Blueprint $table) {
                if (! Schema::hasColumn('users', 'is_active')) {
                    $table->boolean('is_active')->default(true)->after('is_admin');
                }
            });
        }

        if (Schema::hasTable('feedback')) {
            Schema::table('feedback', function (Blueprint $table) {
                if (! Schema::hasColumn('feedback', 'type')) {
                    $table->string('type')->default('suggestion')->after('name');
                }

                if (! Schema::hasColumn('feedback', 'status')) {
                    $table->string('status')->default('open')->after('message');
                }
            });
        }

        if (Schema::hasTable('announcements')) {
            Schema::table('announcements', function (Blueprint $table) {
                if (! Schema::hasColumn('announcements', 'user_id')) {
                    $table->unsignedBigInteger('user_id')->nullable()->after('id');
                }

                if (! Schema::hasColumn('announcements', 'created_by')) {
                    $table->unsignedBigInteger('created_by')->nullable()->after('user_id');
                }

                if (! Schema::hasColumn('announcements', 'title')) {
                    $table->string('title')->nullable()->after('created_by');
                }

                if (! Schema::hasColumn('announcements', 'message')) {
                    $table->text('message')->nullable()->after('title');
                }

                if (! Schema::hasColumn('announcements', 'body')) {
                    $table->text('body')->nullable()->after('message');
                }

                if (! Schema::hasColumn('announcements', 'type')) {
                    $table->string('type')->default('Important message')->after('body');
                }

                if (! Schema::hasColumn('announcements', 'send_email')) {
                    $table->boolean('send_email')->default(false)->after('type');
                }

                if (! Schema::hasColumn('announcements', 'is_active')) {
                    $table->boolean('is_active')->default(true)->after('send_email');
                }

                if (! Schema::hasColumn('announcements', 'starts_at')) {
                    $table->timestamp('starts_at')->nullable()->after('is_active');
                }

                if (! Schema::hasColumn('announcements', 'expires_at')) {
                    $table->timestamp('expires_at')->nullable()->after('starts_at');
                }
            });
        }

        if (! Schema::hasTable('announcement_reads')) {
            Schema::create('announcement_reads', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('announcement_id');
                $table->unsignedBigInteger('user_id');
                $table->timestamp('read_at')->nullable();
                $table->timestamps();

                $table->unique(['announcement_id', 'user_id']);
                $table->index(['user_id', 'read_at']);
            });
        }

        if (! Schema::hasTable('activity_logs')) {
            Schema::create('activity_logs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id')->nullable();
                $table->string('action');
                $table->text('description')->nullable();
                $table->json('metadata')->nullable();
                $table->timestamps();

                $table->index(['action', 'created_at']);
                $table->index(['user_id', 'created_at']);
            });
        }

        if (Schema::hasTable('study_plans')) {
            Schema::table('study_plans', function (Blueprint $table) {
                if (! Schema::hasColumn('study_plans', 'metadata')) {
                    $table->json('metadata')->nullable()->after('content');
                }
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_logs');
        Schema::dropIfExists('announcement_reads');

        if (Schema::hasTable('study_plans') && Schema::hasColumn('study_plans', 'metadata')) {
            Schema::table('study_plans', fn (Blueprint $table) => $table->dropColumn('metadata'));
        }

        if (Schema::hasTable('announcements')) {
            Schema::table('announcements', function (Blueprint $table) {
                $columns = [];

                foreach (['created_by', 'body', 'type', 'send_email'] as $column) {
                    if (Schema::hasColumn('announcements', $column)) {
                        $columns[] = $column;
                    }
                }

                if ($columns !== []) {
                    $table->dropColumn($columns);
                }
            });
        }

        if (Schema::hasTable('feedback')) {
            Schema::table('feedback', function (Blueprint $table) {
                $columns = [];

                foreach (['type', 'status'] as $column) {
                    if (Schema::hasColumn('feedback', $column)) {
                        $columns[] = $column;
                    }
                }

                if ($columns !== []) {
                    $table->dropColumn($columns);
                }
            });
        }

        if (Schema::hasTable('users') && Schema::hasColumn('users', 'is_active')) {
            Schema::table('users', fn (Blueprint $table) => $table->dropColumn('is_active'));
        }
    }
};
