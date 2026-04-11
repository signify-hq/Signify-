import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, Form
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from src.beat_detector import detect_beats
from src.lyric_parser import parse_offline
from src.asl_translator import translate
from src.sign_lookup import lookup
from src.sync_engine import build_timeline

load_dotenv()

app = FastAPI(title="Signify")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SIGNS_DIR = os.path.join(DATA_DIR, "signs")
SONGS_DIR = os.path.join(DATA_DIR, "songs")
os.makedirs(SONGS_DIR, exist_ok=True)

app.mount("/signs", StaticFiles(directory=SIGNS_DIR), name="signs")


@app.post("/api/process")
async def process_song(
    audio: UploadFile,
    title: str = Form(default=""),
    artist: str = Form(default=""),
):
    # save uploaded audio
    audio_path = os.path.join(SONGS_DIR, audio.filename)
    with open(audio_path, "wb") as f:
        f.write(await audio.read())

    # run pipeline
    beats = detect_beats(audio_path)
    segments = parse_offline(audio_path)

    lyrics = [s["text"] for s in segments]
    translations = translate(lyrics)

    all_gloss = []
    for t in translations:
        all_gloss.extend(t["gloss"])
    signs = lookup(all_gloss)

    timeline = build_timeline(beats, segments, translations, signs)
    return timeline
