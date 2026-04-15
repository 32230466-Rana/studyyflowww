<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use thiagoalessio\TesseractOCR\TesseractOCR;

class OCRController extends Controller
{
    public function readPdf(Request $request)
    {
        $pdf = storage_path('app/file.pdf');

        if (!file_exists($pdf)) {
            return response()->json([
                'success' => false,
                'message' => 'PDF file not found.',
            ], 404);
        }

        $poppler = "C:\\Users\\obaid\\Downloads\\Release-25.12.0-0\\poppler-25.12.0\\Library\\bin\\pdftoppm.exe";
        $tesseract = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";

        if (!file_exists($poppler)) {
            return response()->json([
                'success' => false,
                'message' => 'Poppler executable not found.',
            ], 500);
        }

        if (!file_exists($tesseract)) {
            return response()->json([
                'success' => false,
                'message' => 'Tesseract executable not found.',
            ], 500);
        }

        $tempDir = storage_path('app/ocr_pages_' . uniqid());

        if (!is_dir($tempDir)) {
            mkdir($tempDir, 0777, true);
        }

        $outputPrefix = $tempDir . DIRECTORY_SEPARATOR . 'page';

        $command = "\"{$poppler}\" -png -r 220 \"{$pdf}\" \"{$outputPrefix}\"";
        exec($command, $out, $code);

        if ($code !== 0) {
            $this->cleanupDirectory($tempDir);

            return response()->json([
                'success' => false,
                'message' => 'Failed to convert PDF pages to images.',
            ], 500);
        }

        $images = glob($tempDir . DIRECTORY_SEPARATOR . 'page-*.png');
        natsort($images);
        $images = array_values($images);

        if (empty($images)) {
            $this->cleanupDirectory($tempDir);

            return response()->json([
                'success' => false,
                'message' => 'No images were generated from PDF.',
            ], 500);
        }

        $allText = [];

        foreach ($images as $image) {
            if (!file_exists($image)) {
                continue;
            }

            $text = (new TesseractOCR($image))
                ->executable($tesseract)
                ->lang('eng')
                ->psm(6)
                ->oem(1)
                ->run();

            $cleaned = $this->cleanOcrText($text);

            if (!empty($cleaned)) {
                $allText[] = $cleaned;
            }
        }

        $this->cleanupDirectory($tempDir);

        $finalText = trim(implode("\n\n", $allText));

        if ($finalText === '') {
            return response()->json([
                'success' => false,
                'message' => 'OCR returned empty text.',
            ], 422);
        }

        return response()->json([
            'success' => true,
            'text' => $finalText,
        ]);
    }

    private function cleanOcrText(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $text = str_replace(["ﬁ", "ﬂ"], ["fi", "fl"], $text);
        $text = preg_replace('/[ \t]+/', ' ', $text);
        $text = preg_replace('/[^\S\n]+/', ' ', $text);

        $lines = explode("\n", $text);
        $cleaned = [];

        foreach ($lines as $line) {
            $line = trim($line);

            if ($line === '') {
                continue;
            }

            if (mb_strlen($line) < 3) {
                continue;
            }

            if (preg_match('/^\d+$/', $line)) {
                continue;
            }

            if (preg_match('/^[^A-Za-z0-9]+$/', $line)) {
                continue;
            }

            if (preg_match('/^(page|slide|chapter|week|lecture)\b/i', $line)) {
                continue;
            }

            if (preg_match('/^(school of|department of|faculty of)\b/i', $line)) {
                continue;
            }

            $alphaCount = preg_match_all('/[A-Za-z]/', $line);
            $digitCount = preg_match_all('/\d/', $line);

            if ($alphaCount === 0 && $digitCount > 3) {
                continue;
            }

            $line = preg_replace('/\s+([,.;:!?])/', '$1', $line);
            $cleaned[] = $line;
        }

        return trim(implode("\n", $cleaned));
    }

    private function cleanupDirectory(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }

        $files = glob($dir . DIRECTORY_SEPARATOR . '*');

        if ($files) {
            foreach ($files as $file) {
                if (is_file($file)) {
                    @unlink($file);
                }
            }
        }

        @rmdir($dir);
    }
}
