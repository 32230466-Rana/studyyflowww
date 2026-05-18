<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StudyRecommendation;
use Illuminate\Http\Request;

class StudyRecommendationController extends Controller
{
    public function store(Request $request)
    {
        $request->validate([
            'recommendations' => ['required', 'array', 'min:1'],
        ]);

        $user = $request->user();

        $saved = [];

        foreach ($request->input('recommendations', []) as $item) {
            if (!is_array($item)) {
                continue;
            }

            $slideNumber = $item['slide_number']
                ?? $item['slide']
                ?? $item['slideNo']
                ?? null;

            $pageNumber = $item['page_number']
                ?? $item['page']
                ?? $item['pageNo']
                ?? null;

            $slideTitle = $item['slide_title']
                ?? $item['title']
                ?? $item['section_title']
                ?? $item['topic']
                ?? null;

            $reason = $item['reason']
                ?? $item['why']
                ?? $item['recommendation']
                ?? $item['message']
                ?? null;

            $pdfTitle = $item['pdf_title']
                ?? $item['pdf_name']
                ?? $item['file_name']
                ?? 'Your uploaded PDF';

            if (!$slideNumber && !$pageNumber && !$slideTitle && !$reason) {
                continue;
            }

            $saved[] = StudyRecommendation::create([
                'user_id' => $user->id,
                'note_id' => $item['note_id'] ?? null,
                'pdf_title' => $pdfTitle,
                'slide_number' => is_numeric($slideNumber) ? (int) $slideNumber : null,
                'page_number' => is_numeric($pageNumber) ? (int) $pageNumber : null,
                'slide_title' => $slideTitle,
                'reason' => $reason,
                'action_url' => $item['action_url'] ?? null,
                'raw_payload' => $item,
            ]);
        }

        return response()->json([
            'message' => 'Recommendations saved successfully.',
            'saved_count' => count($saved),
            'recommendations' => $saved,
        ]);
    }

    public function latest(Request $request)
    {
        $recommendations = StudyRecommendation::where('user_id', $request->user()->id)
            ->latest()
            ->take(5)
            ->get();

        return response()->json([
            'recommendations' => $recommendations,
        ]);
    }
}
