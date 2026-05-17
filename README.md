# StudyFlow

StudyFlow is a Laravel API and React/Vite web platform that helps students upload study materials and use local AI tools to study more effectively. The platform supports document upload, AI summaries, quiz generation, Ask PDF, study plans, and personalized recommendations.

The system uses local AI through Ollama, so the main AI features can run locally without depending on external cloud AI APIs.

## Main Features

- Upload study materials such as PDF and TXT files
- Generate AI summaries from uploaded content
- Choose different summary styles:
  - Bullet points
  - Simple paragraph
  - Detailed explanation
- Ask questions about uploaded PDFs using Ask PDF
- Generate quizzes from uploaded study materials
- Use custom prompts to ask the AI to generate quizzes, explanations, or other study support
- Create study plans to help students organize their learning
- Get study recommendations based on uploaded notes and learning needs
- View uploaded notes and reuse extracted text for future AI features
- Process large documents by splitting them into chunks, summarizing them step by step, and merging the results into a final answer
## Backend Notes
Laravel is used as the main backend API.
Extracted document text is saved in the notes table so it can be reused by summaries, quizzes, Ask PDF, recommendations, and study plans.
The backend uses PDF parsing to extract text from uploaded study materials.
Quiz, chat, summary, recommendation, and study plan features reuse the same extracted note content when possible.
Large files are handled by chunking the text before sending it to the local AI model.
## Frontend Notes
React with Vite is used for the frontend.
The upload form supports study material uploads.
The note details page allows students to view uploaded content and use AI tools.
The interface includes loading states, disabled buttons while AI is running, error messages, and scrollable result panels.
Students can interact with the AI by using built-in buttons or by writing their own prompts.

## AI and Local Model

StudyFlow uses Ollama to run local AI models.

Default local model:

```env
OLLAMA_MODEL=llama3.2:3b
OLLAMA_BASE_URL=http://localhost:11434
