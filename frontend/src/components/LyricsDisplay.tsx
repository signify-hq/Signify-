import type { Timeline, Segment } from '../types'
import { MOOD_COLORS } from '../types'
import { useRef, useEffect } from 'react'

interface Props {
  timeline: Timeline
  currentSegment: Segment | null
  currentTime: number
}

export function LyricsDisplay({ timeline, currentSegment, currentTime }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!currentSegment || !containerRef.current) return
    const el = containerRef.current.querySelector(`[data-line="${currentSegment.line}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentSegment])

  return (
    <div className="lyrics-display" ref={containerRef}>
      {timeline.segments.map((seg) => {
        const active = currentSegment?.line === seg.line
        const past = currentTime > seg.end
        const colors = MOOD_COLORS[seg.mood] || MOOD_COLORS.tender
        return (
          <div
            key={seg.line}
            data-line={seg.line}
            className={`lyric-line ${active ? 'lyric-line--active' : ''} ${past ? 'lyric-line--past' : ''}`}
            style={active ? { color: colors.glow } : undefined}
          >
            {seg.lyric}
          </div>
        )
      })}
    </div>
  )
}
