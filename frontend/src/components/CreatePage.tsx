import { useRef, useEffect, useState, useCallback } from 'react'
import { MOOD_COLORS } from '../types'
import '@mediapipe/holistic'

// ---------------------------------------------------------------------------
// MediaPipe Holistic type (loaded via CDN script in index.html / side-effect import)
// ---------------------------------------------------------------------------

const Holistic = (globalThis as any).Holistic as new (config: {
  locateFile: (file: string) => string
}) => {
  setOptions: (opts: Record<string, unknown>) => void
  onResults: (cb: (results: HolisticResults) => void) => void
  send: (input: { image: HTMLVideoElement | HTMLCanvasElement }) => Promise<void>
  close: () => void
}

type HolisticResults = Record<string, any>

// ---------------------------------------------------------------------------
// Skeleton drawing constants (mirrors AvatarDisplay.tsx)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// drawFrame — same rendering as AvatarDisplay.tsx
// ---------------------------------------------------------------------------

interface PoseFrame {
  pose: number[][]
  left_hand: number[][]
  right_hand: number[][]
}

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

  const sc = Math.min(cW / srcW, cH / srcH) * 0.75
  const ox = (cW - srcW * sc) / 2
  const oy = (cH - srcH * sc) / 2 + 20

  const tx = (x: number, y: number): [number, number] => [x * sc + ox, y * sc + oy]
  const txHand = (x: number, y: number): [number, number] => [x * srcW * sc + ox, y * srcH * sc + oy]

  // Glow
  ctx.shadowColor = glowColor
  ctx.shadowBlur = pulse ? 25 : 12

  // Body connections
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

  // Hands
  ctx.shadowBlur = pulse ? 18 : 8

  const drawHand = (landmarks: number[][], handColor: string) => {
    if (!landmarks || landmarks.length < 21) return
    const allZero = landmarks.every(lm => lm[0] === 0 && lm[1] === 0)
    if (allZero) return

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

    ctx.fillStyle = handColor
    for (const p of landmarks) {
      if (!p) continue
      const [x, y] = txHand(p[0], p[1])
      ctx.beginPath()
      ctx.arc(x, y, pulse ? 3.5 : 3, 0, Math.PI * 2)
      ctx.fill()
    }

    // Fingertips
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

  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'
}

// ---------------------------------------------------------------------------
// Mood selector moods
// ---------------------------------------------------------------------------

const MOODS = Object.keys(MOOD_COLORS) as string[]

// ---------------------------------------------------------------------------
// CreatePage component
// ---------------------------------------------------------------------------

export function CreatePage() {
  const webcamRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const holisticRef = useRef<ReturnType<typeof Holistic> | null>(null)
  const animFrameRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const latestFrameRef = useRef<PoseFrame | null>(null)

  const [status, setStatus] = useState('Initializing webcam...')
  const [mood, setMood] = useState('joyful')
  const [beatPulse, setBeatPulse] = useState(false)

  const colors = MOOD_COLORS[mood] || MOOD_COLORS.joyful

  // Canvas dimensions for skeleton rendering
  const CANVAS_W = 640
  const CANVAS_H = 480

  // Convert MediaPipe results to the PoseFrame format drawFrame expects
  const onResults = useCallback((results: HolisticResults) => {
    const poseLandmarks = results.poseLandmarks
    if (!poseLandmarks || poseLandmarks.length < 25) {
      latestFrameRef.current = null
      return
    }

    // Pose: convert normalized 0-1 to pixel coords (mirrored for webcam)
    const pose: number[][] = poseLandmarks.map((lm: { x: number; y: number; z: number; visibility?: number }) => [
      (1 - lm.x) * CANVAS_W,  // mirror X for webcam
      lm.y * CANVAS_H,
      lm.z * CANVAS_W,
      lm.visibility ?? 1.0,
    ])

    // Hands: normalized 0-1 (mirrored)
    // MediaPipe's rightHandLandmarks is the subject's right hand,
    // which in the mirrored view appears on screen-left.
    // For drawing, we swap left/right to match the mirror.
    const leftHandRaw = results.rightHandLandmarks  // subject's right = mirrored left
    const rightHandRaw = results.leftHandLandmarks   // subject's left = mirrored right

    const convertHand = (lms: Array<{ x: number; y: number; z: number }> | undefined): number[][] => {
      if (!lms || lms.length < 21) return []
      return lms.map(lm => [
        1 - lm.x,  // mirror X
        lm.y,
        lm.z,
        1.0,
      ])
    }

    latestFrameRef.current = {
      pose,
      left_hand: convertHand(leftHandRaw),
      right_hand: convertHand(rightHandRaw),
    }
  }, [])

  // Render loop — draws the skeleton from the latest frame data
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let running = true

    function renderLoop() {
      if (!running) return
      const frame = latestFrameRef.current
      if (frame && ctx) {
        drawFrame(
          ctx, frame,
          CANVAS_W, CANVAS_H,
          canvas!.width, canvas!.height,
          colors.glow, colors.glow, beatPulse,
        )
      }
      requestAnimationFrame(renderLoop)
    }

    requestAnimationFrame(renderLoop)
    return () => { running = false }
  }, [colors.glow, beatPulse])

  // Set up webcam + MediaPipe Holistic
  useEffect(() => {
    let cancelled = false

    async function init() {
      setStatus('Loading MediaPipe Holistic...')
      const holistic = new Holistic({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
      })
      holistic.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      holistic.onResults(onResults)
      holisticRef.current = holistic

      try {
        setStatus('Requesting webcam access...')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        })
        streamRef.current = stream
        const webcam = webcamRef.current
        if (!webcam || cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        webcam.srcObject = stream
        await webcam.play()
        setStatus('Tracking active')

        async function processFrame() {
          if (cancelled) return
          const w = webcamRef.current
          if (w && !w.paused && w.readyState >= 2) {
            try { await holistic.send({ image: w }) } catch {}
          }
          if (!cancelled) animFrameRef.current = requestAnimationFrame(processFrame)
        }
        animFrameRef.current = requestAnimationFrame(processFrame)
      } catch (err) {
        setStatus(`Webcam error: ${(err as Error).message}`)
      }
    }

    init().catch((err) => setStatus(`Error: ${(err as Error).message}`))

    return () => {
      cancelled = true
      cancelAnimationFrame(animFrameRef.current)
      holisticRef.current?.close()
      holisticRef.current = null
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
    }
  }, [onResults])

  // Simulated beat pulse (toggles on a rhythm if no real music)
  useEffect(() => {
    const iv = setInterval(() => {
      setBeatPulse(true)
      setTimeout(() => setBeatPulse(false), 120)
    }, 600)
    return () => clearInterval(iv)
  }, [])

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: `radial-gradient(ellipse at center, ${colors.bg}22 0%, #0a0a0a 70%)`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Back button */}
      <a
        href="/"
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          zIndex: 20,
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 999,
          padding: '8px 16px',
          color: '#94a3b8',
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
          cursor: 'pointer',
        }}
      >
        &larr; Back
      </a>

      {/* Title */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: 0,
        right: 0,
        textAlign: 'center',
        zIndex: 10,
      }}>
        <h1 style={{
          color: colors.glow,
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: 6,
          textTransform: 'uppercase',
          margin: 0,
          textShadow: `0 0 30px ${colors.glow}88`,
        }}>
          Signify Create
        </h1>
        <p style={{
          color: '#888',
          fontSize: 13,
          margin: '4px 0 0',
          letterSpacing: 2,
        }}>
          Move your hands — become the avatar
        </p>
      </div>

      {/* Status indicator */}
      <div style={{
        position: 'absolute',
        top: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.6)',
        padding: '4px 16px',
        borderRadius: 20,
        fontSize: 12,
        color: status === 'Tracking active' ? '#4ade80' : '#facc15',
        fontFamily: 'monospace',
        zIndex: 10,
      }}>
        {status}
      </div>

      {/* Large skeleton canvas */}
      <div style={{
        position: 'relative',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: beatPulse
          ? `0 0 60px ${colors.glow}, inset 0 0 40px ${colors.glow}22`
          : `0 0 20px ${colors.glow}44`,
        border: `1px solid ${colors.glow}33`,
        transition: 'box-shadow 0.1s ease',
      }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{
            display: 'block',
            width: 640,
            height: 480,
            background: `radial-gradient(ellipse at center, ${colors.bg}10 0%, #111827 70%)`,
          }}
        />
      </div>

      {/* Webcam preview — small, bottom-right corner */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        right: 20,
        width: 180,
        height: 135,
        borderRadius: 12,
        overflow: 'hidden',
        border: `2px solid ${colors.glow}55`,
        boxShadow: `0 0 20px ${colors.glow}33`,
        zIndex: 10,
      }}>
        <video
          ref={webcamRef}
          muted
          playsInline
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)',
          }}
        />
      </div>

      {/* Mood selector — bottom center */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 8,
        zIndex: 10,
      }}>
        {MOODS.map(m => {
          const mc = MOOD_COLORS[m]
          const isActive = m === mood
          return (
            <button
              key={m}
              onClick={() => setMood(m)}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: isActive ? '3px solid #fff' : '2px solid transparent',
                background: mc.bg,
                cursor: 'pointer',
                boxShadow: isActive ? `0 0 16px ${mc.glow}` : 'none',
                transition: 'all 0.15s ease',
                position: 'relative',
              }}
              title={m}
            />
          )
        })}
      </div>

      {/* Mood label */}
      <div style={{
        position: 'absolute',
        bottom: 64,
        left: '50%',
        transform: 'translateX(-50%)',
        color: colors.glow,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 3,
        textTransform: 'uppercase',
        zIndex: 10,
      }}>
        {mood}
      </div>
    </div>
  )
}
