import logging
import re

logger = logging.getLogger(__name__)


class PDFProcessor:
    def __init__(self, pdf_doc, llm):
        self.pdf_doc = pdf_doc
        self.llm = llm

    def clean_model_output(self, text: str) -> str:
        """
        Remove hidden thinking blocks if the local model returns them.
        """
        if not text:
            return ""

        text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
        return text.strip()

    def extract_text(self) -> str:
        """
        Extract plain text from all PDF pages using PyMuPDF.
        Page numbers are added so the model can understand the document order.
        """
        text_parts = []

        for page_index in range(len(self.pdf_doc)):
            page = self.pdf_doc.load_page(page_index)
            page_text = page.get_text("text")

            if page_text and page_text.strip():
                text_parts.append(
                    f"\n--- PAGE {page_index + 1} ---\n{page_text.strip()}"
                )

        full_text = "\n\n".join(text_parts).strip()
        logger.info(f"Extracted text length: {len(full_text)} characters")

        return full_text

    def get_adaptive_chunk_size(self, text: str) -> tuple[str, int]:
        """
        Choose chunk size based on extracted text length.

        Small PDFs:
        - Keep old behavior.
        - max_chars = 3000

        Medium PDFs:
        - Keep medium behavior.
        - max_chars = 6000

        Large PDFs:
        - Large up to 15000 characters: use one larger chunk.
        - Very large above 15000 characters: use 12000 to reduce chunks but avoid one huge prompt.
        """
        text_length = len(text)

        if text_length <= 2500:
            document_size = "small"
            max_chars = 3000

        elif text_length <= 7000:
            document_size = "medium"
            max_chars = 6000

        elif text_length <= 15000:
            document_size = "large"
            max_chars = 15000

        else:
            document_size = "large"
            max_chars = 12000

        logger.info(
            f"Detected {document_size} PDF | text length={text_length} | max_chars={max_chars}"
        )

        return document_size, max_chars

    def split_text(self, text: str, max_chars: int = 3000) -> list[str]:
        """
        Split long PDF text into smaller chunks.
        No embeddings, no FAISS, no RAG.
        """
        chunks = []
        current_chunk = ""

        blocks = text.split("\n\n")

        for block in blocks:
            block = block.strip()

            if not block:
                continue

            if len(current_chunk) + len(block) + 2 <= max_chars:
                current_chunk += block + "\n\n"
            else:
                if current_chunk.strip():
                    chunks.append(current_chunk.strip())

                if len(block) > max_chars:
                    for i in range(0, len(block), max_chars):
                        part = block[i:i + max_chars].strip()
                        if part:
                            chunks.append(part)
                    current_chunk = ""
                else:
                    current_chunk = block + "\n\n"

        if current_chunk.strip():
            chunks.append(current_chunk.strip())

        logger.info(f"PDF text split into {len(chunks)} chunk(s)")
        return chunks

    def summarize_chunk(self, chunk: str, index: int, total: int) -> str:
        """
        Summarize one PDF chunk accurately.
        This prompt is general and works for any PDF topic.
        """
        prompt = f"""
You are a careful academic summarization assistant.

TASK:
Summarize this PDF section for a student.

VERY IMPORTANT RULES:
- Use ONLY information found in the provided PDF section.
- Be strict: Do NOT use outside knowledge, even if it is true.
- Do NOT add exact years, dates, rankings, or claims unless they are explicitly written in the provided text.
- Do NOT invent facts, names, dates, examples, topics, definitions, or explanations.
- Do NOT force the PDF into a specific subject like CSS, programming, science, history, or biography.
- Detect the real topic only from the provided text.
- If something is not clearly present in the text, do not mention it.
- Preserve important technical terms exactly as written.
- Keep the answer in English.
- Make the answer useful for studying and exam revision.
- Be concise but complete.

OUTPUT FORMAT:
### Main Ideas
- ...

### Key Facts and Concepts
- ...

### Important Details
- ...

### Examples or Evidence Mentioned
- ...

### Exam Revision Notes
- ...

PDF Section {index} of {total}:
{chunk}
"""

        result = self.llm.invoke(prompt)
        return self.clean_model_output(result)

    def combine_summaries_once(self, summaries: list[str]) -> str:
        """
        Combine a group of section summaries into one cleaner summary.
        """
        joined_summaries = "\n\n".join(summaries)

        prompt = f"""
You are a careful academic summarization assistant.

TASK:
Combine the following section summaries into one clean study summary.

VERY IMPORTANT RULES:
- Use ONLY information found in the section summaries.
- Do NOT use outside knowledge, even if it is true.
- Do NOT add exact years, dates, rankings, or claims unless they are explicitly written in the section summaries.
- Do NOT invent new facts, names, dates, examples, topics, or concepts.
- Do NOT add CSS, programming, science, history, or biography sections unless the summaries clearly support them.
- The final summary must match the actual PDF topic.
- Remove repetition.
- Keep the summary in English.
- Do not translate to another language.
- Do not include word cloud information.
- Make the summary clear, structured, and useful for exam revision.

FINAL OUTPUT FORMAT:
# PDF Summary

## 1. Main Idea
Write 2-3 sentences explaining what the PDF is about.

## 2. Main Topics
- ...

## 3. Key Facts and Concepts
- ...

## 4. Important Details
- ...

## 5. Examples or Evidence
- ...

## 6. Exam Revision Points
- ...

## 7. Short Final Summary
Write one short paragraph summarizing the whole PDF.

SECTION SUMMARIES:
{joined_summaries}
"""

        result = self.llm.invoke(prompt)
        return self.clean_model_output(result)

    def combine_summaries(self, summaries: list[str], max_batch_chars: int = 6000) -> str:
        """
        Combine summaries safely.
        If there are many chunks, combine them in batches first to avoid context issues.
        """
        if not summaries:
            return "No summary could be generated."

        if len(summaries) == 1:
            return summaries[0]

        batches = []
        current_batch = []
        current_length = 0

        for summary in summaries:
            summary_length = len(summary)

            if current_batch and current_length + summary_length > max_batch_chars:
                batches.append(current_batch)
                current_batch = [summary]
                current_length = summary_length
            else:
                current_batch.append(summary)
                current_length += summary_length

        if current_batch:
            batches.append(current_batch)

        if len(batches) == 1:
            return self.combine_summaries_once(batches[0])

        logger.info(f"Combining summaries in {len(batches)} batch(es)")

        batch_summaries = []

        for batch_index, batch in enumerate(batches, start=1):
            logger.info(f"Combining summary batch {batch_index}/{len(batches)}")
            batch_summary = self.combine_summaries_once(batch)
            batch_summaries.append(batch_summary)

        return self.combine_summaries_once(batch_summaries)

    def process(self) -> str:
        """
        Main PDF processing flow:
        PDF text extraction -> adaptive chunking -> summarization -> final summary.

        Behavior:
        - Small PDFs keep max_chars = 3000.
        - Medium PDFs keep max_chars = 6000.
        - Large PDFs up to 15000 characters use max_chars = 15000.
        - Very large PDFs use max_chars = 12000.
        - No embeddings.
        - No FAISS.
        - No clustering.
        - No forced subject.
        """
        try:
            text = self.extract_text()

            if not text:
                logger.warning("No readable text was found in this PDF.")
                return "No readable text was found in this PDF."

            document_size, max_chars = self.get_adaptive_chunk_size(text)

            chunks = self.split_text(text, max_chars=max_chars)

            if not chunks:
                logger.warning("No valid chunks were created from the PDF text.")
                return "No readable text was found in this PDF."

            partial_summaries = []

            for index, chunk in enumerate(chunks, start=1):
                logger.info(
                    f"Summarizing chunk {index}/{len(chunks)} | document_size={document_size}"
                )
                summary = self.summarize_chunk(chunk, index, len(chunks))
                partial_summaries.append(summary)

            logger.info("Combining partial summaries into final summary.")
            final_summary = self.combine_summaries(partial_summaries)

            logger.info("Processing completed successfully.")
            return final_summary

        except Exception as e:
            logger.error(f"Error during PDF processing: {e}")
            raise e