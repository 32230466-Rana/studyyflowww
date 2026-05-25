<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class AdminMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            Log::warning('Admin access rejected', [
                'reason' => 'unauthenticated',
                'path' => $request->path(),
                'method' => $request->method(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
            ], 401);
        }

        if ((int) $user->is_admin !== 1) {
            Log::warning('Admin access rejected', [
                'reason' => 'not_admin',
                'path' => $request->path(),
                'method' => $request->method(),
                'user_id' => $user->id,
                'email' => $user->email,
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Forbidden. Admins only.',
            ], 403);
        }

        return $next($request);
    }
}
