# Studyflow

Studyflow is a Laravel API plus React/Vite frontend for uploading study material and generating local AI summaries through Ollama.

## AI Summary Flow

- Supported uploads: PDF, TXT
- Local model: `llama3.2:3b`
- Ollama endpoint: `POST http://localhost:11434/api/generate`
- Summary formats: bullet points, simple paragraph, detailed explanation
- Large documents are split into chunks, summarized sequentially, then merged into a final summary

The summarizer is designed to stay grounded in the uploaded text. Prompts explicitly tell the model to avoid inventing information and to keep explanations clear for students.

## Local Configuration

Add these values to your `.env` if you need to override the defaults:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=phi3:mini
OLLAMA_TIMEOUT=600
OLLAMA_CONNECT_TIMEOUT=10
OLLAMA_CHUNK_SIZE=6000
```

## Backend Notes

- Extracted document text is persisted on the `notes` table for reuse by future AI features.
- The backend uses `smalot/pdfparser` for PDF parsing and native Office XML extraction for DOCX and PPTX files.
- `quiz` and `chat` endpoints now reuse the same extracted note content path as summarization.

## Frontend Notes

- Upload form accepts all supported file types.
- Note details page lets the user choose a summary format before generation.
- The UI includes a thinking indicator, disabled actions while AI is running, clear error states, and a scrollable summary panel.

## Verification

The current implementation has been verified with:

```bash
php artisan migrate
php artisan test
cd frontend && npm run lint
cd frontend && npm run build
```
