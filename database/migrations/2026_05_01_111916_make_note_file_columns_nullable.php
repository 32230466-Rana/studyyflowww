<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE notes MODIFY original_filename VARCHAR(255) NULL");
        DB::statement("ALTER TABLE notes MODIFY stored_path VARCHAR(255) NULL");
        DB::statement("ALTER TABLE notes MODIFY mime_type VARCHAR(255) NULL");
        DB::statement("ALTER TABLE notes MODIFY file_size BIGINT NULL");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE notes MODIFY original_filename VARCHAR(255) NOT NULL");
        DB::statement("ALTER TABLE notes MODIFY stored_path VARCHAR(255) NOT NULL");
        DB::statement("ALTER TABLE notes MODIFY mime_type VARCHAR(255) NOT NULL");
        DB::statement("ALTER TABLE notes MODIFY file_size BIGINT NOT NULL");
    }
};
