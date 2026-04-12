import type { Token } from '../types'

interface Props {
  token: Token | null
  beatPulse: boolean
  moodGlow: string
}

export function SignDisplay({ token, beatPulse, moodGlow }: Props) {
  if (!token) {
    return (
      <div className="sign-display sign-display--empty">
        <div className="sign-placeholder">SIGNIFY</div>
      </div>
    )
  }

  return (
    <div
      className={`sign-display ${beatPulse ? 'sign-display--pulse' : ''}`}
      style={{ boxShadow: beatPulse ? `0 0 60px ${moodGlow}` : `0 0 20px ${moodGlow}44` }}
    >
      {token.type === 'sign' && token.file ? (
        <video
          key={token.file}
          className="sign-video"
          src={`/signs/${token.file}`}
          autoPlay
          muted
          playsInline
        />
      ) : (
        <div className="fingerspell">
          {token.letters?.map((l, i) => (
            <span key={i} className="fingerspell-letter">
              {l.letter.toUpperCase()}
            </span>
          ))}
        </div>
      )}
      <div className="sign-gloss">{token.gloss}</div>
    </div>
  )
}
