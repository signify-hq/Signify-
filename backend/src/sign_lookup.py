import json
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
DICT_PATH = os.path.join(DATA_DIR, "asl_dictionary.json")
SIGNS_DIR = os.path.join(DATA_DIR, "signs")

ALPHABET = {c: f"fs_{c}.png" for c in "abcdefghijklmnopqrstuvwxyz"}


def load_dictionary() -> dict:
    with open(DICT_PATH) as f:
        return json.load(f)


def _find_key(token: str, dictionary: dict):
    """Try exact match, then strip common suffixes (ASL doesn't inflect)."""
    key = token.upper()
    if key in dictionary:
        return key
    for suffix in ["S", "ES", "ED", "ING", "LY", "ER", "EST"]:
        stripped = key.removesuffix(suffix)
        if stripped != key and stripped in dictionary:
            return stripped
    return None


def lookup(gloss_tokens: list) -> list:
    dictionary = load_dictionary()
    results = []
    for token in gloss_tokens:
        key = _find_key(token, dictionary)
        if key:
            filepath = os.path.join(SIGNS_DIR, dictionary[key])
            results.append({
                "gloss": token,
                "file": dictionary[key],
                "found": os.path.exists(filepath),
                "type": "sign",
            })
        else:
            # fingerspell fallback
            letters = []
            for ch in token.lower():
                if ch.isalpha():
                    letters.append({
                        "letter": ch,
                        "file": ALPHABET.get(ch, None),
                    })
            results.append({
                "gloss": token,
                "letters": letters,
                "found": False,
                "type": "fingerspell",
            })
    return results


if __name__ == "__main__":
    test_tokens = ["LOVE", "YOU", "ANGELS", "SANCTUARY", "HALLELUJAH", "SHATTER"]
    results = lookup(test_tokens)
    print(json.dumps(results, indent=2))
    found = sum(1 for r in results if r["found"])
    print(f"\n{found}/{len(results)} found, {len(results) - found} will fingerspell")
