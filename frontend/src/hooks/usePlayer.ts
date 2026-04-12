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

  const lastBeatRef = useRef(-1)

  const tick = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !timeline) return

    const t = audio.currentTime
    setCurrentTime(t)

    // find current segment
    const seg = timeline.segments.find(s => t >= s.start && t <= s.end) || null
    setCurrentSegment(seg)

    // find current token within segment
    if (seg) {
      const tok = seg.tokens.find(tk => t >= tk.start && t <= tk.end) || null
      setCurrentToken(tok)
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
