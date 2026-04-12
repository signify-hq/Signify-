import json


def build_timeline(beats: dict, segments: list, translations: list, signs: list) -> dict:
    """Combine all pipeline outputs into a single timeline JSON.

    Args:
        beats: {"duration": float, "tempo": float, "beats": [float, ...]}
        segments: [{"text": str, "start": float, "end": float}, ...]
        translations: [{"line": int, "english": str, "gloss": [...], "mood": str}, ...]
        signs: output from sign_lookup for all gloss tokens across all lines
    """
    # index translations by line number
    trans_by_line = {t["line"]: t for t in translations}

    # flatten all gloss tokens and map sign results back
    sign_idx = 0
    sign_map = {}
    for t in translations:
        for g in t["gloss"]:
            if sign_idx < len(signs):
                sign_map[(t["line"], g)] = signs[sign_idx]
                sign_idx += 1

    timeline_segments = []
    for i, seg in enumerate(segments):
        line_num = i + 1
        trans = trans_by_line.get(line_num, {})
        gloss_tokens = trans.get("gloss", [])
        mood = trans.get("mood", "tender")

        # distribute sign timing evenly — enforce minimum 0.8s per token
        seg_duration = seg["end"] - seg["start"]
        MIN_TOKEN_DUR = 0.8
        max_tokens = max(1, int(seg_duration / MIN_TOKEN_DUR))
        gloss_tokens = gloss_tokens[:max_tokens]  # drop excess
        token_count = max(len(gloss_tokens), 1)
        time_per_token = seg_duration / token_count

        tokens = []
        for j, g in enumerate(gloss_tokens):
            t_start = round(seg["start"] + j * time_per_token, 3)
            t_end = round(seg["start"] + (j + 1) * time_per_token, 3)
            sign_info = sign_map.get((line_num, g), {"type": "fingerspell", "found": False})
            token_data = {
                "gloss": g,
                "start": t_start,
                "end": t_end,
                "type": sign_info.get("type", "fingerspell"),
            }
            if sign_info.get("type") == "sign":
                token_data["file"] = sign_info.get("file")
            else:
                token_data["letters"] = sign_info.get("letters", [])
            tokens.append(token_data)

        # find beats within this segment's time range
        seg_beats = [b for b in beats["beats"] if seg["start"] <= b <= seg["end"]]

        timeline_segments.append({
            "line": line_num,
            "start": seg["start"],
            "end": seg["end"],
            "lyric": seg["text"],
            "mood": mood,
            "tokens": tokens,
            "beats": seg_beats,
        })

    return {
        "duration": beats["duration"],
        "tempo": beats["tempo"],
        "beats": beats["beats"],
        "segments": timeline_segments,
    }


if __name__ == "__main__":
    # quick test with mock data
    beats = {"duration": 10.0, "tempo": 120.0, "beats": [0.0, 0.5, 1.0, 1.5, 2.0]}
    segments = [{"text": "I love you", "start": 0.0, "end": 2.0}]
    translations = [{"line": 1, "english": "I love you", "gloss": ["I", "LOVE", "YOU"], "mood": "tender"}]
    signs = [
        {"gloss": "I", "file": "i.mp4", "found": True, "type": "sign"},
        {"gloss": "LOVE", "file": "love.mp4", "found": True, "type": "sign"},
        {"gloss": "YOU", "file": "you.mp4", "found": True, "type": "sign"},
    ]
    timeline = build_timeline(beats, segments, translations, signs)
    print(json.dumps(timeline, indent=2))
