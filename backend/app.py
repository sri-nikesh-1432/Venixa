import os
import re
import uuid
import tempfile
import pandas as pd

from dotenv import load_dotenv
from groq import Groq

from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import edge_tts

# =====================================================
# ENV
# =====================================================

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")

if not GROQ_API_KEY:
    raise Exception("Missing GROQ_API_KEY in .env")

groq_client = Groq(api_key=GROQ_API_KEY)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AUDIO_DIR = os.path.join(BASE_DIR, "audio_cache")
os.makedirs(AUDIO_DIR, exist_ok=True)

# =====================================================
# APP
# =====================================================

app = FastAPI(title="Venixa")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=AUDIO_DIR), name="static")

# =====================================================
# SERVICES
# =====================================================

try:
    services_df = pd.read_csv(os.path.join(BASE_DIR, "services.csv"))
    service_context = services_df.to_string(index=False)
except Exception:
    service_context = "No services loaded."

# =====================================================
# VOICES
# =====================================================

VOICE_MAP = {
    "english": "en-IN-NeerjaNeural",
    "telugu": "te-IN-ShrutiNeural",
    "hindi": "hi-IN-SwaraNeural",
    "tamil": "ta-IN-PallaviNeural",
    "kannada": "kn-IN-SapnaNeural",
}

SUPPORTED_LANGUAGES = list(VOICE_MAP.keys())

# =====================================================
# MODELS
# =====================================================


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    text: str
    history: list[Message] = []


# =====================================================
# ROOT
# =====================================================


@app.get("/")
def root():
    return {
        "status": "running",
        "name": "Venixa",
        "modes": ["text-to-voice", "voice-to-voice"],
        "languages": SUPPORTED_LANGUAGES,
    }


@app.get("/health")
def health():
    return {"ok": True}


# =====================================================
# TRANSCRIBE
# =====================================================


def transcribe_audio(path: str, filename: str = "audio.webm"):
    with open(path, "rb") as f:
        result = groq_client.audio.transcriptions.create(
            file=(filename, f.read()),
            model="whisper-large-v3",
            response_format="text",
        )

    if isinstance(result, str):
        return result.strip()

    try:
        return result.text.strip()
    except Exception:
        return str(result).strip()


# =====================================================
# LANGUAGE DETECTION
# =====================================================


def detect_language(text: str):
    try:
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Detect the language of this text. "
                        "Return ONLY one word: English, Telugu, Hindi, Tamil, or Kannada.\n\n"
                        f"Text: {text}"
                    ),
                }
            ],
            max_tokens=5,
        )
        detected = response.choices[0].message.content.strip().lower()
        return detected if detected in VOICE_MAP else "english"
    except Exception:
        return "english"


# =====================================================
# AI REPLY
# =====================================================


def build_system_prompt():
    return f"""
You are Venixa, a warm and knowledgeable female AI voice assistant for a spiritual services platform.

Available services:
{service_context}

Rules:
1. Reply in the user's language.
2. If a service exists, explain the service name, price, duration, and benefits in a natural conversational way.
3. If a service is not available, politely say it is unavailable and suggest similar options if any.
4. No markdown, no bullet points, no asterisks.
5. Keep answers concise and conversational — suitable for spoken voice (2-4 sentences unless more detail is requested).
6. You help users book poojas, homams, and subscription plans.
"""


def get_reply(user_text: str, history: list[Message] = []):
    messages = [{"role": "system", "content": build_system_prompt()}]

    for msg in history[-8:]:
        if msg.role in ("user", "assistant"):
            messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": user_text})

    response = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        temperature=0.7,
        max_tokens=500,
    )

    raw = response.choices[0].message.content
    reply = re.sub(r"[*#`]", "", raw).strip()
    return reply


# =====================================================
# TTS
# =====================================================


def pick_voice(language: str):
    key = language.lower()
    return VOICE_MAP.get(key, VOICE_MAP["english"])


async def generate_tts(text: str, language: str):
    voice = pick_voice(language)
    filename = f"{uuid.uuid4().hex}.mp3"
    path = os.path.join(AUDIO_DIR, filename)

    communicator = edge_tts.Communicate(text=text, voice=voice)
    await communicator.save(path)

    return filename


def audio_url(filename: str):
    # Return relative path; frontend will prepend its own base URL
    return f"/static/{filename}"


# =====================================================
# TEXT CHAT (text-to-voice)
# =====================================================


@app.post("/chat")
async def chat(req: ChatRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    language = detect_language(req.text)
    reply = get_reply(req.text, req.history)
    audio_file = await generate_tts(reply, language)

    return {
        "success": True,
        "language": language,
        "reply": reply,
        "audio_url": audio_url(audio_file),
    }


# =====================================================
# VOICE CHAT (voice-to-voice)
# =====================================================


@app.post("/voice")
async def voice(
    file: UploadFile = File(...),
    history: str = Form(""),
):
    suffix = ".webm"
    if file.filename and "." in file.filename:
        suffix = "." + file.filename.rsplit(".", 1)[-1].lower()

    temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp.write(await file.read())
    temp.close()

    upload_name = file.filename or f"audio{suffix}"

    try:
        user_text = transcribe_audio(temp.name, upload_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        try:
            os.unlink(temp.name)
        except OSError:
            pass

    if not user_text.strip():
        raise HTTPException(status_code=400, detail="Could not understand audio")

    parsed_history: list[Message] = []
    if history.strip():
        import json

        try:
            raw = json.loads(history)
            parsed_history = [Message(**m) for m in raw]
        except Exception:
            pass

    language = detect_language(user_text)
    reply = get_reply(user_text, parsed_history)
    audio_file = await generate_tts(reply, language)

    return {
        "success": True,
        "language": language,
        "text": user_text,
        "reply": reply,
        "audio_url": audio_url(audio_file),
    }