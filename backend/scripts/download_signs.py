"""Download ASL sign videos from WLASL dataset for our gloss tokens."""
import json
import os
import urllib.request
import ssl

WLASL_PATH = "/tmp/wlasl/start_kit/WLASL_v0.3.json"
SIGNS_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "signs")

OUR_SIGNS = [
    "after", "angel", "away", "black", "breathe", "cloud", "color", "day",
    "dead", "die", "down", "drunk", "find", "for", "future", "have", "heaven",
    "holy", "how", "i", "if", "jealous", "kiss", "knife", "know", "light",
    "look-at", "lord", "lose", "love", "make", "me", "must", "my", "on", "our",
    "out", "pray", "say", "see", "side", "something", "stay", "take", "than",
    "they", "think", "this", "time", "touch", "town", "until", "up", "want",
    "water", "we", "white", "will", "world", "you", "your",
]


def load_wlasl():
    with open(WLASL_PATH) as f:
        data = json.load(f)
    lookup = {}
    for entry in data:
        gloss = entry["gloss"].lower()
        # prefer mp4 URLs, skip swf/youtube
        for inst in entry["instances"]:
            url = inst.get("url", "")
            if url.endswith(".mp4"):
                lookup[gloss] = url
                break
        else:
            # no mp4 found, try any non-youtube non-swf URL
            for inst in entry["instances"]:
                url = inst.get("url", "")
                if url and "youtube" not in url and not url.endswith(".swf"):
                    lookup[gloss] = url
                    break
    return lookup


def download_file(url, dest):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            with open(dest, "wb") as f:
                f.write(resp.read())
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False


def main():
    os.makedirs(SIGNS_DIR, exist_ok=True)
    wlasl = load_wlasl()
    dictionary = {}
    skipped = []

    print(f"Downloading sign videos...\n")
    downloaded = 0
    for sign in OUR_SIGNS:
        key = sign.replace("-", " ")
        url = wlasl.get(sign) or wlasl.get(key)
        if not url:
            skipped.append(sign)
            continue

        filename = f"{sign}.mp4"
        dest = os.path.join(SIGNS_DIR, filename)

        if os.path.exists(dest):
            print(f"  EXISTS {sign}")
            dictionary[sign.upper()] = filename
            downloaded += 1
            continue

        print(f"  Downloading {sign}... ", end="", flush=True)
        if download_file(url, dest):
            print("OK")
            dictionary[sign.upper()] = filename
            downloaded += 1
        else:
            skipped.append(sign)
            if os.path.exists(dest):
                os.remove(dest)

    # save dictionary
    dict_path = os.path.join(SIGNS_DIR, "..", "asl_dictionary.json")
    if os.path.exists(dict_path):
        with open(dict_path) as f:
            existing = json.load(f)
        existing.update(dictionary)
        dictionary = existing

    with open(dict_path, "w") as f:
        json.dump(dictionary, f, indent=2, sort_keys=True)

    print(f"\nDownloaded: {downloaded}")
    print(f"Skipped (will fingerspell): {len(skipped)}")
    if skipped:
        print(f"  {', '.join(skipped)}")
    print(f"Dictionary: {len(dictionary)} entries")


if __name__ == "__main__":
    main()
