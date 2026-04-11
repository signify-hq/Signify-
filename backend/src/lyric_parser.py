import whisper
import lyricsgenius
import os
import json
import re
from difflib import SequenceMatcher


def fetch_lyrics(title: str, artist: str) -> list:
    token = os.getenv("GENIUS_API_TOKEN")
    if not token:
        raise ValueError("GENIUS_API_TOKEN not set in .env")
    genius = lyricsgenius.Genius(token, verbose=False)
    song = genius.search_song(title, artist)
    if not song:
        raise ValueError(f"Lyrics not found for '{title}' by '{artist}'")
    lyrics = song.lyrics
    lyrics = re.sub(r"\[.*?\]", "", lyrics)
    lyrics = re.sub(r"^.*Lyrics\n", "", lyrics, count=1)
    lyrics = re.sub(r"\d*Embed$", "", lyrics.strip())
    lines = [l.strip() for l in lyrics.split("\n") if l.strip()]
    return lines


def get_timestamps(audio_path: str, model_size: str = "base") -> list:
    model = whisper.load_model(model_size)
    result = model.transcribe(audio_path, word_timestamps=True)
    segments = []
    for seg in result["segments"]:
        words = []
        for w in seg.get("words", []):
            words.append({
                "word": w["word"].strip(),
                "start": round(w["start"], 3),
                "end": round(w["end"], 3),
            })
        segments.append({
            "text": seg["text"].strip(),
            "start": round(seg["start"], 3),
            "end": round(seg["end"], 3),
            "words": words,
        })
    return segments


def align_lyrics_to_timestamps(lyrics: list, timestamps: list) -> list:
    """Match real lyrics lines to Whisper timestamp segments.

    Whisper groups multiple lines into one segment, so we distribute
    the segment's time window across the matching lyric lines.
    """
    segments = []
    lyric_idx = 0

    for ts in timestamps:
        whisper_text = ts["text"].lower()
        # figure out how many lyric lines fit into this whisper segment
        best_count = 1
        best_score = 0
        for count in range(1, min(5, len(lyrics) - lyric_idx + 1)):
            combined = " ".join(lyrics[lyric_idx:lyric_idx + count]).lower()
            score = SequenceMatcher(None, whisper_text, combined).ratio()
            if score > best_score:
                best_score = score
                best_count = count

        matched_lines = lyrics[lyric_idx:lyric_idx + best_count]
        duration = ts["end"] - ts["start"]
        time_per_line = duration / best_count

        for j, line in enumerate(matched_lines):
            start = round(ts["start"] + j * time_per_line, 3)
            end = round(ts["start"] + (j + 1) * time_per_line, 3)
            segments.append({
                "text": line,
                "start": start,
                "end": end,
            })

        lyric_idx += best_count

    # any remaining lyrics that didn't match
    for line in lyrics[lyric_idx:]:
        segments.append({
            "text": line,
            "start": segments[-1]["end"] if segments else 0.0,
            "end": segments[-1]["end"] + 3.0 if segments else 3.0,
        })

    return segments


def parse_online(audio_path: str, title: str, artist: str) -> list:
    lyrics = fetch_lyrics(title, artist)
    timestamps = get_timestamps(audio_path)
    return align_lyrics_to_timestamps(lyrics, timestamps)


def parse_offline(audio_path: str) -> list:
    return get_timestamps(audio_path)


if __name__ == "__main__":
    import sys
    from dotenv import load_dotenv
    load_dotenv()

    if len(sys.argv) >= 4:
        path, title, artist = sys.argv[1], sys.argv[2], sys.argv[3]
        print(f"Online mode: fetching lyrics for '{title}' by '{artist}'")
        segs = parse_online(path, title, artist)
    else:
        path = sys.argv[1] if len(sys.argv) > 1 else "data/songs/test.mp3"
        print("Offline mode: using Whisper transcription")
        segs = parse_offline(path)

    for i, s in enumerate(segs):
        print(f"{i+1:2d}  [{s['start']:6.1f}s - {s['end']:6.1f}s]  {s['text']}")
    print(f"\n{len(segs)} segments")
