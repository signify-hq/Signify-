import anthropic
import os
import json
import re

MOODS = ["joyful", "tender", "sad", "intense", "angry", "hopeful", "playful", "dark"]

SYSTEM_PROMPT = f"""You are an accessibility tool that converts English text into ASL (American Sign Language) gloss notation. This is used to help Deaf and hard-of-hearing individuals experience music through sign language visualization.

Given English text lines, produce ASL gloss — the written notation of sign sequences in ASL word order.

ASL grammar rules:
- Topic-comment structure, not subject-verb-object
- Drop articles (a, the, an)
- Drop "be" verbs (is, am, are, was, were)
- Drop prepositions when spatial context is implied
- Use directional verbs (e.g., "I give you" → "I-GIVE-YOU" as one sign)
- Time markers come first (e.g., "I went yesterday" → "YESTERDAY I GO")

Also classify the emotional tone of each line as one of: {', '.join(MOODS)}

You MUST return ONLY a valid JSON array. No other text, no markdown fences, no explanation.
Format: [{{"line": 1, "english": "...", "gloss": ["SIGN1", "SIGN2"], "mood": "tender"}}]"""

BATCH_SIZE = 8


def _parse_response(text: str) -> list:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0].strip()
    # try to find JSON array in the response
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if match:
        return json.loads(match.group())
    raise ValueError(f"No JSON array found in response: {raw[:200]}")


def translate(lines: list) -> list:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set in .env")
    client = anthropic.Anthropic(api_key=api_key)
    all_results = []

    for i in range(0, len(lines), BATCH_SIZE):
        batch = lines[i:i + BATCH_SIZE]
        prompt = "Convert each line below to ASL gloss notation for accessibility purposes:\n\n"
        for j, line in enumerate(batch):
            prompt += f"{i + j + 1}. {line}\n"
        msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        batch_results = _parse_response(msg.content[0].text)
        all_results.extend(batch_results)

    return all_results


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    test_lines = [
        "They say the holy water's watered down",
        "And this town's lost its faith",
        "Our colors will fade eventually",
        "You're takin' me out of the ordinary",
        "I want you layin' me down 'til we're dead and buried",
        "Breathe and take my breath away",
        "The angels up in the clouds are jealous knowin' we found",
    ]
    result = translate(test_lines)
    print(json.dumps(result, indent=2))
