# ==============================================================================
# 0. INSTALLS (Colab only - comment out for local use)
# ==============================================================================
# Uncomment the following lines if running in Google Colab or hosted environment:
# !curl -fsSL https://ollama.com/install.sh | sh
# !pip install fastapi uvicorn pyngrok requests boto3 python-multipart aiofiles langchain langchain-community chromadb sentence-transformers PyMuPDF langchain-huggingface langchain-chroma langchain-ollama langchain-experimental flashrank pydantic python-dotenv

# ==============================================================================
# 1. IMPORTS
# ==============================================================================
import os
import gc
import re
import sys
import json
import time
import fitz
import psutil
import base64
import random
import socket
import signal
import asyncio
import tempfile
import threading
import subprocess
from uuid import uuid4
from pathlib import Path
from typing import List, Dict, Any, Tuple

os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")

import logging
logging.getLogger("chromadb.telemetry.product.posthog").setLevel(logging.CRITICAL)

import requests
from dotenv import load_dotenv
from contextlib import asynccontextmanager

# --- FastAPI & Server ---
from fastapi import FastAPI, UploadFile, Request, HTTPException
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from pyngrok import ngrok

# --- LangChain Core ---
from langchain.docstore.document import Document
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import FlashrankRerank
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_experimental.text_splitter import SemanticChunker
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_ollama.llms import OllamaLLM
from pydantic import BaseModel, Field
from chromadb.config import Settings

# --- Colab Support ---
try:
    from google.colab import userdata
    IN_COLAB = True
except ImportError:
    IN_COLAB = False

# ==============================================================================
# 2. CONFIGURATION
# ==============================================================================
print("Loading configuration...")
load_dotenv()

if IN_COLAB:
    try:
        NGROK_AUTHTOKEN = "32eB7tLSQoICKJD4JSQuJ9lWea6_7U5ndjtQCVaWnPLEc4Mws"
        PROGRESS_SERVICE_URL = os.environ.get(
            "PROGRESS_SERVICE_URL",
            "https://localdocu-progress.vercel.app"
        )
    except Exception:
        print("WARNING: Could not load from Colab secrets, falling back to environment variables.")
        NGROK_AUTHTOKEN = "32eB7tLSQoICKJD4JSQuJ9lWea6_7U5ndjtQCVaWnPLEc4Mws"
        PROGRESS_SERVICE_URL = os.environ.get(
            "PROGRESS_SERVICE_URL",
            "https://localdocu-progress.vercel.app"
        )
else:
    NGROK_AUTHTOKEN = "32eB7tLSQoICKJD4JSQuJ9lWea6_7U5ndjtQCVaWnPLEc4Mws"
    PROGRESS_SERVICE_URL = os.environ.get(
        "PROGRESS_SERVICE_URL",
        "https://localdocu-progress.vercel.app"
    )

if not NGROK_AUTHTOKEN or NGROK_AUTHTOKEN == "YOUR_NGROK_AUTHTOKEN":
    print("WARNING: NGROK_AUTHTOKEN not configured properly. Set it in .env file.")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "phi3:mini")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
VISION_FEATURES_ENABLED = False
FAST_MODE = True
ENABLE_LLM_INGEST_SUMMARY = os.environ.get(
    "ENABLE_LLM_INGEST_SUMMARY",
    "0" if FAST_MODE else "1"
).strip().lower() in {"1", "true", "yes", "on"}
FAST_CHUNK_SIZE = int(os.environ.get("FAST_CHUNK_SIZE", "900"))
FAST_CHUNK_OVERLAP = int(os.environ.get("FAST_CHUNK_OVERLAP", "120"))

# --- Persistent Storage Paths ---
PERSIST_BASE = os.path.abspath("./chroma_store")
SUMMARY_STORE_PATH = os.path.join(PERSIST_BASE, "summary_store")
DETAILED_STORE_PATH = os.path.join(PERSIST_BASE, "detailed_store")
IMAGE_STORE = os.path.abspath("./image_store")

os.makedirs(SUMMARY_STORE_PATH, exist_ok=True)
os.makedirs(DETAILED_STORE_PATH, exist_ok=True)
os.makedirs(IMAGE_STORE, exist_ok=True)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}

# Smaller rerank load for local 8GB usage
GLOBAL_RERANKER = FlashrankRerank(top_n=3)

EMBEDDINGS_MODEL = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")


def post_progress(document_id: str, status: str, progress: int = 0, **kwargs):
    """Post progress update to progress tracking service."""
    try:
        payload = {"documentId": document_id, "status": status, "progress": progress, **kwargs}
        threading.Thread(
            target=lambda: requests.post(
                f"{PROGRESS_SERVICE_URL}/progress",
                json=payload,
                timeout=10
            ),
            daemon=True
        ).start()
    except Exception:
        pass


def safe_metadata_value(value):
    """Ensure metadata values are primitive for Chroma."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    try:
        if isinstance(value, (list, dict)):
            return json.dumps(value)
    except Exception:
        pass
    try:
        return str(value)
    except Exception:
        return None


def sanitize_metadata(metadata: dict) -> dict:
    """Return sanitized metadata safe for Chroma."""
    if not isinstance(metadata, dict):
        return {}
    sanitized = {}
    for k, v in metadata.items():
        try:
            sanitized[k] = safe_metadata_value(v)
        except Exception:
            sanitized[k] = None
    return sanitized


def is_image_file(filename: str) -> bool:
    try:
        return Path(filename).suffix.lower() in IMAGE_EXTENSIONS
    except Exception:
        return False


def get_public_url() -> str:
    if os.environ.get("PUBLIC_URL"):
        return os.environ.get("PUBLIC_URL")
    return globals().get("public_url", "http://localhost:8000")


# ==============================================================================
# 3. OPTIONAL MODELS
# ==============================================================================

class Reference(BaseModel):
    id: str = Field(..., description="Citation ID like 1 or 2")
    title: str = Field(..., description="Title of source")
    source: str = Field(..., description="Filename or source")
    page: int = Field(default=0, description="Page number")
    snippet: str = Field(default="", description="Snippet from source")


class AIAnswer(BaseModel):
    answer: str = Field(..., description="Answer text")
    references: List[Reference] = Field(default_factory=list, description="Reference list")


# ==============================================================================
# 4. SYSTEM & OLLAMA UTILS
# ==============================================================================

def stream_logs(proc, name):
    for line in iter(proc.stdout.readline, b''):
        sys.stdout.write(f"[{name}] {line.decode(errors='ignore')}")
        sys.stdout.flush()
    for line in iter(proc.stderr.readline, b''):
        sys.stdout.write(f"[{name}-ERR] {line.decode(errors='ignore')}")
        sys.stdout.flush()


def start_ollama_service():
    try:
        if requests.get(OLLAMA_URL, timeout=2).status_code == 200:
            print("Ollama is already running locally!\n")
            return True
    except Exception:
        pass

    ollama_proc = subprocess.Popen(
        ["ollama", "serve"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    threading.Thread(target=stream_logs, args=(ollama_proc, "Ollama"), daemon=True).start()

    print("Starting Ollama service...")
    for _ in range(40):
        try:
            if requests.get(OLLAMA_URL, timeout=2).status_code == 200:
                print("Ollama is running locally!\n")
                return True
        except Exception:
            time.sleep(2)

    raise RuntimeError("Ollama failed to start in time.")


def generate_image_summary(image_path: str, model: str = None) -> str:
    """Generate a detailed description of an image using a vision model."""
    if not VISION_FEATURES_ENABLED:
        return "Image summary unavailable: vision model is disabled."

    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode()

    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": model or OLLAMA_MODEL,
                "prompt": "Describe this image in detail, including text, objects, colors, and context.",
                "images": [image_data],
                "stream": False
            },
            timeout=120
        )
        if response.status_code == 200:
            return response.json().get("response", "No description available")
        return f"Error generating summary: {response.status_code}"
    except Exception as e:
        return f"Error: {str(e)}"


def fast_chunk_summary(text: str, max_chars: int = 240) -> str:
    if not text:
        return ""
    compact = " ".join(text.split())
    return compact[:max_chars]


def clean_summary_text(text: str, max_words: int = 140) -> str:
    if not text:
        return ""

    cleaned = str(text).strip()
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(Summary|Answer)\s*:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    words = cleaned.split(" ")
    if len(words) > max_words:
        cleaned = " ".join(words[:max_words]).rstrip(".,;:") + "..."

    return cleaned




def get_llm(model_name: str):
    
    return OllamaLLM(
        model=model_name,
        temperature=0.1
    )


def generate_with_llm(prompt: str, model_name: str):
    """
    Unified text generation function for simpler prompts.
    """
    llm = OllamaLLM(
        model=model_name,
        temperature=0.1
    )
    resp = llm.invoke(prompt)
    return getattr(resp, "content", str(resp))


def _format_chunks_for_prompt(chunks: List[Document]) -> str:
    
    context_strings = []

    for i, chunk in enumerate(chunks, start=1):
        metadata = chunk.metadata if hasattr(chunk, "metadata") and isinstance(chunk.metadata, dict) else {}
        source = metadata.get("source", "Unknown")
        title = metadata.get("title", Path(str(source)).name if source else f"Chunk {i}")
        page = metadata.get("page", metadata.get("page_number", "N/A"))

        context_strings.append(
            f"[Source {i}]\n"
            f"Title: {title}\n"
            f"Source: {source}\n"
            f"Page: {page}\n"
            f"Content:\n{chunk.page_content}"
        )

    return "\n\n".join(context_strings)


def build_advanced_rag_prompt(question: str, context: str) -> str:

    return f"""
You are a helpful AI assistant.

Answer the question using ONLY the provided context.

Rules:
- Be clear and direct.
- Do not invent information.
- If the answer is not present in the context, say:
  "I could not find the answer in the provided documents."
- Prefer a useful paragraph or short structured answer.
- If possible, mention supporting sources using [1], [2], [3].

Question:
{question}

Context:
{context}

Answer:
""".strip()


# ==============================================================================
# 6. CORE: HIERARCHICAL RAG SERVICE
# ==============================================================================

class HierarchicalRAGService:
    """
    Manages the hierarchical vector stores and core RAG logic.
    """

    def __init__(self, summary_path, detailed_path, embeddings):
        self.embeddings = embeddings
        self.chroma_settings = Settings(
            anonymized_telemetry=False,
            is_persistent=True,
        )

        self.summary_store = Chroma(
            collection_name="summary_store",
            embedding_function=self.embeddings,
            persist_directory=summary_path,
            client_settings=self.chroma_settings,
        )

        self.detailed_store = Chroma(
            collection_name="detailed_store",
            embedding_function=self.embeddings,
            persist_directory=detailed_path,
            client_settings=self.chroma_settings,
        )

    def _load_and_split_pdf(self, pdf_bytes: bytes) -> List[Document]:
        print("[PDF] Creating temporary PDF file...")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(pdf_bytes)
            path = tmp.name

        print("[PDF] Loading PDF with PyMuPDF...")
        docs = PyMuPDFLoader(path).load()
        print(f"[PDF] Loaded {len(docs)} pages from PDF")

        if not docs:
            print("[PDF] No documents loaded from PDF")
            os.remove(path)
            return []

        images_per_page = {}

        if VISION_FEATURES_ENABLED:
            print("[PDF] Extracting images from PDF...")
            pdf = fitz.open(path)

            for page_num in range(len(pdf)):
                page = pdf[page_num]
                images = page.get_images(full=True)
                page_images = []

                for img_index, img in enumerate(images):
                    xref = img[0]
                    try:
                        base_image = pdf.extract_image(xref)
                        image_bytes = base_image["image"]
                        image_ext = base_image["ext"]
                        img_id = f"img_{uuid4().hex}"
                        image_filename = f"{img_id}.{image_ext}"
                        image_path = os.path.join(IMAGE_STORE, image_filename)

                        with open(image_path, "wb") as f:
                            f.write(image_bytes)

                        summary = generate_image_summary(image_path)

                        page_images.append({
                            "id": img_id,
                            "summary": summary,
                            "page": page_num + 1,
                            "ext": image_ext
                        })

                        print(f"[PDF] Extracted and summarized image {img_id} from page {page_num + 1}")
                    except Exception as e:
                        print(f"[PDF] Failed to extract image {img_index} from page {page_num + 1}: {e}")

                images_per_page[page_num] = page_images

            pdf.close()
        else:
            print("[PDF] Vision disabled: skipping image extraction for faster ingestion")
            for page_num in range(len(docs)):
                images_per_page[page_num] = []

        os.remove(path)
        print(f"[PDF] Completed image extraction, found images on {len([p for p in images_per_page.values() if p])} pages")

        print("[PDF] Assigning images to documents...")
        new_docs = []
        for doc in docs:
            page_num = getattr(doc, "metadata", {}).get("page", 0) if hasattr(doc, "metadata") else 0
            images = images_per_page.get(page_num, [])

            if not isinstance(doc, Document):
                doc = Document(page_content=str(doc), metadata={})

            if not hasattr(doc, "metadata") or not isinstance(doc.metadata, dict):
                doc.metadata = {}

            doc.metadata["images"] = images
            doc.metadata["page"] = page_num + 1
            new_docs.append(doc)

        if FAST_MODE:
            print("[PDF] FAST_MODE enabled: splitting documents with lightweight chunker...")
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=FAST_CHUNK_SIZE,
                chunk_overlap=FAST_CHUNK_OVERLAP,
                separators=["\n\n", "\n", ". ", " ", ""]
            )
            chunks = splitter.split_documents(new_docs)
            print(f"[PDF] Split into {len(chunks)} fast chunks")
        else:
            print("[PDF] Splitting documents into semantic chunks...")
            splitter = SemanticChunker(
                self.embeddings,
                breakpoint_threshold_type="percentile"
            )
            chunks = splitter.split_documents(new_docs)
            print(f"[PDF] Split into {len(chunks)} semantic chunks")

        safe_chunks = []
        for c in chunks:
            if isinstance(c, Document):
                safe_chunks.append(c)
            else:
                safe_chunks.append(Document(page_content=str(c), metadata={}))

        print(f"[PDF] Final chunk count: {len(safe_chunks)}")
        return safe_chunks

    async def _generate_summary_for_ingestion(self, chunks: List[Document], model_name: str) -> str:
        print(f"[SUMMARY] Starting summary generation for {len(chunks)} chunks")

        if not chunks:
            print("[SUMMARY] No chunks provided for summary")
            return "No text content found."

        intermediate_summaries = [
            chunk.metadata.get("summary", "")
            for chunk in chunks
            if hasattr(chunk, "metadata") and isinstance(chunk.metadata, dict)
        ]

        if not intermediate_summaries:
            return "No summary content generated."

        print(f"[SUMMARY] Synthesizing {len(intermediate_summaries)} intermediate summaries...")
        combined_summaries = "\n".join(intermediate_summaries[:12 if FAST_MODE else 30])

        if not ENABLE_LLM_INGEST_SUMMARY:
            quick_summary = clean_summary_text(" ".join(intermediate_summaries[:6]), max_words=110)
            return quick_summary or "No summary content generated."

        synthesis_prompt = (
            "You are an expert document summarizer.\n"
            "Write a high-quality summary in clear English.\n"
            "Constraints:\n"
            "- 4 to 6 sentences\n"
            "- Under 120 words\n"
            "- Focus on main topic, key findings/events, and why they matter\n"
            "- No bullet points, no headings, no source labels like [1]\n"
            "- Do not add facts not present in the text\n\n"
            "Chunk summaries:\n"
            f"{combined_summaries}\n\n"
            "Summary:"
        )

        final_summary_raw = await asyncio.to_thread(
            generate_with_llm,
            synthesis_prompt,
            model_name
        )
        final_summary = clean_summary_text(final_summary_raw)
        if not final_summary:
            final_summary = " ".join(intermediate_summaries[:3]).strip()
        print(f"[SUMMARY] Final summary generated: {len(final_summary)} characters")
        return final_summary

    async def add_document_to_stores(self, pdf_bytes: bytes, doc_id: str, model_name: str):
        print(f"[RAG] Starting document ingestion for doc_id: {doc_id}")
        post_progress(doc_id, "loading", 5, message="Loading PDF...")

        print("[RAG] Loading and splitting PDF...")
        chunks = self._load_and_split_pdf(pdf_bytes)
        print(f"[RAG] Split into {len(chunks)} chunks")

        try:
            print(f"[RAG] Chunk diagnostics: {len(chunks)} total chunks")
            for i, c in enumerate(chunks[:3]):
                print(f"[RAG] Chunk {i}: type={type(c)}, has_metadata={hasattr(c, 'metadata')}")
        except Exception as e:
            print(f"[RAG] Could not inspect chunks: {e}")

        if not chunks:
            print("[RAG] No text content found in document")
            post_progress(doc_id, "failed", 0, message="No text content found")
            raise ValueError("No text content found in the document")

        post_progress(
            doc_id,
            "chunking",
            20,
            message=f"Split into {len(chunks)} chunks",
            totalChunks=len(chunks)
        )

        print("[RAG] Generating fast chunk summaries...")
        post_progress(
            doc_id,
            "summarizing_chunks",
            30,
            message="Generating chunk summaries...",
            totalChunks=len(chunks)
        )

        for i, chunk in enumerate(chunks):
            if not hasattr(chunk, "metadata") or not isinstance(chunk.metadata, dict):
                chunk.metadata = {}
            chunk.metadata["summary"] = fast_chunk_summary(chunk.page_content)

            if (i + 1) % 50 == 0 or i == len(chunks) - 1:
                print(f"[SUMMARY] Fast summaries prepared: {i + 1}/{len(chunks)}")

        if chunks and hasattr(chunks[0], "metadata") and isinstance(chunks[0].metadata, dict):
            source_filename = chunks[0].metadata.get("source", f"doc_{doc_id}")
        else:
            print("[RAG] First chunk missing metadata, using fallback source filename")
            source_filename = f"doc_{doc_id}"

        print("[RAG] Generating document summary...")
        post_progress(
            doc_id,
            "summarizing",
            40,
            message="Generating document summary...",
            totalChunks=len(chunks)
        )

        summary_text = await self._generate_summary_for_ingestion(chunks, model_name)
        print(f"[RAG] Summary generated: {len(summary_text)} characters")

        print("[RAG] Creating summary embeddings...")
        post_progress(
            doc_id,
            "embedding_summary",
            60,
            message="Creating summary embeddings...",
            totalChunks=len(chunks)
        )

        summary_doc = Document(
            page_content=summary_text,
            metadata={
                "doc_id": doc_id,
                "source": source_filename,
                "title": f"Summary for {Path(str(source_filename)).name}"
            }
        )
        self.summary_store.add_documents([summary_doc], ids=[doc_id])
        print("[RAG] Summary embeddings created and stored")

        print("[RAG] Creating chunk embeddings...")
        post_progress(
            doc_id,
            "embedding_chunks",
            75,
            message="Creating chunk embeddings...",
            totalChunks=len(chunks)
        )

        current_index = 0
        for i in range(0, len(chunks), 5):
            batch = chunks[i:i + 5]
            print(f"[RAG] Processing batch {i // 5 + 1}/{(len(chunks) + 4) // 5}")

            for chunk in batch:
                if not isinstance(chunk, Document):
                    print(f"[RAG] Converting non-Document chunk at index {current_index}")
                    chunk = Document(page_content=str(chunk), metadata={})
                    chunks[current_index] = chunk

                if not hasattr(chunk, "metadata") or not isinstance(chunk.metadata, dict):
                    chunk.metadata = {}

                chunk.metadata["doc_id"] = doc_id
                chunk.metadata["title"] = f"{Path(str(source_filename)).name} (Page {chunk.metadata.get('page', current_index + 1)})"

                try:
                    chunk.metadata = sanitize_metadata(chunk.metadata)
                except Exception as e:
                    print(f"[RAG] sanitize_metadata failed for chunk {current_index}: {e}")

                current_index += 1

            progress = 75 + int(current_index / len(chunks) * 20)
            post_progress(
                doc_id,
                "embedding_chunks",
                progress,
                message=f"Embedding chunk {current_index}/{len(chunks)}...",
                currentChunk=current_index,
                totalChunks=len(chunks)
            )

        print("[RAG] Final metadata sanitization...")
        for i, ch in enumerate(chunks):
            if not hasattr(ch, "metadata") or not isinstance(ch.metadata, dict):
                ch.metadata = {}
            try:
                ch.metadata = sanitize_metadata(ch.metadata)
            except Exception as e:
                print(f"[RAG] Final sanitize_metadata failed for chunk {i}: {e}")
                ch.metadata = {}

        print("[RAG] Adding chunks to detailed store...")
        chunk_ids = [f"{doc_id}_{i}" for i in range(len(chunks))]

        try:
            self.detailed_store.add_documents(chunks, ids=chunk_ids)
            print(f"[RAG] Successfully added {len(chunks)} chunks to detailed store")
        except Exception as e:
            print(f"[RAG] Failed to add documents to detailed_store: {e}")
            post_progress(doc_id, "failed", 0, message=f"Failed to add documents: {e}")
            raise

        print(f"[RAG] Document processing complete! {len(chunks)} chunks processed")
        post_progress(
            doc_id,
            "complete",
            100,
            message="Document processing complete!",
            totalChunks=len(chunks)
        )
        return len(chunks)

    def get_chunks_by_doc_id(self, doc_id: str) -> List[Document]:
        results = self.detailed_store.get(
            where={"doc_id": doc_id},
            include=["metadatas", "documents"]
        )

        if not results.get("documents") or not results.get("metadatas"):
            return []

        docs = []
        for i, text in enumerate(results["documents"]):
            if i >= len(results["metadatas"]):
                continue

            meta = results["metadatas"][i]

            try:
                if isinstance(text, str) and isinstance(meta, dict):
                    docs.append(
                        Document(
                            page_content=text,
                            metadata=sanitize_metadata(meta)
                        )
                    )
            except Exception as e:
                print(f"Error creating document {i}: {e}")
                continue

        return docs

    async def query_rag(
        self,
        document_ids: List[str],
        question: str,
        model_name: str,
        top_k: int = 3,
        specific_chunks: Dict[str, List[int]] = None
    ) -> Tuple[str, List[Dict[str, Any]]]:
       

        summary_retriever = self.summary_store.as_retriever(
            search_kwargs={
                "k": 6 if FAST_MODE else 10,
                "filter": {"doc_id": {"$in": document_ids}}
            }
        )

        if FAST_MODE:
            relevant_summaries = summary_retriever.invoke(question)
        else:
            summary_compressor = ContextualCompressionRetriever(
                base_compressor=GLOBAL_RERANKER,
                base_retriever=summary_retriever
            )
            relevant_summaries = summary_compressor.invoke(question)

        relevant_doc_ids = []
        for doc in relevant_summaries:
            if hasattr(doc, "metadata") and isinstance(doc.metadata, dict) and "doc_id" in doc.metadata:
                relevant_doc_ids.append(doc.metadata["doc_id"])

        relevant_doc_ids = list(set(relevant_doc_ids))

        if not relevant_doc_ids:
            return "No relevant documents found.", []

        if specific_chunks:
            relevant_chunks = []
            for doc_id in relevant_doc_ids:
                if doc_id in specific_chunks:
                    all_chunks = self.get_chunks_by_doc_id(doc_id)
                    selected_indices = specific_chunks[doc_id]
                    for idx in selected_indices:
                        if 0 <= idx < len(all_chunks):
                            relevant_chunks.append(all_chunks[idx])
        else:
            detailed_retriever = self.detailed_store.as_retriever(
                search_kwargs={
                    "k": (6 if FAST_MODE else 12),
                    "filter": {"doc_id": {"$in": relevant_doc_ids}}
                }
            )

            if FAST_MODE:
                relevant_chunks = detailed_retriever.invoke(question)
            else:
                chunk_compressor = ContextualCompressionRetriever(
                    base_compressor=FlashrankRerank(top_n=top_k),
                    base_retriever=detailed_retriever
                )
                relevant_chunks = chunk_compressor.invoke(question)

            if FAST_MODE and len(relevant_chunks) > top_k:
                relevant_chunks = relevant_chunks[:top_k]

            for i, rc in enumerate(relevant_chunks):
                if not isinstance(rc, Document):
                    relevant_chunks[i] = Document(page_content=str(rc), metadata={})

        if not relevant_chunks:
            return "No relevant chunks found.", []

        context_string = _format_chunks_for_prompt(relevant_chunks[:3])
        final_prompt = build_advanced_rag_prompt(question, context_string)

        llm_name_for_rag = model_name or OLLAMA_MODEL

        try:
            llm = get_llm(llm_name_for_rag)
            raw_response = await asyncio.to_thread(llm.invoke, final_prompt)
            response_text = getattr(raw_response, "content", str(raw_response)).strip()

            citations = []
            for i, chunk in enumerate(relevant_chunks[:3], start=1):
                metadata = chunk.metadata if hasattr(chunk, "metadata") and isinstance(chunk.metadata, dict) else {}
                citations.append({
                    "documentId": str(metadata.get("source", "")),
                    "page": metadata.get("page", 0),
                    "snippet": chunk.page_content[:200],
                    "fullText": chunk.page_content,
                    "source": metadata.get("title", f"Source {i}"),
                    "rank": i,
                    "score": None
                })

            return response_text, citations

        except Exception as e:
            print(f"[RAG] Primary generation failed: {e}")

            simple_context = "\n\n".join([c.page_content for c in relevant_chunks[:3]])
            simple_prompt = f"""
Answer the question using only this context.

Question:
{question}

Context:
{simple_context}

Answer:
""".strip()

            fallback_answer = await asyncio.to_thread(
                generate_with_llm,
                simple_prompt,
                llm_name_for_rag
            )
            return fallback_answer, []


# ==============================================================================
# 7. FASTAPI APP & ENDPOINTS
# ==============================================================================
print("Starting FastAPI app...")

rag_service = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global rag_service
    try:
        rag_service = HierarchicalRAGService(
            summary_path=SUMMARY_STORE_PATH,
            detailed_path=DETAILED_STORE_PATH,
            embeddings=EMBEDDINGS_MODEL
        )
    except Exception as e:
        print(f"FATAL: Could not initialize RAG Service: {e}")
        rag_service = None
    yield


app = FastAPI(
    title="Hierarchical RAG API tuned for phi3:mini",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "healthy", "message": "Backend is running"}


@app.post("/process")
async def process(file: UploadFile):
    print("[PROCESS] Starting document processing...")

    if rag_service is None:
        raise HTTPException(status_code=500, detail="RAG Service is not operational.")

    filename = (file.filename or "").strip()
    print(f"[PROCESS] Received file: {filename}")

    if not filename:
        raise HTTPException(status_code=400, detail="File name is missing")

    extension = Path(filename).suffix.lower()
    allowed_image_extensions = {ext.lower() for ext in IMAGE_EXTENSIONS}

    if extension not in allowed_image_extensions and extension != ".pdf":
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{extension or 'unknown'}'. Only PDF and images are allowed."
        )

    if is_image_file(filename):
        print("[PROCESS] Detected image file")
        doc_id = f"img_{uuid4().hex}"
        image_path = os.path.join(IMAGE_STORE, f"{doc_id}{Path(filename).suffix}")

        image_bytes = await file.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Uploaded image is empty")

        with open(image_path, "wb") as f:
            f.write(image_bytes)

        print(f"[PROCESS] Image saved: {image_path}")
        return {
            "documentId": doc_id,
            "status": "image_saved",
            "isImage": True,
            "imagePath": image_path
        }

    print("[PROCESS] Processing as PDF document")
    doc_id = f"doc_{uuid4().hex}"

    try:
        pdf_bytes = await file.read()
        print(f"[PROCESS] Read {len(pdf_bytes)} bytes")

        if not pdf_bytes:
            raise HTTPException(status_code=400, detail="Uploaded PDF is empty")

        if b"%PDF" not in pdf_bytes[:1024]:
            raise HTTPException(status_code=400, detail="Invalid PDF file format")

        chunk_count = await rag_service.add_document_to_stores(
            pdf_bytes,
            doc_id,
            OLLAMA_MODEL
        )

        print(f"[PROCESS] Successfully processed document with {chunk_count} chunks")
        return {
            "documentId": doc_id,
            "status": "embeddings_created",
            "chunkCount": chunk_count,
            "isImage": False
        }

    except HTTPException:
        raise
    except (ValueError, fitz.FileDataError) as e:
        print(f"[PROCESS] Invalid document input: {e}")
        return JSONResponse(
            status_code=400,
            content={"error": "Invalid document", "message": str(e)}
        )
    except Exception as e:
        print(f"[PROCESS] Error processing document: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to process document", "message": str(e)}
        )


@app.post("/get_chunks")
async def get_chunks(request: Request):
    if rag_service is None:
        raise HTTPException(status_code=500, detail="RAG Service is not operational.")

    data = await request.json()
    document_id = data.get("documentId")

    if not document_id:
        raise HTTPException(status_code=400, detail="documentId is required")

    chunks = rag_service.get_chunks_by_doc_id(document_id)

    if not chunks:
        raise HTTPException(status_code=404, detail=f"No chunks found for documentId {document_id}")

    def _parse_images_field(md):
        try:
            if not md:
                return []

            imgs = md.get("images")
            if imgs is None:
                return []

            if isinstance(imgs, str):
                try:
                    parsed = json.loads(imgs)
                    return parsed if isinstance(parsed, list) else [parsed]
                except Exception:
                    return []

            if isinstance(imgs, list):
                return imgs

            return []
        except Exception:
            return []

    return JSONResponse(content={
        "documentId": document_id,
        "chunks": [
            {
                "id": i,
                "content": chunk.page_content,
                "summary": chunk.metadata.get("summary", "") if hasattr(chunk, "metadata") and isinstance(chunk.metadata, dict) else "",
                "metadata": chunk.metadata if hasattr(chunk, "metadata") and isinstance(chunk.metadata, dict) else {},
                "images": _parse_images_field(chunk.metadata if hasattr(chunk, "metadata") and isinstance(chunk.metadata, dict) else {})
            }
            for i, chunk in enumerate(chunks)
        ]
    })


@app.post("/generate")
async def generate_text(request: Request):
    """
    
    """
    if rag_service is None:
        raise HTTPException(status_code=500, detail="RAG Service is not operational.")

    data = await request.json()
    model = data.get("model", OLLAMA_MODEL)
    prompt = data.get("prompt", "")
    document_ids = data.get("documentIds", [])
    specific_chunks = data.get("specificChunks", None)

    image_ids = [doc_id for doc_id in document_ids if str(doc_id).startswith("img_")]
    text_ids = [doc_id for doc_id in document_ids if str(doc_id).startswith("doc_")]

    if image_ids:
        return await process_image_query(image_ids, text_ids, prompt, model)

    if text_ids:
        start_t = time.time()
        response_text, citations = await rag_service.query_rag(
            document_ids=text_ids,
            question=prompt,
            model_name=model,
            specific_chunks=specific_chunks,
            top_k=3
        )
        generation_time = time.time() - start_t
        # Removed duplicate generation time logging

        citations = citations[:2]
        return JSONResponse(content={
            "response": response_text,
            "citations": citations
        })

    start_t = time.time()
    response_text = await asyncio.to_thread(generate_with_llm, prompt, model)
    generation_time = time.time() - start_t
    # Removed duplicate generation time logging
    return JSONResponse(content={"response": response_text, "citations": []})


async def process_image_query(image_ids: list, text_ids: list, prompt: str, model: str):
    """
    Image Q&A with optional text RAG context.
    """
    if not VISION_FEATURES_ENABLED:
        citations = []
        response_text = "Image Q&A is disabled because no vision model is configured."

        if text_ids and rag_service:
            context, citations = await rag_service.query_rag(
                text_ids,
                prompt,
                model,
                top_k=3
            )
            citations = citations[:2]
            response_text = context

        return JSONResponse(content={
            "response": response_text,
            "citations": citations,
            "usedVisionModel": False,
            "visionModel": None
        })

    vision_model = model
    print(f"Image queries: forcing vision model='{vision_model}', ignoring requested model='{model}'")
    responses = []

    for img_id in image_ids:
        image_files = [f for f in os.listdir(IMAGE_STORE) if f.startswith(img_id)]
        if not image_files:
            responses.append(f"Image {img_id} not found.")
            continue

        image_path = os.path.join(IMAGE_STORE, image_files[0])

        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode()

        try:
            response = requests.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": vision_model,
                    "prompt": prompt,
                    "images": [image_data],
                    "stream": False
                },
                timeout=120
            )
            if response.status_code == 200:
                responses.append(response.json().get("response", "No response"))
            else:
                responses.append(f"Error: Vision model status {response.status_code}")
        except Exception as e:
            responses.append(f"Error processing image: {str(e)}")

    additional_context = ""
    citations = []

    if text_ids and rag_service:
        print("... Image query also performing RAG on text documents ...")
        context, citations = await rag_service.query_rag(
            text_ids,
            prompt,
            model,
            top_k=3
        )
        citations = citations[:2]
        additional_context = f"\n\nAdditional context from documents:\n{context}"

    final_response = "\n\n".join(responses)
    if additional_context:
        final_response += additional_context

    return JSONResponse(content={
        "response": final_response,
        "citations": citations,
        "usedVisionModel": True,
        "visionModel": vision_model
    })


@app.get("/image_bytes/{image_id}")
async def get_image_bytes(image_id: str):
    """Serve an image by its ID as bytes."""
    for ext in IMAGE_EXTENSIONS:
        image_path = os.path.join(IMAGE_STORE, f"{image_id}{ext}")
        if os.path.exists(image_path):
            with open(image_path, "rb") as f:
                data = f.read()
            return Response(data, media_type=f"image/{ext[1:]}")
    raise HTTPException(status_code=404, detail="Image not found")


@app.post("/pull")
async def pull_model(request: Request):
    model = (await request.json()).get("name", OLLAMA_MODEL)
    resp = requests.post(
        f"{OLLAMA_URL}/api/pull",
        json={"name": model, "stream": False},
        timeout=300
    )
    return JSONResponse(content=resp.json(), status_code=resp.status_code)


# ==============================================================================
# 8. SERVER STARTUP
# ==============================================================================
try:
    print("Starting Ollama service...")
    start_ollama_service()
except Exception as e:
    print(f"Failed to start Ollama service: {e}")
    raise

FIXED_URL = "https://mari-unbequeathed-milkily.ngrok-free.app"

requested_port = int(os.environ.get("PORT", "8001"))
server_port = requested_port

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    if sock.connect_ex(("127.0.0.1", requested_port)) == 0:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as fallback_sock:
            fallback_sock.bind(("0.0.0.0", 0))
            server_port = fallback_sock.getsockname()[1]
        print(f"Port {requested_port} is in use. Falling back to port {server_port}.")

public_url = f"http://localhost:{server_port}"
ngrok_enabled = False
ngrok_proc = None

if NGROK_AUTHTOKEN and NGROK_AUTHTOKEN != "YOUR_NGROK_AUTHTOKEN":
    os.system(f"ngrok config add-authtoken {NGROK_AUTHTOKEN}")
    ngrok_proc = subprocess.Popen(
        ["ngrok", "http", "--host-header=rewrite", "--url", FIXED_URL, str(server_port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    public_url = FIXED_URL
    ngrok_enabled = True
    time.sleep(3)
    print(f"Public URL: {public_url}")

config = uvicorn.Config(
    app,
    host="0.0.0.0",
    port=server_port,
    log_level="info",
    access_log=True
)
server = uvicorn.Server(config)

threading.Thread(target=lambda: asyncio.run(server.serve()), daemon=True).start()

try:
    while True:
        time.sleep(300)
except KeyboardInterrupt:
    if ngrok_enabled and ngrok_proc:
        ngrok_proc.terminate()