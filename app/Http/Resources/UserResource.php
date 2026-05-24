<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray($request)
    {
        $isOnline = $this->last_seen_at
            && $this->status === 'active'
            && $this->last_seen_at->greaterThanOrEqualTo(now()->subMinutes(5));

        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'avatar' => $this->getAvatarUrl(),
            'is_admin' => (bool) $this->is_admin,
            'status' => $this->status,
            'email_verified_at' => $this->email_verified_at,
            'is_verified' => $this->isVerified(),
            'last_login_at' => $this->last_login_at,
            'last_seen_at' => $this->last_seen_at,
            'is_online' => (bool) $isOnline,
            'activity_status' => $isOnline ? 'online' : 'offline',
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
