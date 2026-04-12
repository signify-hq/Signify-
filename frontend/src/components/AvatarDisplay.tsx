import { useRef, useEffect, useState } from 'react'
import type { Token } from '../types'

// MediaPipe landmark connections
const BODY_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
]
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
]

interface PoseFrame {
  pose: number[][]
  left_hand: number[][]
  right_hand: number[][]
}
interface PoseData {
  fps: number
  width: number
  height: number
  frames: PoseFrame[]
}
interface Props {
  token: Token | null
  beatPulse: boolean
  moodGlow: string
  moodBg: string
  currentTime: number
}

// ---------------------------------------------------------------------------
// Pose cache
// ---------------------------------------------------------------------------

const poseCache: Record<string, PoseData | null> = {}

async function loadPose(gloss: string): Promise<PoseData | null> {
  const key = gloss.toLowerCase()
  if (key in poseCache) return poseCache[key]
  try {
    // Try exact match first
    let res = await fetch(`/api/pose/${key}`)
    // If not found and ends with 's', try without trailing 's' (plural → singular)
    if (!res.ok && key.endsWith('s') && key.length > 2) {
      const singular = key.slice(0, -1)
      res = await fetch(`/api/pose/${singular}`)
      if (res.ok) {
        const data = await res.json()
        poseCache[key] = data
        return data
      }
    }
    if (!res.ok) { poseCache[key] = null; return null }
    const data = await res.json()
    poseCache[key] = data
    return data
  } catch { poseCache[key] = null; return null }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawFrame(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  srcW: number,
  srcH: number,
  cW: number,
  cH: number,
  color: string,
  glowColor: string,
  pulse: boolean,
) {
  ctx.clearRect(0, 0, cW, cH)

  // Scale & center
  const sc = Math.min(cW / srcW, cH / srcH) * 0.75
  const ox = (cW - srcW * sc) / 2
  const oy = (cH - srcH * sc) / 2 + 20

  // Body landmarks are in pixel coords, hand landmarks are normalized 0-1
  const tx = (x: number, y: number): [number, number] => [x * sc + ox, y * sc + oy]
  const txHand = (x: number, y: number): [number, number] => [x * srcW * sc + ox, y * srcH * sc + oy]

  // Glow effect
  ctx.shadowColor = glowColor
  ctx.shadowBlur = pulse ? 25 : 12

  // Body connections — thick rounded lines
  ctx.strokeStyle = color
  ctx.lineWidth = pulse ? 5 : 4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const [a, b] of BODY_CONNECTIONS) {
    const pa = frame.pose[a], pb = frame.pose[b]
    if (!pa || !pb) continue
    const [x1, y1] = tx(pa[0], pa[1])
    const [x2, y2] = tx(pb[0], pb[1])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // Body joints
  ctx.fillStyle = color
  for (let i = 11; i <= 24; i++) {
    const p = frame.pose[i]
    if (!p) continue
    const [x, y] = tx(p[0], p[1])
    ctx.beginPath()
    ctx.arc(x, y, pulse ? 6 : 5, 0, Math.PI * 2)
    ctx.fill()
  }

  // Head circle
  const nose = frame.pose[0]
  if (nose) {
    const [hx, hy] = tx(nose[0], nose[1])
    ctx.beginPath()
    ctx.arc(hx, hy - 18, 28, 0, Math.PI * 2)
    ctx.lineWidth = 3
    ctx.strokeStyle = color
    ctx.stroke()
  }

  // Hands — detailed with all 21 landmarks
  ctx.shadowBlur = pulse ? 18 : 8

  const drawHand = (landmarks: number[][], handColor: string) => {
    if (!landmarks || landmarks.length < 21) return
    const allZero = landmarks.every(lm => lm[0] === 0 && lm[1] === 0)
    if (allZero) return

    // Connections
    ctx.strokeStyle = handColor
    ctx.lineWidth = pulse ? 3 : 2.5
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = landmarks[a], pb = landmarks[b]
      if (!pa || !pb) continue
      const [x1, y1] = txHand(pa[0], pa[1])
      const [x2, y2] = txHand(pb[0], pb[1])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }

    // Joints
    ctx.fillStyle = handColor
    for (const p of landmarks) {
      if (!p) continue
      const [x, y] = txHand(p[0], p[1])
      ctx.beginPath()
      ctx.arc(x, y, pulse ? 3.5 : 3, 0, Math.PI * 2)
      ctx.fill()
    }

    // Fingertips — brighter dots
    ctx.fillStyle = '#fff'
    for (const tip of [4, 8, 12, 16, 20]) {
      const p = landmarks[tip]
      if (!p) continue
      const [x, y] = txHand(p[0], p[1])
      ctx.beginPath()
      ctx.arc(x, y, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawHand(frame.left_hand, glowColor)
  drawHand(frame.right_hand, glowColor)

  // Reset shadow
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AvatarDisplay({ token, beatPulse, moodGlow, moodBg, currentTime }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [poseData, setPoseData] = useState<PoseData | null>(null)
  const [gloss, setGloss] = useState('')
  const animRef = useRef<number>(0)
  const frameRef = useRef(0)
  const tokenStartRef = useRef(0)

  // Load pose data when token changes
  useEffect(() => {
    if (!token || token.type !== 'sign') {
      setPoseData(null)
      setGloss(token?.gloss || '')
      return
    }
    setGloss(token.gloss)
    tokenStartRef.current = token.start
    frameRef.current = 0
    loadPose(token.gloss).then(setPoseData)
  }, [token?.gloss, token?.start])

  // Animation loop
  useEffect(() => {
    if (!poseData || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const total = poseData.frames.length
    const tokenDur = token ? Math.max(0.1, token.end - token.start) : 1
    const interval = Math.max(16, (tokenDur * 1000) / total)

    function render() {
      if (!ctx || !poseData) return
      const f = poseData.frames[frameRef.current % total]
      drawFrame(ctx, f, poseData.width, poseData.height, canvas.width, canvas.height, moodGlow, moodGlow, beatPulse)
      frameRef.current++
      animRef.current = window.setTimeout(render, interval)
    }

    render()
    return () => clearTimeout(animRef.current)
  }, [poseData, moodGlow, beatPulse, token?.start])

  // Fingerspell fallback
  if (token?.type === 'fingerspell') {
    return (
      <div className="sign-display" style={{ boxShadow: `0 0 30px ${moodGlow}44` }}>
        <div className="fingerspell">
          {token.letters?.map((l, i) => (
            <div key={i} className="fingerspell-letter" style={{ borderColor: moodGlow }}>
              {l.letter}
            </div>
          ))}
        </div>
        <div className="sign-gloss" style={{ color: moodGlow }}>
          {token.gloss.toUpperCase()}
        </div>
      </div>
    )
  }

  const hasPose = poseData && poseData.frames.length > 0

  return (
    <div
      className="sign-display"
      style={{
        boxShadow: beatPulse
          ? `0 0 60px ${moodGlow}, inset 0 0 30px ${moodGlow}22`
          : `0 0 20px ${moodGlow}44`,
        background: `radial-gradient(ellipse at center, ${moodBg}15 0%, #1e293b 70%)`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Logo watermark behind skeleton */}
      <img
        src="/logo.png"
        alt=""
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -55%)',
          width: 200,
          height: 200,
          objectFit: 'contain',
          opacity: beatPulse ? 0.12 : 0.07,
          pointerEvents: 'none',
          transition: 'opacity 0.15s ease',
          filter: 'saturate(0.6)',
        }}
      />
      {hasPose ? (
        <canvas
          ref={canvasRef}
          width={360}
          height={300}
          className="avatar-canvas"
          style={{ position: 'relative', zIndex: 1 }}
        />
      ) : (
        <div style={{
          width: 360, height: 300,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: gloss.length > 8 ? 28 : 42,
          fontWeight: 800, letterSpacing: 4, color: moodGlow,
          opacity: 0.6, textAlign: 'center', padding: 20,
          position: 'relative', zIndex: 1,
        }}>
          {gloss ? gloss.toUpperCase() : ''}
        </div>
      )}
      <div className="sign-gloss" style={{ color: moodGlow, position: 'relative', zIndex: 1 }}>
        {gloss ? gloss.toUpperCase() : 'LISTENING...'}
      </div>
    </div>
  )
}
