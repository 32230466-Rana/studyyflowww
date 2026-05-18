<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class SummaryServiceController extends Controller
{
    public function upload(Request $request)
    {
        set_time_limit(0);
        ini_set('max_execution_time', '0');

        $request->validate([
            'uploaded_file' => ['required', 'file', 'mimes:pdf,txt,text', 'max:51200'],
        ]);

        $file = $request->file('uploaded_file');

        try {
            $response = Http::timeout(1200)
                ->attach(
                    'uploaded_file',
                    file_get_contents($file->getRealPath()),
                    $file->getClientOriginalName()
                )
                ->post(rtrim(config('services.summary_service.url'), '/') . '/file/upload');

            if (!$response->successful()) {
                return response()->json([
                    'message' => 'Summary service failed.',
                    'status' => $response->status(),
                    'error' => $response->body(),
                ], $response->status() >= 400 && $response->status() < 600 ? $response->status() : 500);
            }

            return response()->json($response->json());
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Could not connect to summary service.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function text(Request $request)
    {
        set_time_limit(0);
        ini_set('max_execution_time', '0');

        $request->validate([
            'text' => ['required', 'string', 'min:5'],
        ]);

        try {
            $response = Http::timeout(1200)
                ->post(rtrim(config('services.summary_service.url'), '/') . '/conversation', [
                    'human_input' => $request->input('text'),
                ]);

            if (!$response->successful()) {
                return response()->json([
                    'message' => 'Summary service failed.',
                    'status' => $response->status(),
                    'error' => $response->body(),
                ], $response->status() >= 400 && $response->status() < 600 ? $response->status() : 500);
            }

            return response()->json($response->json());
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Could not connect to summary service.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}
