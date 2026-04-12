interface Props {
  playing: boolean
  currentTime: number
  duration: number
  onPlay: () => void
  onPause: () => void
  onSeek: (t: number) => void
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function Controls({ playing, currentTime, duration, onPlay, onPause, onSeek }: Props) {
  return (
    <div className="controls">
      <button className="controls-btn" onClick={playing ? onPause : onPlay}>
        {playing ? '⏸' : '▶'}
      </button>
      <span className="controls-time">{formatTime(currentTime)}</span>
      <input
        type="range"
        className="controls-scrubber"
        min={0}
        max={duration}
        step={0.1}
        value={currentTime}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
      />
      <span className="controls-time">{formatTime(duration)}</span>
    </div>
  )
}
