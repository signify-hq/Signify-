import { useRef, useState, useCallback, useEffect } from 'react'
import type { Timeline, Segment, Token } from '../types'

export function usePlayer(timeline: Timeline | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number>(0)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [currentSegment, setCurrentSegment] = useState<Segment | null>(null)
  const [currentToken, setCurrentToken] = useState<Token | null>(null)
  const [beatPulse, setBeatPulse] = useState(false)

  // Web Audio API analyser for real-time frequency data
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)

  const lastBeatRef = useRef(-1)

  const tick = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !timeline) return

    const t = audio.currentTime
    setCurrentTime(t)

    // find current segment
    const seg = timeline.segments.find(s => t >= s.start && t <= s.end) || null
    setCurrentSegment(seg)

    // find current token within segment — enforce minimum display time
    // so fast gloss sequences don't rush through visually
    const MIN_TOKEN_DISPLAY = 0.7 // seconds
    if (seg) {
      const tok = seg.tokens.find(tk => t >= tk.start && t <= tk.end) || null
      if (tok) {
        const tokDur = tok.end - tok.start
        if (tokDur < MIN_TOKEN_DISPLAY) {
          // Short token: only switch if we've been showing the previous one long enough
          setCurrentToken(prev => {
            if (!prev || prev.gloss !== tok.gloss) {
              // Check if previous token has been visible long enough
              if (prev && (t - prev.start) < MIN_TOKEN_DISPLAY) return prev
            }
            return tok
          })
        } else {
          setCurrentToken(tok)
        }
      } else {
        setCurrentToken(null)
      }
    } else {
      setCurrentToken(null)
    }

    // beat detection — find nearest beat
    const beatIdx = timeline.beats.findIndex((b, i) => {
      const next = timeline.beats[i + 1] ?? Infinity
      return t >= b - 0.05 && t < next - 0.05
    })
    if (beatIdx !== -1 && beatIdx !== lastBeatRef.current) {
      lastBeatRef.current = beatIdx
      setBeatPulse(true)
      setTimeout(() => setBeatPulse(false), 150)
    }

    if (!audio.paused) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [timeline])

  const play = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    // Set up Web Audio analyser on first play
    if (!audioCtxRef.current) {
      const ctx = new AudioContext()
      const source = ctx.createMediaElementSource(audio)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256 // 128 frequency bins — fast and enough resolution
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      analyser.connect(ctx.destination)
      audioCtxRef.current = ctx
      sourceRef.current = source
      analyserRef.current = analyser
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }

    audio.play()
    setPlaying(true)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  const pause = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    setPlaying(false)
    cancelAnimationFrame(rafRef.current)
  }, [])

  const seek = useCallback((t: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = t
    setCurrentTime(t)
    lastBeatRef.current = -1
  }, [])

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return {
    audioRef,
    analyserRef,
    playing,
    currentTime,
    currentSegment,
    currentToken,
    beatPulse,
    play,
    pause,
    seek,
  }
}
