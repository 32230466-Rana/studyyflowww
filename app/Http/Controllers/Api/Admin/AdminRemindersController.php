<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Reminder;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminRemindersController extends Controller
{
    public function index(Request $request)
    {
        $perPage = (int) $request->input('per_page', 25);
        $perPage = max(5, min(100, $perPage));

        $query = Reminder::query()
            ->with([
                'creator:id,name,email',
                'targetUser:id,name,email',
            ])
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        if ($request->has('is_active')) {
            $query->where('is_active', $request->boolean('is_active'));
        }

        if ($request->filled('type')) {
            $query->where('type', (string) $request->input('type'));
        }

        if ($request->filled('audience')) {
            $query->where('audience', (string) $request->input('audience'));
        }

        $reminders = $query->paginate($perPage);

        return ApiResponse::success([
            'reminders' => collect($reminders->items())->map(fn(Reminder $reminder) => $this->mapReminder($reminder))->values(),
            'pagination' => [
                'current_page' => $reminders->currentPage(),
                'per_page' => $reminders->perPage(),
                'total' => $reminders->total(),
                'last_page' => $reminders->lastPage(),
            ],
        ], 'Reminders loaded');
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'message' => ['required', 'string', 'max:5000'],
            'target_user_id' => ['nullable', 'integer', 'exists:users,id'],
            'audience' => ['required', Rule::in(['all', 'students', 'specific_user'])],
            'type' => ['required', Rule::in(['reminder', 'study_plan', 'announcement'])],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        if (($validated['audience'] ?? '') === 'specific_user' && empty($validated['target_user_id'])) {
            return ApiResponse::error('target_user_id is required when audience is specific_user.', 422);
        }

        if (($validated['audience'] ?? '') !== 'specific_user') {
            $validated['target_user_id'] = null;
        }

        $validated['created_by'] = $request->user()->id;

        $reminder = Reminder::create($validated)->load([
            'creator:id,name,email',
            'targetUser:id,name,email',
        ]);

        return ApiResponse::success(
            $this->mapReminder($reminder),
            'Reminder created',
            201
        );
    }

    public function update(Request $request, Reminder $reminder)
    {
        $validated = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'message' => ['sometimes', 'string', 'max:5000'],
            'target_user_id' => ['nullable', 'integer', 'exists:users,id'],
            'audience' => ['sometimes', Rule::in(['all', 'students', 'specific_user'])],
            'type' => ['sometimes', Rule::in(['reminder', 'study_plan', 'announcement'])],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('audience', $validated) && $validated['audience'] !== 'specific_user') {
            $validated['target_user_id'] = null;
        }

        if (($validated['audience'] ?? $reminder->audience) === 'specific_user') {
            $target = $validated['target_user_id'] ?? $reminder->target_user_id;
            if (! $target) {
                return ApiResponse::error('target_user_id is required when audience is specific_user.', 422);
            }
        }

        $reminder->fill($validated);
        $reminder->save();

        $reminder->load([
            'creator:id,name,email',
            'targetUser:id,name,email',
        ]);

        return ApiResponse::success($this->mapReminder($reminder), 'Reminder updated');
    }

    public function destroy(Reminder $reminder)
    {
        $reminder->delete();

        return ApiResponse::success(null, 'Reminder deleted');
    }

    private function mapReminder(Reminder $reminder): array
    {
        return [
            'id' => $reminder->id,
            'title' => $reminder->title,
            'message' => $reminder->message,
            'audience' => $reminder->audience,
            'type' => $reminder->type,
            'is_active' => (bool) $reminder->is_active,
            'target_user_id' => $reminder->target_user_id,
            'target_user' => $reminder->relationLoaded('targetUser') && $reminder->targetUser ? [
                'id' => $reminder->targetUser->id,
                'name' => $reminder->targetUser->name,
                'email' => $reminder->targetUser->email,
            ] : null,
            'created_by' => $reminder->created_by,
            'creator' => $reminder->relationLoaded('creator') && $reminder->creator ? [
                'id' => $reminder->creator->id,
                'name' => $reminder->creator->name,
                'email' => $reminder->creator->email,
            ] : null,
            'created_at' => optional($reminder->created_at)->toISOString(),
            'updated_at' => optional($reminder->updated_at)->toISOString(),
        ];
    }
}
