
from io import BytesIO
import fitz

def extract_chapter_headings_with_page_numbers_from_bytes(file_bytes: bytes):
    doc = fitz.open(stream=BytesIO(file_bytes), filetype="pdf")
    chapters = []

    for page_num, page in enumerate(doc, start=1):
        blocks = page.get_text("dict")["blocks"]
        for b in blocks:
            for l in b.get("lines", []):
                for s in l.get("spans", []):
                    text = s['text'].strip()
                    font_size = s['size']
                    if font_size > 14 and any(text.lower().startswith(prefix) for prefix in ("chapter", "unit", "lesson")):
                        chapters.append({
                            "page": page_num,
                            "text": text,
                            "font_size": font_size
                        })

    return chapters

def extract_chapter_contents_from_bytes(file_bytes: bytes, chapter_headings):
    doc = fitz.open(stream=BytesIO(file_bytes), filetype="pdf")
    chapters = []

    for i, chapter in enumerate(chapter_headings):
        start_page = chapter["page"] - 1
        end_page = chapter_headings[i + 1]["page"] - 1 if i + 1 < len(chapter_headings) else len(doc)

        chapter_text = ""
        for p in range(start_page, end_page):
            page = doc.load_page(p)
            chapter_text += page.get_text() + "\n"

        chapters.append({
            "title": chapter["text"],
            "start_page": start_page + 1,
            "end_page": end_page,
            "content": chapter_text.strip()
        })

    return chapters