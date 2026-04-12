export interface Token {
  gloss: string
  start: number
  end: number
  type: 'sign' | 'fingerspell'
  file?: string
  letters?: { letter: string; file: string | null }[]
}

export interface Segment {
  line: number
  start: number
  end: number
  lyric: string
  mood: string
  tokens: Token[]
  beats: number[]
}

export interface Timeline {
  duration: number
  tempo: number
  beats: number[]
  segments: Segment[]
}

export type Mood = 'joyful' | 'tender' | 'sad' | 'intense' | 'angry' | 'hopeful' | 'playful' | 'dark'

export const MOOD_COLORS: Record<string, { bg: string; glow: string; text: string }> = {
  joyful:  { bg: '#fbbf24', glow: '#f59e0b', text: '#78350f' },
  tender:  { bg: '#f9a8d4', glow: '#ec4899', text: '#831843' },
  sad:     { bg: '#93c5fd', glow: '#3b82f6', text: '#1e3a5f' },
  intense: { bg: '#f87171', glow: '#ef4444', text: '#7f1d1d' },
  angry:   { bg: '#dc2626', glow: '#b91c1c', text: '#fef2f2' },
  hopeful: { bg: '#a7f3d0', glow: '#34d399', text: '#064e3b' },
  playful: { bg: '#c4b5fd', glow: '#8b5cf6', text: '#4c1d95' },
  dark:    { bg: '#475569', glow: '#334155', text: '#f1f5f9' },
}
