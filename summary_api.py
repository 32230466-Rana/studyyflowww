import os
import fitz  # PyMuPDF
import shutil
import time
import httpx
import re
from fastapi import FastAPI, UploadFile, File

app = FastAPI(title="StudyFlow Fast Summary API")

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
DEFAULT_MODEL = "phi3:mini"

def extract_text_from_pdf(file_path: str) -> str:
    text = ""
    try:
        doc = fitz.open(file_path)
        for page in doc:
            text += page.get_text("text") + "\n"
        doc.close()
    except Exception as e:
        print(f"Extraction error: {e}")
    text = re.sub(r'\s+', ' ', text).strip()
    if len(text) > 15000:
        text = text[:15000]
    return text

@app.post("/summarize")
async def summarize_pdf(file: UploadFile = File(...)):
    start_time = time.time()

    file_path = f"temp_{file.filename}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        text = extract_text_from_pdf(file_path)

        if not text.strip():
            return {
                "success": False,
                "summary": "Could not extract text from the PDF."
            }

        prompt = (
            "You are an expert academic writer. Your task is to summarize the following document.\n\n"
            "RULES:\n"
            "1. You MUST generate ONLY ONE continuous paragraph.\n"
            "2. Ensure exceptional academic quality suitable for a graduation project.\n"
            "3. Focus ONLY on the core concepts, removing any irrelevant noise.\n"
            "4. NEVER use bullet points, lists, headings, or structural formatting.\n"
            "5. The paragraph should be well-structured, coherent, and highly readable.\n\n"
            "DOCUMENT TEXT:\n"
            f"{text}"
        )

        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                OLLAMA_URL,
                json={
                    "model": DEFAULT_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.3,
                        "top_p": 0.9,
                    }
                }
            )
            response.raise_for_status()
            data = response.json()
            summary_text = data.get("response", "").strip()

            summary_text = summary_text.replace("\n", " ")
            summary_text = re.sub(r'\s+', ' ', summary_text).strip()

            end_time = time.time()
            duration = round(end_time - start_time, 2)

            final_summary = f"⏱️ Generated in {duration} seconds. \n\n{summary_text}"

            return {
                "success": True,
                "summary": final_summary
            }

    except Exception as e:
        print(f"Error during summarization: {e}")
        return {
            "success": False,
            "summary": "An error occurred during summarization."
        }
    finally:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass

