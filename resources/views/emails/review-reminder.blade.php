<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class ReviewReminderMail extends Mailable
{
    use Queueable, SerializesModels;

    public $user;
    public $recommendations;

    public function __construct($user, $recommendations)
    {
        $this->user = $user;
        $this->recommendations = $recommendations;
    }

    public function build()
    {
        return $this
            ->subject("Don't forget to review your PDF")
            ->view('emails.review-reminder');
    }
}