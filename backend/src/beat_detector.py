import librosa
import numpy as np


def detect_beats(audio_path: str) -> dict:
    y, sr = librosa.load(audio_path, sr=None)
    duration = librosa.get_duration(y=y, sr=sr)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    return {
        "duration": round(float(duration), 3),
        "tempo": round(float(np.asarray(tempo).item()), 1),
        "beats": [round(float(t), 3) for t in beat_times],
    }
