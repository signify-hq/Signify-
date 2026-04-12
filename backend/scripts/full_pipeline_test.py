"""Run the full Signify pipeline on a song and produce a readable report."""
import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from src.beat_detector import detect_beats
from src.lyric_parser import parse_online
from src.asl_translator import translate
from src.sign_lookup import lookup
from src.sync_engine import build_timeline


def main():
    audio = "data/songs/test.mp3"
    title = "Ordinary"
    artist = "Alex Warren"

    print("=" * 70)
    print("  SIGNIFY — FULL PIPELINE TEST")
    print(f"  Song: {title} by {artist}")
    print("=" * 70)

    # Step 1: Beat detection
    print("\n[1/5] Detecting beats...")
    beats = detect_beats(audio)
    print(f"  Tempo: {beats['tempo']} BPM")
    print(f"  Duration: {beats['duration']}s")
    print(f"  Beats found: {len(beats['beats'])}")

    # Step 2: Lyrics + timestamps
    print("\n[2/5] Fetching lyrics + timestamps (online mode)...")
    segments = parse_online(audio, title, artist)
    print(f"  Lyric segments: {len(segments)}")

    # Step 3: ASL translation
    print("\n[3/5] Translating to ASL gloss...")
    lyrics = [s["text"] for s in segments]
    translations = translate(lyrics)
    print(f"  Translated lines: {len(translations)}")

    # Step 4: Sign lookup
    print("\n[4/5] Looking up sign videos...")
    all_gloss = []
    for t in translations:
        all_gloss.extend(t["gloss"])
    signs = lookup(all_gloss)
    found = sum(1 for s in signs if s.get("found") or s.get("type") == "sign")
    print(f"  Total gloss tokens: {len(all_gloss)}")
    print(f"  Signs with video: {found}")
    print(f"  Fingerspelled: {len(all_gloss) - found}")

    # Step 5: Build timeline
    print("\n[5/5] Building timeline...")
    timeline = build_timeline(beats, segments, translations, signs)

    # Save timeline JSON
    os.makedirs("data/timelines", exist_ok=True)
    with open("data/timelines/ordinary.json", "w") as f:
        json.dump(timeline, f, indent=2)
    print("  Saved: data/timelines/ordinary.json")

    # Produce human-readable report
    report = []
    report.append("=" * 70)
    report.append("  SIGNIFY — PIPELINE OUTPUT REPORT")
    report.append(f"  Song: {title} by {artist}")
    report.append(f"  Tempo: {beats['tempo']} BPM | Duration: {beats['duration']}s")
    report.append(f"  Total beats: {len(beats['beats'])} | Lyric segments: {len(segments)}")
    report.append("=" * 70)

    for seg in timeline["segments"]:
        report.append("")
        report.append(f"--- Line {seg['line']} [{seg['start']:.1f}s - {seg['end']:.1f}s] ---")
        report.append(f"  Lyric:  {seg['lyric']}")
        report.append(f"  Mood:   {seg['mood']}")
        report.append(f"  Beats:  {len(seg['beats'])} in this segment")

        gloss_str = " ".join(t["gloss"] for t in seg["tokens"])
        report.append(f"  ASL:    {gloss_str}")

        report.append(f"  Signs:")
        for tok in seg["tokens"]:
            if tok["type"] == "sign":
                report.append(f"    [{tok['start']:.1f}s-{tok['end']:.1f}s] {tok['gloss']} -> {tok['file']}")
            else:
                letters = "".join(l["letter"] for l in tok.get("letters", []))
                report.append(f"    [{tok['start']:.1f}s-{tok['end']:.1f}s] {tok['gloss']} -> fingerspell: {letters}")

    report_text = "\n".join(report)

    with open("data/timelines/ordinary_report.txt", "w") as f:
        f.write(report_text)

    print(f"  Saved: data/timelines/ordinary_report.txt")
    print("\n" + report_text)


if __name__ == "__main__":
    main()
