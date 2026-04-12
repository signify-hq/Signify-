"""Download ALL missing sign videos for the demo song from WLASL.

Strategy:
1. For the 8 signs with corrupt videos: try every WLASL instance URL until one works
2. For the 36 not-in-WLASL words: search by base form, synonyms, related glosses
3. Convert all new videos to pose JSON via MediaPipe
"""

import json
import os
import ssl
import urllib.request
import subprocess
import sys

WLASL_PATH = "/tmp/wlasl/start_kit/WLASL_v0.3.json"
SIGNS_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "signs")
POSES_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "poses")
DICT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "asl_dictionary.json")

os.makedirs(SIGNS_DIR, exist_ok=True)
os.makedirs(POSES_DIR, exist_ok=True)

# Words that need re-download (corrupt video, no pose)
CORRUPT_SIGNS = ["angel", "die", "drunk", "for", "kiss", "side", "they", "town", "angels"]

# Words not in WLASL — try base forms and synonyms
# Maps our gloss → list of WLASL glosses to try
SYNONYM_MAP = {
    "breath": ["breathe", "breath"],
    "buried": ["bury", "buried"],
    "bury": ["bury", "buried"],
    "clay": ["clay", "dirt", "mud"],
    "dust": ["dust", "dirt"],
    "ecstasy": ["ecstasy", "excited", "thrill"],
    "edge": ["edge", "border", "cliff"],
    "eventually": ["eventually", "finally", "future"],
    "fade": ["fade", "disappear", "vanish"],
    "faith": ["faith", "trust", "believe"],
    "found": ["find", "found", "discover"],
    "gate": ["gate", "door", "fence"],
    "ground": ["ground", "floor", "earth"],
    "hallelujah": ["hallelujah", "praise", "celebrate"],
    "heavenly": ["heaven", "heavenly"],
    "higher": ["high", "higher", "above"],
    "hopeless": ["hopeless", "impossible", "desperate"],
    "lay": ["lay", "lie down", "put down"],
    "lay-down": ["lay", "lie down", "put down"],
    "life": ["life", "live"],
    "masterpiece": ["masterpiece", "art", "perfect"],
    "mundane": ["mundane", "boring", "ordinary"],
    "next-to": ["next to", "beside", "near"],
    "oh": ["oh", "wow"],
    "one-time": ["once", "one time"],
    "ordinary": ["ordinary", "normal", "regular"],
    "return": ["return", "come back", "go back"],
    "run-out": ["run out", "finish", "empty"],
    "sanctuary": ["sanctuary", "safe", "church"],
    "sculptor": ["sculptor", "sculpt", "art"],
    "shatter": ["shatter", "break", "destroy"],
    "so": ["so", "very"],
    "vine": ["vine", "plant", "tree"],
    "watered-down": ["water", "weak", "dilute"],
    "whenever": ["whenever", "anytime", "every time"],
    "altar": ["altar", "church", "worship"],
}


def load_wlasl():
    """Load WLASL and index by lowercase gloss with all instances."""
    with open(WLASL_PATH) as f:
        data = json.load(f)
    lookup = {}
    for entry in data:
        gloss = entry["gloss"].lower()
        urls = []
        for inst in entry["instances"]:
            url = inst.get("url", "")
            if url and "youtube" not in url.lower() and not url.endswith(".swf"):
                urls.append(url)
        if urls:
            lookup[gloss] = urls
    return lookup


def download_file(url, dest, timeout=20):
    """Download a file, return True if successful and file is valid."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            data = resp.read()
            if len(data) < 1000:  # too small to be a real video
                return False
            with open(dest, "wb") as f:
                f.write(data)
        return True
    except Exception:
        return False


def is_valid_video(path):
    """Check if the file is a valid video by probing with ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=10
        )
        return result.returncode == 0 and result.stdout.strip()
    except Exception:
        return False


def convert_to_pose(video_path, output_path):
    """Convert a video to pose JSON using MediaPipe Holistic."""
    try:
        import mediapipe as mp
        import cv2
    except ImportError:
        print("    [!] mediapipe/cv2 not available, skipping pose conversion")
        return False

    try:
        mp_holistic = mp.solutions.holistic
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return False

        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        if width == 0 or height == 0:
            cap.release()
            return False

        all_frames = []
        with mp_holistic.Holistic(
            static_image_mode=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        ) as holistic:
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = holistic.process(rgb)

                fd = {}
                if results.pose_landmarks:
                    fd["pose"] = [
                        (lm.x * width, lm.y * height, lm.z * width, lm.visibility)
                        for lm in results.pose_landmarks.landmark
                    ]
                else:
                    fd["pose"] = [(0, 0, 0, 0)] * 33

                for hand_name, hand_lm in [
                    ("left_hand", results.left_hand_landmarks),
                    ("right_hand", results.right_hand_landmarks),
                ]:
                    if hand_lm:
                        fd[hand_name] = [
                            (lm.x * width, lm.y * height, lm.z * width, 1.0)
                            for lm in hand_lm.landmark
                        ]
                    else:
                        fd[hand_name] = [(0, 0, 0, 0)] * 21

                all_frames.append(fd)

        cap.release()

        if not all_frames:
            return False

        pose_data = {
            "fps": fps,
            "width": width,
            "height": height,
            "frames": [
                {"pose": f["pose"], "left_hand": f["left_hand"], "right_hand": f["right_hand"]}
                for f in all_frames
            ],
        }
        with open(output_path, "w") as f:
            json.dump(pose_data, f)
        return True

    except Exception as e:
        print(f"    [!] Pose conversion error: {e}")
        return False


def main():
    wlasl = load_wlasl()
    print(f"WLASL loaded: {len(wlasl)} glosses with downloadable URLs\n")

    # Load existing dictionary
    if os.path.exists(DICT_PATH):
        with open(DICT_PATH) as f:
            dictionary = json.load(f)
    else:
        dictionary = {}

    downloaded = 0
    converted = 0
    failed = []

    # ---- Phase 1: Re-download corrupt signs (try all instances) ----
    print("=== Phase 1: Re-downloading corrupt signs ===")
    for sign in CORRUPT_SIGNS:
        pose_path = os.path.join(POSES_DIR, f"{sign}.json")
        if os.path.exists(pose_path):
            print(f"  {sign}: already has pose, skipping")
            continue

        key = sign.replace("-", " ")
        urls = wlasl.get(sign, []) or wlasl.get(key, [])
        if not urls:
            # Try base form
            base = sign.rstrip("s")
            urls = wlasl.get(base, []) or wlasl.get(base.replace("-", " "), [])

        if not urls:
            print(f"  {sign}: not in WLASL")
            failed.append(sign)
            continue

        dest = os.path.join(SIGNS_DIR, f"{sign}.mp4")
        print(f"  {sign}: trying {len(urls)} URLs... ", end="", flush=True)

        ok = False
        for i, url in enumerate(urls):
            # Force .mp4 extension for download
            if download_file(url, dest):
                if is_valid_video(dest):
                    print(f"URL #{i+1} OK", end="")
                    ok = True
                    break
                else:
                    os.remove(dest)

        if ok:
            dictionary[sign.upper()] = f"{sign}.mp4"
            downloaded += 1
            # Convert to pose
            print(" → converting... ", end="", flush=True)
            if convert_to_pose(dest, pose_path):
                print("POSE OK")
                converted += 1
            else:
                print("pose failed")
        else:
            print("ALL FAILED")
            failed.append(sign)

    # ---- Phase 2: Download synonym/related signs ----
    print("\n=== Phase 2: Finding signs via synonyms ===")
    for our_word, candidates in sorted(SYNONYM_MAP.items()):
        pose_path = os.path.join(POSES_DIR, f"{our_word}.json")
        if os.path.exists(pose_path):
            print(f"  {our_word}: already has pose, skipping")
            continue

        ok = False
        for candidate in candidates:
            urls = wlasl.get(candidate, []) or wlasl.get(candidate.replace(" ", "-"), [])
            if not urls:
                continue

            dest = os.path.join(SIGNS_DIR, f"{our_word}.mp4")
            print(f"  {our_word} (via '{candidate}'): trying {len(urls)} URLs... ", end="", flush=True)

            for i, url in enumerate(urls):
                if download_file(url, dest):
                    if is_valid_video(dest):
                        print(f"URL #{i+1} OK", end="")
                        ok = True
                        break
                    else:
                        os.remove(dest)

            if ok:
                dictionary[our_word.upper()] = f"{our_word}.mp4"
                downloaded += 1
                print(" → converting... ", end="", flush=True)
                if convert_to_pose(dest, pose_path):
                    print("POSE OK")
                    converted += 1
                else:
                    print("pose failed")
                break

        if not ok:
            print(f"  {our_word}: no working URL found")
            failed.append(our_word)

    # Save dictionary
    with open(DICT_PATH, "w") as f:
        json.dump(dictionary, f, indent=2, sort_keys=True)

    print(f"\n=== SUMMARY ===")
    print(f"Downloaded: {downloaded}")
    print(f"Converted to pose: {converted}")
    print(f"Failed ({len(failed)}): {', '.join(failed)}")
    print(f"Dictionary: {len(dictionary)} entries")
    print(f"Total poses: {len(os.listdir(POSES_DIR))}")


if __name__ == "__main__":
    main()
