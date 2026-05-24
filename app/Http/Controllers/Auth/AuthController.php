<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Auth\LoginRequest;
use App\Http\Requests\Api\Auth\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rules\Password;
use App\Mail\LogoutRecommendationMail;
use Illuminate\Support\Facades\Log;
use App\Mail\ReviewReminderMail;
use App\Models\StudyRecommendation;
use App\Services\ActivityLogger;

class AuthController extends Controller
{
    public function register(RegisterRequest $request)
    {
        $data = $request->validated();

        if (User::where('email', $data['email'])->exists()) {
            return ApiResponse::error('Email already registered.', 422);
        }

        $code = $this->generateSixDigitCode();

        // Check if this email should be admin
        $isAdmin = strtolower($data['email']) === strtolower('jeneen.aboulaila@gmail.com');

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => Hash::make($data['password']),
            'verification_code' => $code,
            'reset_code' => null,
            'email_verified_at' => null,
            'is_admin' => $isAdmin,
            'status' => 'active',
        ]);

        $this->sendAuthEmail(
            $user->email,
            'Verify your email',
            "Your verification code is: {$code}"
        );

        return ApiResponse::success([
            'email' => $user->email
        ], 'Verification code sent.', 201);
    }

    public function logout(Request $request)
    {
        $user = $request->user();

        if ($user) {
            $recommendations = StudyRecommendation::where('user_id', $user->id)
                ->where(function ($query) {
                    $query->whereNotNull('slide_number')
                        ->orWhereNotNull('page_number')
                        ->orWhereNotNull('slide_title')
                        ->orWhereNotNull('reason');
                })
                ->latest()
                ->take(5)
                ->get();

            if ($recommendations->isNotEmpty()) {
                Mail::to($user->email)->send(
                    new ReviewReminderMail($user, $recommendations)
                );
            }
        }

        if ($user && method_exists($user, 'currentAccessToken') && $user->currentAccessToken()) {
            $user->currentAccessToken()->delete();
        }

        if ($user) {
            $user->forceFill([
                'last_seen_at' => now()->subMinutes(10),
            ])->save();
        }

        return response()->json([
            'message' => 'Logged out successfully.',
        ]);
    }

    public function verify(Request $request)
    {
        return $this->verifyCode($request);
    }

    public function verifyCode(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'code' => 'required'
        ]);

        $user = User::where('email', $request->email)->first();

        if (!$user) {
            return ApiResponse::error('User not found.', 404);
        }

        if ($user->verification_code !== $request->code) {
            return ApiResponse::error('Invalid code.', 400);
        }

        $user->update([
            'email_verified_at' => now(),
            'verification_code' => null,
        ]);

        return ApiResponse::success(null, 'Email verified.');
    }

    public function resend(Request $request)
    {
        return $this->sendVerificationCode($request);
    }

    public function sendVerificationCode(Request $request)
    {
        $request->validate([
            'email' => 'required|email'
        ]);

        $user = User::where('email', $request->email)->first();

        if (!$user) {
            return ApiResponse::error('User not found.', 404);
        }

        $code = $this->generateSixDigitCode();

        $user->update([
            'verification_code' => $code,
        ]);

        $this->sendAuthEmail(
            $user->email,
            'New Verification Code',
            "Your new code is: {$code}"
        );

        return ApiResponse::success(null, 'New code sent.');
    }

    public function login(LoginRequest $request)
    {
        $data = $request->validated();

        $user = User::where('email', $data['email'])->first();

        if (!$user || !Hash::check($data['password'], $user->password)) {
            return ApiResponse::error('Invalid credentials.', 401);
        }

        if (!$user->email_verified_at) {
            $code = $this->generateSixDigitCode();

            $user->update([
                'verification_code' => $code,
            ]);

            $this->sendAuthEmail(
                $user->email,
                'Verify your email',
                "Your verification code is: {$code}"
            );

            return ApiResponse::error('Verify your email first. A new verification code has been sent.', 403);
        }

        if (($user->status ?? 'active') !== 'active') {
            return ApiResponse::error('Your account is inactive. Please contact an admin.', 403);
        }

        $user->forceFill([
            'last_login_at' => now(),
            'last_seen_at' => now(),
        ])->save();

        ActivityLogger::log(
            $user->id,
            'user_login',
            'User logged in',
            $user->name . ' logged in'
        );

        $token = $user->createToken('api')->plainTextToken;

        return ApiResponse::success([
            'user' => (new UserResource($user->fresh()))->resolve($request),
            'token' => $token,
        ]);
    }

    public function forgotPassword(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
        ]);

        $user = User::where('email', $request->email)->first();

        if (!$user) {
            return ApiResponse::error('User not found.', 404);
        }

        $code = $this->generateSixDigitCode();

        $user->update([
            'reset_code' => $code,
        ]);

        $this->sendAuthEmail(
            $user->email,
            'Reset your password',
            "Your reset code is: {$code}"
        );

        return ApiResponse::success([
            'email' => $user->email,
        ], 'Reset code sent.');
    }

    public function resetPassword(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'code' => 'required',
            'password' => ['required', 'string', 'confirmed', Password::defaults()],
        ]);

        $user = User::where('email', $request->email)->first();

        if (!$user) {
            return ApiResponse::error('User not found.', 404);
        }

        if ($user->reset_code !== $request->code) {
            return ApiResponse::error('Invalid code.', 400);
        }

        $user->update([
            'password' => Hash::make($request->password),
            'reset_code' => null,
        ]);

        return ApiResponse::success(null, 'Password reset successfully.');
    }

    public function me(Request $request)
    {
        $user = $request->user();

        if ($user && ($user->status ?? 'active') !== 'active') {
            $user->currentAccessToken()?->delete();

            return ApiResponse::error('Your account is inactive. Please contact an admin.', 403);
        }

        if ($user) {
            $user->forceFill([
                'last_seen_at' => now(),
            ])->save();
        }

        return response()->json([
            'user' => $user ? (new UserResource($user->fresh()))->resolve($request) : null,
        ]);
    }

    private function generateSixDigitCode(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    private function sendAuthEmail($to, $subject, $body)
    {
        Mail::raw($body, function ($message) use ($to, $subject) {
            $message->to($to)->subject($subject);
        });
    }
}
