interface Props {
  beatPulse: boolean
  mood: string
  moodBg: string
  moodGlow: string
}

export function BeatVisualizer({ beatPulse, mood, moodBg, moodGlow }: Props) {
  return (
    <div className="beat-visualizer">
      <div
        className={`beat-ring ${beatPulse ? 'beat-ring--pulse' : ''}`}
        style={{
          borderColor: moodGlow,
          boxShadow: beatPulse ? `0 0 40px ${moodGlow}, inset 0 0 40px ${moodGlow}33` : 'none',
        }}
      />
      <div className="beat-mood-label" style={{ color: moodGlow }}>
        {mood}
      </div>
    </div>
  )
}
