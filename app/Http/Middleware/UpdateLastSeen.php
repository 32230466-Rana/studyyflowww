<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpFoundation\Response;

class UpdateLastSeen
{
    private static ?bool $hasLastSeenColumn = null;

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            return $next($request);
        }

        if (self::$hasLastSeenColumn === null) {
            try {
                self::$hasLastSeenColumn = Schema::hasColumn('users', 'last_seen_at');
            } catch (\Throwable) {
                self::$hasLastSeenColumn = false;
            }
        }

        if (! self::$hasLastSeenColumn) {
            return $next($request);
        }

        $previous = $user->last_seen_at;
        $request->attributes->set('previous_last_seen_at', $previous);

        $cutoff = now()->subMinute();

        if (! $previous || $previous->lt($cutoff)) {
            $user->forceFill([
                'last_seen_at' => now(),
            ])->save();
        }

        return $next($request);
    }
}
