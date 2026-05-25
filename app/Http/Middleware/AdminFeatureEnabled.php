<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class AdminFeatureEnabled
{
    public function handle(Request $request, Closure $next, string $feature): Response
    {
        if (! config("admin_features.{$feature}", true)) {
            Log::warning('Admin feature disabled', [
                'feature' => $feature,
                'path' => $request->path(),
                'method' => $request->method(),
                'user_id' => $request->user()?->id,
            ]);

            return response()->json([
                'success' => false,
                'message' => 'This feature is temporarily disabled.',
            ], 503);
        }

        return $next($request);
    }
}
