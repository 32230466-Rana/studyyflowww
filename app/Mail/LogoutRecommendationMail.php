<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Storage;

class LogoutRecommendationMail extends Mailable
{
    use Queueable, SerializesModels;

    public string $userName;
    public string $pdfTitle;
    public string $focusSource;
    public ?string $pdfPath;

    public function __construct(
        string $userName,
        string $pdfTitle,
        string $focusSource,
        ?string $pdfPath = null
    ) {
        $this->userName = $userName;
        $this->pdfTitle = $pdfTitle;
        $this->focusSource = $focusSource;
        $this->pdfPath = $pdfPath;
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Don’t forget to review your PDF on StudyFlow',
        );
    }

    public function content(): Content
    {
        return new Content(
            markdown: 'emails.logout-recommendation',
            with: [
                'userName' => $this->userName,
                'pdfTitle' => $this->pdfTitle,
                'focusSource' => $this->focusSource,
            ],
        );
    }

    public function attachments(): array
    {
        if (!$this->pdfPath) {
            return [];
        }

        if (!Storage::disk('public')->exists($this->pdfPath)) {
            return [];
        }

        return [
            Attachment::fromStorageDisk('public', $this->pdfPath)
                ->as($this->pdfTitle . '.pdf')
                ->withMime('application/pdf'),
        ];
    }
}
