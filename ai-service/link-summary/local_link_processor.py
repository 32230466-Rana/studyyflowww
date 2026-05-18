import json
import os
import re
import sys
import time
import html
import uuid
import mimetypes
import tempfile
import subprocess
import urllib.request
import urllib.error
from pathlib import Path


YOUTUBE_PATTERNS = [
    "youtube.com/watch",
    "youtu.be/",
    "youtube.com/shorts/",
    "youtube.com/embed/",
]

INSTAGRAM_PATTERNS = [
    "instagram.com/reel/",
    "instagram.com/p/",
    "instagram.com/tv/",
    "instagram.com/stories/",
]


def print_json(data, status_code=0):
    print(json.dumps(data, ensure_ascii=False, indent=2))
    sys.exit(status_code)


def is_youtube_url(url: str) -> bool:
    lower = url.lower()
    return any(pattern in lower for pattern in YOUTUBE_PATTERNS)


def is_instagram_url(url: str) -> bool:
    lower = url.lower()
    return any(pattern in lower for pattern in INSTAGRAM_PATTERNS)


def is_video_url(url: str) -> bool:
    return is_youtube_url(url) or is_instagram_url(url)


def clean_text(text: str) -> str:
    if not text:
        return ""

    text = html.unescape(str(text))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\[[^\]]+\]", " ", text)
    text = re.sub(r"\([0-9:.]+\)", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def clean_model_output(text: str) -> str:
    if not text:
        return ""

    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"```(?:text|json|markdown)?", "", text, flags=re.IGNORECASE)
    text = text.replace("```", "")
    return text.strip()


# =========================================================
# WEBPAGE EXTRACTION
# =========================================================

def fetch_url_text(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0 Safari/537.36"
            )
        },
    )

    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read()

    return raw.decode("utf-8", errors="replace")


def extract_webpage_title_and_text(url: str):
    page = fetch_url_text(url)

    title_match = re.search(r"<title[^>]*>(.*?)</title>", page, flags=re.I | re.S)
    title = clean_text(title_match.group(1)) if title_match else "Untitled Page"

    page = re.sub(r"(?is)<script.*?</script>", " ", page)
    page = re.sub(r"(?is)<style.*?</style>", " ", page)
    page = re.sub(r"(?is)<nav.*?</nav>", " ", page)
    page = re.sub(r"(?is)<footer.*?</footer>", " ", page)

    text = clean_text(page)
    return title, text


# =========================================================
# YT-DLP HELPERS
# =========================================================

def make_env_for_ytdlp():
    env = os.environ.copy()

    user_profile = env.get("USERPROFILE") or str(Path.home())
    deno_bin = str(Path(user_profile) / ".deno" / "bin")

    current_path = env.get("PATH") or env.get("Path") or ""

    if os.path.isdir(deno_bin) and deno_bin.lower() not in current_path.lower():
        current_path = current_path + os.pathsep + deno_bin

    env["PATH"] = current_path
    env["Path"] = current_path
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    return env


def run_command(cmd, timeout=300):
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=make_env_for_ytdlp(),
        timeout=timeout,
    )

    return result.returncode, result.stdout, result.stderr


def build_ytdlp_base_cmd():
    js_runtime = os.getenv("LINK_YTDLP_JS_RUNTIME", "deno").strip() or "deno"
    cookies_browser = os.getenv("LINK_YTDLP_COOKIES_FROM_BROWSER", "").strip()
    ffmpeg_location = os.getenv("LINK_FFMPEG_LOCATION", "").strip()

    cmd = ["yt-dlp"]

    if js_runtime:
        cmd.extend(["--js-runtimes", js_runtime])

    if cookies_browser:
        cmd.extend(["--cookies-from-browser", cookies_browser])

    if ffmpeg_location:
        cmd.extend(["--ffmpeg-location", ffmpeg_location])

    return cmd
def get_video_info(url: str):
    cmd = build_ytdlp_base_cmd()
    cmd.extend(["--skip-download", "--dump-json", url])

    code, out, err = run_command(cmd, timeout=300)

    if code != 0:
        return None, err.strip() or out.strip()

    try:
        return json.loads(out), ""
    except Exception:
        match = re.search(r"\{.*\}", out, flags=re.S)
        if match:
            try:
                return json.loads(match.group(0)), ""
            except Exception:
                pass

    return None, "yt-dlp returned invalid JSON."


# =========================================================
# CAPTION EXTRACTION
# =========================================================

def pick_caption_url(info):
    subtitle_sources = []

    subtitles = info.get("subtitles") or {}
    automatic_captions = info.get("automatic_captions") or {}

    preferred_langs = [
        "en", "en-US", "en-GB", "a.en", "en-orig",
        "ar", "ar-SA", "a.ar",
    ]

    for source in (subtitles, automatic_captions):
        for lang in preferred_langs:
            if lang in source:
                subtitle_sources.extend(source[lang])

    if not subtitle_sources:
        for source in (subtitles, automatic_captions):
            for _lang, items in source.items():
                if items:
                    subtitle_sources.extend(items)
                    break

    preferred_exts = ["json3", "vtt", "srt"]

    for ext in preferred_exts:
        for item in subtitle_sources:
            if item.get("ext") == ext and item.get("url"):
                return item.get("url"), ext

    for item in subtitle_sources:
        if item.get("url"):
            return item.get("url"), item.get("ext", "")

    return None, None


def parse_json3_captions(raw: str) -> str:
    data = json.loads(raw)
    events = data.get("events") or []
    parts = []

    for event in events:
        segs = event.get("segs") or []
        for seg in segs:
            txt = seg.get("utf8", "")
            txt = txt.replace("\n", " ").strip()
            if txt:
                parts.append(txt)

    return clean_text(" ".join(parts))


def parse_vtt_or_srt(raw: str) -> str:
    lines = []

    for line in raw.splitlines():
        line = line.strip()

        if not line:
            continue

        if line.upper().startswith("WEBVTT"):
            continue

        if re.match(r"^\d+$", line):
            continue

        if "-->" in line:
            continue

        line = re.sub(r"<[^>]+>", "", line)

        if line:
            lines.append(line)

    return clean_text(" ".join(lines))


def download_caption_text(caption_url: str, ext: str) -> str:
    raw = fetch_url_text(caption_url, timeout=60)

    if ext == "json3":
        return parse_json3_captions(raw)

    return parse_vtt_or_srt(raw)


# =========================================================
# AUDIO DOWNLOAD + GROQ TRANSCRIPTION
# =========================================================

def download_audio_with_ytdlp(url: str, work_dir: str) -> str:
    output_template = str(Path(work_dir) / "audio.%(ext)s")

    cmd = build_ytdlp_base_cmd()
    cmd.extend(
        [
            "--no-playlist",
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "5",
            "-o",
            output_template,
            url,
        ]
    )

    code, out, err = run_command(cmd, timeout=900)

    if code != 0:
        raise RuntimeError(err.strip() or out.strip() or "Failed to download audio.")

    audio_files = list(Path(work_dir).glob("audio.*"))

    if not audio_files:
        raise RuntimeError("Audio download finished but no audio file was found.")

    audio_file = audio_files[0]

    if not audio_file.exists() or audio_file.stat().st_size == 0:
        raise RuntimeError("Downloaded audio file is empty.")

    return str(audio_file)


def transcribe_audio_with_groq(audio_path: str) -> str:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    model = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo").strip()

    if not api_key:
        raise RuntimeError("GROQ_API_KEY is missing.")

    endpoint = "https://api.groq.com/openai/v1/audio/transcriptions"

    boundary = "----StudyFlowBoundary" + uuid.uuid4().hex
    filename = os.path.basename(audio_path)
    content_type = mimetypes.guess_type(audio_path)[0] or "audio/mpeg"

    with open(audio_path, "rb") as f:
        file_bytes = f.read()

    body = bytearray()

    def add_field(name: str, value: str):
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8")
        )
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")

    add_field("model", model)
    add_field("response_format", "json")
    add_field("temperature", "0")

    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(
        (
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
    )
    body.extend(file_bytes)
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    req = urllib.request.Request(
        endpoint,
        data=bytes(body),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=900) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Groq transcription failed: {exc.code} {error_body}")

    parsed = json.loads(raw)
    transcript = parsed.get("text", "")

    return clean_text(transcript)


def choose_best_transcript(caption_text: str, audio_text: str, always_audio: bool = False):
    caption_text = clean_text(caption_text)
    audio_text = clean_text(audio_text)

    caption_ok = len(caption_text) > 80
    audio_ok = len(audio_text) > 80

    if caption_ok and audio_ok:
        return caption_text + "\n\n" + audio_text, "captions + groq_audio"

    if audio_ok:
        return audio_text, "groq_audio"

    if caption_ok:
        return caption_text, "captions"

    return "", ""


def extract_video_text(url: str):
    info, error = get_video_info(url)

    if not info:
        raise RuntimeError(error or "Could not read video information.")

    title = info.get("title") or "Video"
    description = info.get("description") or ""
    uploader = info.get("uploader") or info.get("channel") or ""

    caption_text = ""
    audio_text = ""
    transcript_source = ""
    audio_error = ""

    caption_url, caption_ext = pick_caption_url(info)

    if caption_url:
        try:
            caption_text = download_caption_text(caption_url, caption_ext)
        except Exception:
            caption_text = ""

    if not caption_text and is_instagram_url(url) and description:
        caption_text = description

    always_audio = os.getenv("LINK_ALWAYS_TRANSCRIBE_AUDIO", "false").strip().lower() in [
        "1", "true", "yes", "on"
    ]

    if always_audio or len(caption_text) <= 80:
        try:
            with tempfile.TemporaryDirectory() as tmp:
                audio_path = download_audio_with_ytdlp(url, tmp)
                audio_text = transcribe_audio_with_groq(audio_path)
        except Exception as exc:
            audio_error = str(exc)
            audio_text = ""

    transcript, transcript_source = choose_best_transcript(caption_text, audio_text, always_audio)

    fallback_text = clean_text(" ".join([title, uploader, description]))

    if len(transcript) <= 80:
        transcript = ""
        final_text = fallback_text
        if audio_error:
            transcript_source = f"audio_failed: {audio_error}"
        else:
            transcript_source = "fallback"
    else:
        final_text = transcript

    return title, final_text, transcript, transcript_source


# =========================================================
# OLLAMA SUMMARY
# =========================================================

def call_ollama(prompt: str):
    host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
    model = (
        os.getenv("LINK_SUMMARY_MODEL")
        or os.getenv("OLLAMA_MODEL")
        or "qwen3:1.7b"
    )

    endpoint = f"{host}/api/generate"

    payload = {
        "model": model,
        "prompt": "/no_think\n" + prompt.strip(),
        "stream": False,
        "think": False,
        "options": {
            "temperature": 0.1,
            "top_p": 0.85,
            "repeat_penalty": 1.12,
            "num_ctx": 4096,
            "num_predict": 1200,
        },
    }

    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=900) as response:
        raw = response.read().decode("utf-8", errors="replace")

    parsed = json.loads(raw)
    return clean_model_output(parsed.get("response", "").strip())


def fallback_summary(title: str, text: str):
    text = clean_text(text)
    sentences = re.split(r"(?<=[.!?])\s+", text)

    useful = []

    for sentence in sentences:
        sentence = sentence.strip()

        if 40 <= len(sentence) <= 240:
            useful.append(sentence)

        if len(useful) >= 6:
            break

    if not useful:
        useful = [text[:220] if text else title]

    main_idea = useful[0]

    topics = []
    details = []
    revision = []

    for item in useful:
        if len(topics) < 3:
            topics.append(item[:120])
        elif len(details) < 3:
            details.append(item)
        elif len(revision) < 2:
            revision.append(item)

    if not details:
        details = useful[:3]

    if not revision:
        revision = [
            "Review the main topic and the key ideas extracted from the source.",
            "Focus on the facts and details that are clearly present in the content.",
        ]

    return (
        "# Text Summary\n\n"
        "## 1. Main Idea\n"
        f"{main_idea}\n\n"
        "## 2. Main Topics\n"
        + "\n".join(f"- {point}" for point in topics)
        + "\n\n"
        "## 3. Key Facts and Concepts\n"
        + "\n".join(f"- {point}" for point in details[:3])
        + "\n\n"
        "## 4. Important Details\n"
        + "\n".join(f"- {point}" for point in details[:3])
        + "\n\n"
        "## 5. Exam Revision Points\n"
        + "\n".join(f"- {point}" for point in revision[:3])
        + "\n\n"
        "## 6. Short Final Summary\n"
        "This summary was generated from the available extracted text."
    )


def summarize_content(title: str, text: str, source_type: str):
    max_chars = 12000
    text = clean_text(text)[:max_chars]

    if len(text) < 40:
        return fallback_summary(title, text)

    prompt = f"""
You are StudyFlow local AI.

TASK:
Summarize the following {source_type} clearly for students.

VERY IMPORTANT RULES:
- Use ONLY the provided content.
- Do NOT use outside knowledge.
- Do NOT invent facts, dates, names, examples, definitions, or explanations.
- If the content is a video, summarize only the transcript/description that is provided.
- If the content is a webpage, summarize only the extracted webpage text.
- Include the EXACT video or article Title at the very beginning of the summary.
- Avoid generic phrasing; be highly specific to the content provided.
- Keep the answer in English.
- Make the answer useful for studying and exam revision.
- Be clear, structured, and concise.
- Avoid repetition between sections.
- Do not repeat the same bullet in more than one section.
- Do not mention that you are an AI.
- Do not include raw transcript text unless needed as a short detail.

SECTION PURPOSES:
- Main Idea: short overview only. Include the exact Title.
- Main Topics: topic names only, not full explanations. If timestamps are available in the text, include them here.
- Key Facts and Concepts: definitions and core concepts.
- Important Details: supporting details, key examples from the video/text, benefits, differences, or applications.
- Exam Revision Points: short study reminders or exam-focused points, not copied facts from previous sections.
- Short Final Summary: one concise final paragraph.

Use this exact format:

# {title}

## 1. Main Idea
Write 2-3 sentences explaining what the content is about.

## 2. Main Topics
- Topic name with timestamp if available
- Topic name with timestamp if available
- Topic name with timestamp if available

## 3. Key Facts and Concepts
- ...

## 4. Important Details (Key Examples)
- ...

## 5. Exam Revision Points
- ...

## 6. Short Final Summary
Write one short paragraph summarizing the whole content.

Title:
{title}

Content:
{text}
""".strip()

    try:
        answer = call_ollama(prompt)

        if answer and len(answer) > 80:
            return answer
    except Exception:
        pass

    return fallback_summary(title, text)


# =========================================================
# MAIN
# =========================================================

def main():
    start = time.time()

    if len(sys.argv) < 2:
        print_json(
            {
                "success": False,
                "message": "Missing URL argument.",
            },
            1,
        )

    url = sys.argv[1].strip()

    try:
        transcript = None
        transcript_source = None

        if is_video_url(url):
            title, text, transcript, transcript_source = extract_video_text(url)

            if is_youtube_url(url):
                source_type = "youtube_video"
            elif is_instagram_url(url):
                source_type = "instagram_video"
            else:
                source_type = "video"
        else:
            title, text = extract_webpage_title_and_text(url)
            source_type = "webpage"

        summary = summarize_content(title, text, source_type)

        print_json(
            {
                "success": True,
                "type": source_type,
                "url": url,
                "title": title,
                "summary": summary,
                "transcript": transcript,
                "transcript_source": transcript_source,
                "processing_time_seconds": round(time.time() - start, 2),
            }
        )

    except Exception as exc:
        print_json(
            {
                "success": False,
                "message": str(exc),
                "type": "error",
                "url": url,
                "processing_time_seconds": round(time.time() - start, 2),
            },
            1,
        )


if __name__ == "__main__":
    main()
