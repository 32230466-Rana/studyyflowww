# 🔧 AI Tutor – Backend

This is the FastAPI-based backend service that:
- Accepts uploaded `.pdf` or `.docx` files
- Extracts text content using PyMuPDF (PDF) or python-docx (DOCX)
- Splits content into chapters by detecting headings (e.g., "Unit", "Chapter")
- Stores documents, chapters, and questions in MySQL via SQLAlchemy
- Generates quizzes and evaluates answers using an OpenAI-compatible LLM

## 🗃️ Project Structure

```
ai-tutor-backend/
├── app/
│   ├── main.py                 # FastAPI entrypoint & API routes
│   ├── models.py               # SQLAlchemy ORM models
│   ├── schemas.py              # Pydantic request/response schemas
│   ├── crud.py                 # Database access logic
│   ├── db.py                   # SQLAlchemy engine & session setup
│   ├── file_utils.py           # File extraction, chapter splitting, hashing
│   ├── llm_utils.py            # LLM prompt construction & JSON parsing
│   ├── vectorize.py            # Text chunking utilities
│   └── aws_utils.py            # S3 upload logic (optional)
├── ddl/                        # SQL scripts to create DB tables & indexes
├── tests/                      # Pytest unit tests
├── .env.example                # Environment variable template
├── requirements.txt
└── Dockerfile
```

## 📦 Setup

```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL, OPENAI_API_KEY, etc.
pip install -r requirements.txt
```

- Run all scripts in `ddl/` against your MySQL instance to create tables and indexes.
- If MySQL runs locally and the backend runs in Docker, set `DB_HOST=host.docker.internal` in `.env`.

```bash
docker network create ai-network
docker-compose up --build
```

## ⚙️ Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | SQLAlchemy connection string, e.g. `mysql+pymysql://user:pass@host/db` |
| `OPENAI_API_KEY` | API key for the LLM provider |
| `OPENAI_BASE_URL` | Optional custom LLM endpoint |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins, e.g. `http://localhost:5173` |
| `UPLOAD_DIR` | Directory for uploaded files (default: `uploads/`) |

## 🧪 Running Tests

```bash
pip install pytest pytest-asyncio httpx
pytest tests/ -v
```

28 unit tests cover `file_utils`, `llm_utils`, and `crud`.

## 📁 Notable Files

- `main.py` – FastAPI endpoints
- `file_utils.py` – File parsing (PDF/DOCX), content-hash deduplication, chapter splitting
- `llm_utils.py` – LLM prompt construction, markdown-fence-aware JSON parsing
- `crud.py` – All database read/write operations
