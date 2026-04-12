import { useRef, useEffect, useState, Component, type ReactNode } from 'react'
import type { Token } from '../types'
import { VrmAvatar, type PoseData } from './VrmAvatar'

// MediaPipe Holistic pose landmark connections for body
const POSE_CONNECTIONS = [
  [11, 12], // shoulders
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 23], [12, 24], // torso
  [23, 24], // hips
]

// Hand connections
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [0, 9], [9, 10], [10, 11], [11, 12],  // middle
  [0, 13], [13, 14], [14, 15], [15, 16], // ring
  [0, 17], [17, 18], [18, 19], [19, 20], // pinky
  [5, 9], [9, 13], [13, 17],            // palm
]

interface Props {
  token: Token | null
  beatPulse: boolean
  moodGlow: string
  moodBg: string
  currentTime: number
}

// ---------------------------------------------------------------------------
// Pose cache & loader
// ---------------------------------------------------------------------------

const poseCache: Record<string, PoseData | null> = {}

async function loadPose(gloss: string): Promise<PoseData | null> {
  const key = gloss.toLowerCase().replace(/s$/, '')
  if (key in poseCache) return poseCache[key]

  try {
    const res = await fetch(`/api/pose/${key}`)
    if (!res.ok) {
      poseCache[key] = null
      return null
    }
    const data = await res.json()
    poseCache[key] = data
    return data
  } catch {
    poseCache[key] = null
    return null
  }
}

// ---------------------------------------------------------------------------
// Error boundary — catches VRM/Three.js crashes, triggers fallback
// ---------------------------------------------------------------------------

class VrmErrorBoundary extends Component<
  { children: ReactNode; onError: (err: string) => void },
  { hasError: boolean; errorMsg: string }
> {
  state = { hasError: false, errorMsg: '' }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, errorMsg: err.message }
  }
  componentDidCatch(err: Error) {
    console.error('VRM CRASH:', err)
    this.props.onError(err.message)
  }
  render() {
    if (this.state.hasError) {
      return <div style={{ color: '#f66', fontSize: 10, padding: 8, fontFamily: 'monospace', wordBreak: 'break-all' }}>VRM CRASH: {this.state.errorMsg}</div>
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// Stick-figure canvas fallback
// ---------------------------------------------------------------------------

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: { pose: number[][]; left_hand: number[][]; right_hand: number[][] },
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  color: string,
) {
  const scaleX = canvasW / srcW
  const scaleY = canvasH / srcH
  const scale = Math.min(scaleX, scaleY) * 0.8
  const offsetX = (canvasW - srcW * scale) / 2
  const offsetY = (canvasH - srcH * scale) / 2 + 20

  function tx(x: number, y: number): [number, number] {
    return [x * scale + offsetX, y * scale + offsetY]
  }

  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (const [a, b] of POSE_CONNECTIONS) {
    const pa = frame.pose[a]
    const pb = frame.pose[b]
    if (!pa || !pb || (pa[3] < 0.3 && pb[3] < 0.3)) continue
    const [x1, y1] = tx(pa[0], pa[1])
    const [x2, y2] = tx(pb[0], pb[1])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  ctx.fillStyle = color
  for (let i = 11; i <= 24; i++) {
    const p = frame.pose[i]
    if (!p || p[3] < 0.3) continue
    const [x, y] = tx(p[0], p[1])
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  const nose = frame.pose[0]
  if (nose && nose[3] > 0.3) {
    const [hx, hy] = tx(nose[0], nose[1])
    ctx.beginPath()
    ctx.arc(hx, hy - 15, 25, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.stroke()
  }

  function drawHand(landmarks: number[][]) {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = landmarks[a]
      const pb = landmarks[b]
      if (!pa || !pb || (pa[0] === 0 && pa[1] === 0)) continue
      const [x1, y1] = tx(pa[0], pa[1])
      const [x2, y2] = tx(pb[0], pb[1])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    ctx.fillStyle = color
    for (const p of landmarks) {
      if (!p || (p[0] === 0 && p[1] === 0)) continue
      const [x, y] = tx(p[0], p[1])
      ctx.beginPath()
      ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawHand(frame.left_hand)
  drawHand(frame.right_hand)
}

function StickFigure({
  poseData,
  token,
  moodGlow,
}: {
  poseData: PoseData
  token: Token
  moodGlow: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    const totalFrames = poseData.frames.length
    const tokenMs = Math.max(100, (token.end - token.start) * 1000)
    const interval = Math.max(16, tokenMs / totalFrames)

    function render() {
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawSkeleton(
        ctx,
        poseData.frames[frame % totalFrames],
        poseData.width,
        poseData.height,
        canvas.width,
        canvas.height,
        moodGlow,
      )
      frame++
      animRef.current = window.setTimeout(render, interval)
    }

    render()
    return () => clearTimeout(animRef.current)
  }, [poseData, moodGlow, token.gloss, token.start])

  return <canvas ref={canvasRef} className="avatar-canvas" width={160} height={280} />
}

// ---------------------------------------------------------------------------
// DEBUG: side-by-side skeleton + VRM, single sign looping
// ---------------------------------------------------------------------------

const TEST_SIGN = 'make' // big arm motion (88° Z-range)
const LOOP_DURATION = 3  // seconds per loop

function LoopingVrm({ poseData, moodGlow }: { poseData: PoseData; moodGlow: string }) {
  return (
    <VrmAvatar
      poseData={poseData}
      tokenStart={0}
      tokenEnd={LOOP_DURATION}
      currentTime={0}
      moodGlow={moodGlow}
    />
  )
}

export function AvatarDisplay({ token: _token, beatPulse, moodGlow, moodBg, currentTime: _ct }: Props) {
  const [poseData, setPoseData] = useState<PoseData | null>(null)
  const [vrmError, setVrmError] = useState('')

  useEffect(() => {
    loadPose(TEST_SIGN).then((data) => setPoseData(data))
  }, [])

  const hasPose = poseData && poseData.frames.length > 0
  const fakeToken = { gloss: TEST_SIGN, start: 0, end: LOOP_DURATION, type: 'sign' as const } as any

  return (
    <div
      className="sign-display"
      style={{ boxShadow: beatPulse ? `0 0 60px ${moodGlow}` : `0 0 20px ${moodGlow}44` }}
    >
      {hasPose ? (
        <div style={{ display: 'flex', width: '100%', height: '100%', gap: 4, minHeight: 280 }}>
          {/* Skeleton */}
          <div style={{ width: 160, height: 280, position: 'relative', flexShrink: 0 }}>
            <StickFigure poseData={poseData} token={fakeToken} moodGlow={moodGlow} />
            <div style={{ position: 'absolute', bottom: 2, left: 2, color: moodGlow, fontSize: 10, fontWeight: 700 }}>SKELETON</div>
          </div>
          {/* VRM — fixed size, own stacking context to survive layout shifts */}
          <div style={{ width: 200, height: 280, position: 'relative', flexShrink: 0, overflow: 'hidden' }}>
            <LoopingVrm poseData={poseData} moodGlow={moodGlow} />
            <div style={{ position: 'absolute', bottom: 2, right: 2, color: moodGlow, fontSize: 10, fontWeight: 700, zIndex: 5 }}>VRM</div>
          </div>
        </div>
      ) : (
        <div className="sign-placeholder">LOADING {TEST_SIGN.toUpperCase()}...</div>
      )}
      <div className="sign-gloss" style={{ color: moodGlow }}>
        {TEST_SIGN.toUpperCase()} (loop test)
      </div>
    </div>
  )
}
