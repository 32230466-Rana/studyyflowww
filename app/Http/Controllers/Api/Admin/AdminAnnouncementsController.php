<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Models\User;
use App\Services\ActivityLogger;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;

class AdminAnnouncementsController extends Controller
{
    public function index(Request $request)
    {
        $query = Announcement::query()->with(['user:id,name,email']);

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                    ->orWhere('message', 'like', "%{$search}%");
            });
        }

        if ($request->has('is_active')) {
            $query->where('is_active', $request->boolean('is_active'));
        }

        if ($request->filled('type') && Schema::hasColumn('announcements', 'type')) {
            $query->where('type', (string) $request->input('type'));
        }

        $perPage = (int) $request->input('per_page', 10);
        $perPage = max(5, min(100, $perPage));

        $announcements = $query->latest('created_at')->paginate($perPage);

        return ApiResponse::success([
            'announcements' => collect($announcements->items())
                ->map(fn (Announcement $announcement) => $this->mapAnnouncement($announcement))
                ->values(),
            'pagination' => [
                'current_page' => $announcements->currentPage(),
                'per_page' => $announcements->perPage(),
                'total' => $announcements->total(),
                'last_page' => $announcements->lastPage(),
            ],
        ], 'Announcements retrieved');
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'message' => ['nullable', 'string', 'max:5000'],
            'body' => ['nullable', 'string', 'max:5000'],
            'type' => ['nullable', 'string', 'max:80'],
            'send_email' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'starts_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date', 'after_or_equal:starts_at'],
        ]);

        $body = trim((string) ($validated['body'] ?? $validated['message'] ?? ''));

        if ($body === '') {
            return ApiResponse::error('Announcement message is required.', 422);
        }

        $payload = $this->payload($validated, $body, [
            'user_id' => $request->user()?->id,
            'created_by' => $request->user()?->id,
            'is_active' => (bool) ($validated['is_active'] ?? true),
        ]);

        $announcement = Announcement::create($payload);

        ActivityLogger::log(
            $request->user()?->id,
            'announcement_created',
            'Announcement created',
            $announcement->title,
            Announcement::class,
            $announcement->id
        );

        if ((bool) ($validated['send_email'] ?? false)) {
            $this->sendAnnouncementEmails($announcement);
        }

        return ApiResponse::success(
            $this->mapAnnouncement($announcement->load('user:id,name,email')),
            'Announcement created',
            201
        );
    }

    public function update(Request $request, Announcement $announcement)
    {
        $validated = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'message' => ['nullable', 'string', 'max:5000'],
            'body' => ['nullable', 'string', 'max:5000'],
            'type' => ['nullable', 'string', 'max:80'],
            'send_email' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'starts_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date', 'after_or_equal:starts_at'],
        ]);

        $body = array_key_exists('body', $validated) || array_key_exists('message', $validated)
            ? trim((string) ($validated['body'] ?? $validated['message'] ?? ''))
            : null;

        $announcement->fill($this->payload($validated, $body));
        $announcement->save();

        return ApiResponse::success(
            $this->mapAnnouncement($announcement->load('user:id,name,email')),
            'Announcement updated'
        );
    }

    public function destroy(Request $request, Announcement $announcement)
    {
        $announcement->delete();

        return ApiResponse::success(null, 'Announcement deleted');
    }

    public function toggleStatus(Request $request, Announcement $announcement)
    {
        $announcement->update(['is_active' => ! (bool) $announcement->is_active]);

        return ApiResponse::success(
            $this->mapAnnouncement($announcement->load('user:id,name,email')),
            'Announcement status toggled'
        );
    }

    public function sendEmail(Request $request, Announcement $announcement)
    {
        if (! config('admin_features.emails', true)) {
            return ApiResponse::error('This feature is temporarily disabled.', 503);
        }

        $sent = $this->sendAnnouncementEmails($announcement);

        return ApiResponse::success([
            'sent' => $sent,
        ], 'Announcement email sent');
    }

    private function mapAnnouncement(Announcement $announcement): array
    {
        $body = $announcement->body ?? $announcement->message;

        return [
            'id' => $announcement->id,
            'title' => $announcement->title,
            'message' => $announcement->message ?? $body,
            'body' => $body,
            'type' => $announcement->type ?? 'Important message',
            'send_email' => (bool) ($announcement->send_email ?? false),
            'is_active' => (bool) $announcement->is_active,
            'starts_at' => $announcement->starts_at,
            'expires_at' => $announcement->expires_at,
            'created_at' => $announcement->created_at,
            'updated_at' => $announcement->updated_at,
            'author' => $announcement->user ? [
                'id' => $announcement->user->id,
                'name' => $announcement->user->name,
                'email' => $announcement->user->email,
            ] : null,
        ];
    }

    private function payload(array $validated, ?string $body, array $extra = []): array
    {
        $payload = $extra;

        foreach (['title', 'is_active', 'starts_at', 'expires_at'] as $field) {
            if (array_key_exists($field, $validated)) {
                $payload[$field] = $validated[$field];
            }
        }

        if ($body !== null) {
            $payload['message'] = $body;

            if (Schema::hasColumn('announcements', 'body')) {
                $payload['body'] = $body;
            }
        }

        if (Schema::hasColumn('announcements', 'type')) {
            $payload['type'] = $validated['type'] ?? 'Important message';
        }

        if (Schema::hasColumn('announcements', 'send_email')) {
            $payload['send_email'] = (bool) ($validated['send_email'] ?? false);
        }

        foreach (['user_id', 'created_by'] as $field) {
            if (array_key_exists($field, $payload) && ! Schema::hasColumn('announcements', $field)) {
                unset($payload[$field]);
            }
        }

        return $payload;
    }

    private function sendAnnouncementEmails(Announcement $announcement): int
    {
        if (! config('admin_features.emails', true)) {
            return 0;
        }

        $users = User::query()
            ->where('status', 'active')
            ->where('is_admin', false)
            ->get(['id', 'name', 'email']);

        $sent = 0;

        foreach ($users as $user) {
            try {
                Mail::raw($announcement->body ?? $announcement->message, function ($mail) use ($user, $announcement) {
                    $mail->to($user->email)->subject($announcement->title);
                });

                $sent++;
            } catch (\Throwable $e) {
                Log::warning('Announcement email failed', [
                    'announcement_id' => $announcement->id,
                    'user_id' => $user->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        ActivityLogger::log(
            request()->user()?->id,
            'announcement_email_sent',
            'Announcement email sent',
            $announcement->title . ' sent to ' . $sent . ' active users',
            Announcement::class,
            $announcement->id
        );

        return $sent;
    }
}
