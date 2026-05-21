<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiConversation;
use App\Models\AiConversationMessage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AiConversationController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        $query = AiConversation::query()
            ->where('user_id', $user->id)
            ->with(['note:id,title'])
            ->latest('updated_at');

        if ($request->filled('note_id')) {
            $query->where('note_id', $request->integer('note_id'));
        }

        $conversations = $query->paginate(20);

        return response()->json([
            'conversations' => $conversations,
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user();

        $data = $request->validate([
            'note_id' => ['nullable', 'integer', 'exists:notes,id'],
            'title' => ['nullable', 'string', 'max:120'],
        ]);

        $conversation = AiConversation::create([
            'user_id' => $user->id,
            'note_id' => $data['note_id'] ?? null,
            'title' => $data['title'] ?? 'New chat',
            'summary' => null,
            'messages_count' => 0,
            'last_message_at' => null,
        ]);

        return response()->json([
            'message' => 'Conversation created successfully.',
            'conversation' => $conversation,
        ], 201);
    }

    public function show(Request $request, string $uuid)
    {
        $conversation = $this->findUserConversation($request, $uuid);

        $conversation->load(['note:id,title']);

        return response()->json([
            'conversation' => $conversation,
        ]);
    }

    public function messages(Request $request, string $uuid)
    {
        $conversation = $this->findUserConversation($request, $uuid);

        $messages = $conversation->messages()
            ->orderBy('created_at', 'asc')
            ->paginate(50);

        return response()->json([
            'conversation' => $conversation,
            'messages' => $messages,
        ]);
    }

    public function storeMessage(Request $request, string $uuid)
    {
        $user = $request->user();
        $conversation = $this->findUserConversation($request, $uuid);

        $data = $request->validate([
            'role' => ['required', 'string', 'in:user,assistant,system'],
            'content' => ['required', 'string'],
            'metadata' => ['nullable', 'array'],
        ]);

        $message = DB::transaction(function () use ($conversation, $user, $data) {
            $message = AiConversationMessage::create([
                'ai_conversation_id' => $conversation->id,
                'user_id' => $user->id,
                'role' => $data['role'],
                'content' => $data['content'],
                'metadata' => $data['metadata'] ?? null,
            ]);

            $updates = [
                'messages_count' => DB::raw('messages_count + 1'),
                'last_message_at' => now(),
            ];

            // أول رسالة user بتصير title للشات
            if (
                $conversation->messages_count === 0 &&
                $data['role'] === 'user' &&
                ($conversation->title === null || $conversation->title === 'New chat')
            ) {
                $cleanTitle = trim(preg_replace('/\s+/', ' ', $data['content']));
                $updates['title'] = Str::limit($cleanTitle, 70, '');
            }

            $conversation->update($updates);

            return $message;
        });

        return response()->json([
            'message' => 'Message saved successfully.',
            'chat_message' => $message,
        ], 201);
    }
    public function update(Request $request, string $uuid)
    {
        $conversation = $this->findUserConversation($request, $uuid);

        $data = $request->validate([
            'title' => ['required', 'string', 'max:120'],
        ]);

        $conversation->update([
            'title' => $data['title'],
        ]);

        return response()->json([
            'message' => 'Conversation updated successfully.',
            'conversation' => $conversation,
        ]);
    }

    public function updateSummary(Request $request, string $uuid)
    {
        $conversation = $this->findUserConversation($request, $uuid);

        $data = $request->validate([
            'summary' => ['nullable', 'string'],
        ]);

        $conversation->update([
            'summary' => $data['summary'] ?? null,
        ]);

        return response()->json([
            'message' => 'Conversation summary updated successfully.',
            'conversation' => $conversation,
        ]);
    }

    public function destroy(Request $request, string $uuid)
    {
        $conversation = $this->findUserConversation($request, $uuid);

        $conversation->delete();

        return response()->json([
            'message' => 'Conversation deleted successfully.',
        ]);
    }

    private function findUserConversation(Request $request, string $uuid): AiConversation
    {
        return AiConversation::where('uuid', $uuid)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();
    }
}
