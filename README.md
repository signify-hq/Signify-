# Signify
# Signify – AI-Powered Music-to-ASL Translation Platform

## Overview

Signify is an accessibility-focused application that transforms music into synchronized American Sign Language (ASL) visualizations. Given a song, the system analyzes audio, extracts lyrics and timing information, translates lyrics into ASL gloss notation using a large language model, matches gloss tokens to sign-language assets, and generates a timeline that can be rendered by a frontend application.

The goal is to help Deaf and hard-of-hearing individuals experience music through a visual representation of rhythm, lyrics, emotion, and sign language.

---

## Features

* Upload audio files through a REST API
* Detect song tempo and beat locations
* Extract lyrics and timestamps using Whisper speech recognition
* Retrieve official lyrics through the Genius API when available
* Translate English lyrics into ASL gloss notation using Anthropic Claude
* Classify emotional tone for each lyric segment
* Match gloss tokens to ASL sign assets
* Automatically generate fingerspelling fallbacks for unknown signs
* Produce synchronized timeline JSON for frontend playback and visualization

---

## System Architecture

The application processes songs through a multi-stage pipeline:

1. Audio Upload

   * User uploads an audio file through FastAPI.

2. Beat Detection

   * Librosa analyzes the song to determine tempo and beat positions.

3. Lyric Processing

   * Whisper generates lyric timestamps.
   * Genius lyrics are optionally fetched and aligned with the audio.

4. ASL Translation

   * Anthropic Claude converts lyrics into ASL gloss notation.
   * Emotional tone is identified for each lyric segment.

5. Sign Resolution

   * Gloss tokens are matched against an ASL dictionary.
   * Unknown terms are automatically fingerspelled.

6. Timeline Generation

   * Beats, lyrics, gloss tokens, moods, and sign assets are merged into a unified timeline structure.

7. Output

   * Timeline data is stored as JSON and served through API endpoints for frontend consumption.

---

## Technology Stack

### Backend

* Python
* FastAPI

### AI & Machine Learning

* OpenAI Whisper
* Anthropic Claude API

### Audio Processing

* Librosa
* NumPy

### External Services

* Genius Lyrics API

### Data Storage

* JSON-based timeline generation
* Local file storage

---

## Example Output

Each processed song produces a timeline containing:

* Song metadata
* Tempo and beat information
* Timestamped lyric segments
* ASL gloss translations
* Emotional classifications
* Sign-language asset references
* Fingerspelling fallbacks

Example:

```json
{
  "line": 1,
  "lyric": "I love you",
  "mood": "tender",
  "tokens": [
    {
      "gloss": "LOVE",
      "start": 0.50,
      "end": 1.20,
      "file": "love.mp4"
    }
  ]
}
```

---

## Key Engineering Challenges

* Aligning official song lyrics with speech-recognition timestamps
* Converting natural language into ASL gloss while preserving meaning
* Synchronizing sign timing with lyric timing and musical rhythm
* Handling missing vocabulary through automated fingerspelling
* Designing a modular pipeline that allows independent testing of each processing stage

---

## Future Improvements

* Real-time processing and streaming support
* 3D avatar sign-language rendering
* Expanded ASL dictionary coverage
* User-generated sign libraries
* Cloud deployment and scalable storage
* Frontend visualization dashboard
* Support for additional sign languages

---

## Motivation

Music is often experienced through sound, making it difficult for Deaf and hard-of-hearing individuals to fully engage with lyrical and emotional content. Signify explores how AI, speech recognition, audio analysis, and language models can be combined to create a more accessible and inclusive music experience.
