<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\Process\Process;

class LinkSummaryController extends Controller
{
    public function summarize(Request $request)
    {
        @set_time_limit(0);
        @ini_set('max_execution_time', '0');
        @ini_set('default_socket_timeout', '1200');

        $validator = Validator::make($request->all(), [
            'url' => ['required', 'url'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Please enter a valid URL.',
                'errors' => $validator->errors(),
            ], 422);
        }

        $url = trim($request->input('url'));

        $python = env(
            'LINK_SUMMARY_PYTHON',
            base_path('.venv/Scripts/python.exe')
        );

        $script = base_path('ai-service/link-summary/local_link_processor.py');

        if (!file_exists($python)) {
            return response()->json([
                'message' => 'Python executable not found.',
                'python' => $python,
            ], 500);
        }

        if (!file_exists($script)) {
            return response()->json([
                'message' => 'Local link processor script not found.',
                'script' => $script,
            ], 500);
        }

        /*
        |--------------------------------------------------------------------------
        | Make Deno visible to the Python process
        |--------------------------------------------------------------------------
        | yt-dlp now needs a JavaScript runtime for some YouTube extraction.
        | Deno is installed in: C:\Users\<user>\.deno\bin
        */

        $userProfile = getenv('USERPROFILE') ?: 'C:\\Users\\obaid';
        $denoBin = $userProfile . '\\.deno\\bin';

        $currentPath = getenv('Path') ?: getenv('PATH') ?: '';

        if (is_dir($denoBin) && stripos($currentPath, $denoBin) === false) {
            $currentPath .= ';' . $denoBin;
        }

        $alwaysTranscribeAudio = filter_var(
            env('LINK_ALWAYS_TRANSCRIBE_AUDIO', false),
            FILTER_VALIDATE_BOOLEAN
        ) ? 'true' : 'false';

        $processEnv = [
            'SystemRoot' => getenv('SystemRoot') ?: 'C:\\Windows',
            'WINDIR' => getenv('WINDIR') ?: 'C:\\Windows',

            // Important: pass Deno path to child process
            'Path' => $currentPath,
            'PATH' => $currentPath,

            'USERPROFILE' => $userProfile,
            'TEMP' => sys_get_temp_dir(),
            'TMP' => sys_get_temp_dir(),

            // Fix Windows encoding/charmap errors
            'PYTHONIOENCODING' => 'utf-8',
            'PYTHONUTF8' => '1',

            // Local Ollama model for link summaries
            'OLLAMA_HOST' => env('OLLAMA_HOST', 'http://127.0.0.1:11434'),
            'OLLAMA_MODEL' => env('LINK_SUMMARY_MODEL', env('OLLAMA_MODEL', 'qwen2.5:1.5b')),
            'LINK_SUMMARY_MODEL' => env('LINK_SUMMARY_MODEL', env('OLLAMA_MODEL', 'qwen2.5:1.5b')),

            // Video transcription settings
            'LINK_WHISPER_MODEL' => env('LINK_WHISPER_MODEL', 'tiny'),
            'LINK_FFMPEG_LOCATION' => env(
                'LINK_FFMPEG_LOCATION',
                'C:\\Users\\User\\Desktop\\ffmpeg_extracted\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe'
            ),
            'GROQ_API_KEY' => env('GROQ_API_KEY', ''),
            'GROQ_WHISPER_MODEL' => env('GROQ_WHISPER_MODEL', 'whisper-large-v3-turbo'),
            'LINK_ALWAYS_TRANSCRIBE_AUDIO' => $alwaysTranscribeAudio,

            // YouTube fix: tell Python/yt-dlp to use Deno
            'LINK_YTDLP_JS_RUNTIME' => env('LINK_YTDLP_JS_RUNTIME', 'deno'),

            // Keep empty unless cookies are really needed
            'LINK_YTDLP_COOKIES_FROM_BROWSER' => env('LINK_YTDLP_COOKIES_FROM_BROWSER', ''),
        ];

        $process = new Process(
            [$python, $script, $url],
            base_path(),
            $processEnv
        );

        $process->setTimeout(1200);
        $process->setIdleTimeout(null);
        $process->run();

        $output = trim($process->getOutput());
        $errorOutput = trim($process->getErrorOutput());

        $data = json_decode($output, true);

        /*
        |--------------------------------------------------------------------------
        | Recover JSON if yt-dlp prints progress before final JSON
        |--------------------------------------------------------------------------
        */
        if (!$data && preg_match('/\{.*\}\s*$/s', $output, $matches)) {
            $data = json_decode($matches[0], true);
        }

        if (!$process->isSuccessful() || !$data || empty($data['success'])) {
            return response()->json([
                'message' => $data['message'] ?? 'Local StudyFlow link summary failed.',
                'error' => $errorOutput,
                'raw_output' => $output,
                'debug' => [
                    'python' => $python,
                    'script' => $script,
                    'url' => $url,
                    'deno_bin' => $denoBin,
                    'deno_bin_exists' => is_dir($denoBin),
                    'link_ytdlp_js_runtime' => $processEnv['LINK_YTDLP_JS_RUNTIME'],
                    'link_ytdlp_cookies_from_browser' => $processEnv['LINK_YTDLP_COOKIES_FROM_BROWSER'],
                    'link_ffmpeg_location' => $processEnv['LINK_FFMPEG_LOCATION'],
                    'groq_key_exists' => !empty($processEnv['GROQ_API_KEY']),
                    'groq_whisper_model' => $processEnv['GROQ_WHISPER_MODEL'],
                    'link_always_transcribe_audio' => $processEnv['LINK_ALWAYS_TRANSCRIBE_AUDIO'],
                ],
            ], 500);
        }

        return response()->json([
            'summary' => $data['summary'],
            'title' => $data['title'] ?? null,
            'transcript' => $data['transcript'] ?? null,
            'transcript_source' => $data['transcript_source'] ?? null,
            'type' => $data['type'] ?? null,
            'url' => $data['url'] ?? $url,
            'processing_time_seconds' => $data['processing_time_seconds'] ?? null,
        ]);
    }
}
