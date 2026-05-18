<x-mail::message>
# Hi {{ $userName }},

Don’t forget to review this PDF:

**{{ $pdfTitle }}**

You should focus especially on this part:

<x-mail::panel>
{{ $focusSource }}
</x-mail::panel>

To make studying easier, open our platform and use the AI tools:

- **Summary** — create a clear summary from your PDF.
- **Generate Quiz** — practice with questions based on the PDF.
- **Ask PDF** — ask questions and get answers directly from the PDF content.
- **Plan of Study** — create an organized study plan so you know what to review first and how to continue.

<x-mail::button :url="config('app.frontend_url', 'http://localhost:5173')">
Open StudyFlow
</x-mail::button>

Keep going — small review sessions make a big difference.

Thanks,  
**StudyFlow Team**
</x-mail::message>