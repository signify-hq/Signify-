import whisper
import os
import json


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


def parse_offline(audio_path: str) -> list:
    return get_timestamps(audio_path)


if __name__ == "__main__":
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else "data/songs/test.mp3"
    print("Offline mode: using Whisper transcription")
    segs = parse_offline(path)

    for i, s in enumerate(segs):
        print(f"{i+1:2d}  [{s['start']:6.1f}s - {s['end']:6.1f}s]  {s['text']}")
    print(f"\n{len(segs)} segments")
