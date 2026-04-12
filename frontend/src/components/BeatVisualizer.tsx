import { useRef, useEffect, useCallback } from 'react'

interface Props {
  beatPulse: boolean
  mood: string
  moodBg: string
  moodGlow: string
  analyser: AnalyserNode | null
}

/* ---------- helpers ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

/* ---------- audio energy extraction ---------- */

interface AudioEnergy {
  bass: number     // 0-1: sub-bass + bass (20-250 Hz) — kick drums, bass drops
  mid: number      // 0-1: mids (250-2000 Hz) — vocals, snare body
  high: number     // 0-1: highs (2000-16000 Hz) — hi-hats, cymbals, sizzle
  overall: number  // 0-1: total energy
}

function getAudioEnergy(analyser: AnalyserNode, freqData: Uint8Array): AudioEnergy {
  analyser.getByteFrequencyData(freqData)
  const len = freqData.length // 128 bins for fftSize=256
  // Each bin = sampleRate / fftSize Hz wide. At 44100Hz, each bin ~ 172Hz
  // bass: bins 0-1 (~0-344 Hz), mid: bins 2-11 (~344-2064 Hz), high: bins 12+ (~2064Hz+)
  const bassEnd = 2
  const midEnd = 12

  let bassSum = 0, midSum = 0, highSum = 0, total = 0
  for (let i = 0; i < len; i++) {
    const v = freqData[i] / 255
    total += v
    if (i < bassEnd) bassSum += v
    else if (i < midEnd) midSum += v
    else highSum += v
  }

  return {
    bass: Math.min(1, bassSum / bassEnd),
    mid: Math.min(1, midSum / (midEnd - bassEnd) * 1.2),
    high: Math.min(1, highSum / (len - midEnd) * 2.5),
    overall: Math.min(1, total / len * 2),
  }
}

/* ---------- particle types ---------- */

const enum ParticleKind {
  Burst = 0,
  Spiral = 1,
  Float = 2,
  Spark = 3,
}

interface Particle {
  alive: boolean
  kind: ParticleKind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  angle: number
  angularV: number
  radialV: number
  radius: number
  color: [number, number, number]
  alpha: number
  trail: boolean
  prevX: number
  prevY: number
}

interface Shockwave {
  x: number
  y: number
  radius: number
  maxRadius: number
  life: number
  color: [number, number, number]
  lineWidth: number
}

/* ---------- pool ---------- */

const MAX_PARTICLES = 400
const MAX_SHOCKWAVES = 6

function createPool(): Particle[] {
  const pool: Particle[] = []
  for (let i = 0; i < MAX_PARTICLES; i++) {
    pool.push({
      alive: false, kind: ParticleKind.Burst,
      x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 1, size: 2, angle: 0,
      angularV: 0, radialV: 0, radius: 0,
      color: [255, 255, 255], alpha: 1,
      trail: false, prevX: 0, prevY: 0,
    })
  }
  return pool
}

function getParticle(pool: Particle[]): Particle | null {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].alive) return pool[i]
  }
  return null
}

/* ---------- component ---------- */

export function BeatVisualizer({ beatPulse, mood, moodBg, moodGlow, analyser }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const poolRef = useRef<Particle[]>(createPool())
  const shockwavesRef = useRef<Shockwave[]>([])
  const animRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)

  // Frequency data buffer — allocated once
  const freqDataRef = useRef<Uint8Array | null>(null)

  // Smoothed energy values (for visual continuity)
  const bassRef = useRef(0)
  const midRef = useRef(0)
  const highRef = useRef(0)
  const overallRef = useRef(0)
  const prevBassRef = useRef(0) // for detecting bass transients (kicks)

  const glowRef = useRef(0)
  const shakeRef = useRef(0)
  const shakeXRef = useRef(0)
  const shakeYRef = useRef(0)

  // Colors as refs for the animation loop
  const moodBgRef = useRef(moodBg)
  const moodGlowRef = useRef(moodGlow)
  const moodRef = useRef(mood)
  const analyserRef = useRef(analyser)

  useEffect(() => {
    moodBgRef.current = moodBg
    moodGlowRef.current = moodGlow
    moodRef.current = mood
  }, [moodBg, moodGlow, mood])

  useEffect(() => {
    analyserRef.current = analyser
    if (analyser && !freqDataRef.current) {
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount)
    }
  }, [analyser])

  /* ---- beat trigger (still used for shockwaves on detected beats) ---- */
  const prevBeatPulseRef = useRef(false)

  useEffect(() => {
    if (beatPulse && !prevBeatPulseRef.current) {
      onBeatDetected()
    }
    prevBeatPulseRef.current = beatPulse
  }, [beatPulse])

  const onBeatDetected = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cx = (canvas.width / dpr) / 2
    const cy = (canvas.height / dpr) / 2
    const glowRgb = hexToRgb(moodGlowRef.current)
    const bgRgb = hexToRgb(moodBgRef.current)
    const bass = bassRef.current

    // Shockwave on beat — size scales with current bass energy
    const waves = shockwavesRef.current
    if (waves.length < MAX_SHOCKWAVES) {
      waves.push({
        x: cx, y: cy,
        radius: 10,
        maxRadius: 150 + bass * 350,
        life: 1,
        color: glowRgb,
        lineWidth: 2 + bass * 5,
      })
      if (bass > 0.6) {
        waves.push({
          x: cx, y: cy,
          radius: 5,
          maxRadius: 100 + bass * 200,
          life: 1,
          color: bgRgb,
          lineWidth: 1 + bass * 2,
        })
      }
    }
  }, [])

  /* ---- spawn particles driven by audio energy ---- */
  const spawnFromEnergy = useCallback((
    bass: number, mid: number, high: number,
    bassTransient: number, // spike detection
    cx: number, cy: number,
  ) => {
    const pool = poolRef.current
    const glowRgb = hexToRgb(moodGlowRef.current)
    const bgRgb = hexToRgb(moodBgRef.current)
    const white: [number, number, number] = [255, 255, 255]

    // --- Bass transients → burst particles (kick drums, bass drops) ---
    if (bassTransient > 0.15) {
      const count = Math.floor(5 + bassTransient * 20)
      for (let i = 0; i < count; i++) {
        const p = getParticle(pool)
        if (!p) break
        const angle = Math.random() * Math.PI * 2
        const speed = 60 + bassTransient * 300
        p.alive = true
        p.kind = ParticleKind.Burst
        p.x = cx + (Math.random() - 0.5) * 20
        p.y = cy + (Math.random() - 0.5) * 20
        p.prevX = p.x; p.prevY = p.y
        p.vx = Math.cos(angle) * speed
        p.vy = Math.sin(angle) * speed
        p.life = 1
        p.maxLife = 0.6 + bassTransient * 0.8
        p.size = 2 + bassTransient * 5
        p.color = lerpColor(white, glowRgb, 0.2 + Math.random() * 0.5)
        p.alpha = 0.7 + bassTransient * 0.3
        p.trail = Math.random() < 0.5
        p.angle = 0; p.angularV = 0; p.radialV = 0; p.radius = 0
      }
    }

    // --- Sustained bass → slow expanding spirals ---
    if (bass > 0.4 && Math.random() < bass * 0.3) {
      const p = getParticle(pool)
      if (p) {
        const angle = Math.random() * Math.PI * 2
        p.alive = true
        p.kind = ParticleKind.Spiral
        p.x = cx; p.y = cy
        p.prevX = cx; p.prevY = cy
        p.vx = 0; p.vy = 0
        p.life = 1
        p.maxLife = 1.5 + bass * 0.5
        p.size = 2 + bass * 2
        p.angle = angle
        p.angularV = (1 + Math.random() * 2) * (Math.random() < 0.5 ? 1 : -1)
        p.radialV = 40 + bass * 100
        p.radius = 5
        p.color = lerpColor(bgRgb, glowRgb, 0.3 + bass * 0.5)
        p.alpha = 0.6 + bass * 0.3
        p.trail = false
      }
    }

    // --- High frequency energy → sparks (hi-hats, cymbals, sizzle) ---
    if (high > 0.25 && Math.random() < high * 0.5) {
      const count = Math.floor(1 + high * 4)
      for (let i = 0; i < count; i++) {
        const p = getParticle(pool)
        if (!p) break
        const angle = Math.random() * Math.PI * 2
        const speed = 100 + high * 350
        p.alive = true
        p.kind = ParticleKind.Spark
        p.x = cx + (Math.random() - 0.5) * 60
        p.y = cy + (Math.random() - 0.5) * 60
        p.prevX = p.x; p.prevY = p.y
        p.vx = Math.cos(angle) * speed
        p.vy = Math.sin(angle) * speed
        p.life = 1
        p.maxLife = 0.2 + high * 0.3
        p.size = 0.8 + high * 1.5
        p.color = lerpColor(white, glowRgb, Math.random() * 0.3)
        p.alpha = 0.8 + high * 0.2
        p.trail = true
        p.angle = 0; p.angularV = 0; p.radialV = 0; p.radius = 0
      }
    }

    // --- Mid energy → ambient floaters rising (vocals, melody) ---
    if (mid > 0.3 && Math.random() < mid * 0.15) {
      const p = getParticle(pool)
      if (p) {
        const dpr = window.devicePixelRatio || 1
        const canvas = canvasRef.current
        const logicalW = canvas ? canvas.width / dpr : 800
        const logicalH = canvas ? canvas.height / dpr : 600
        p.alive = true
        p.kind = ParticleKind.Float
        p.x = Math.random() * logicalW
        p.y = logicalH + 10
        p.prevX = p.x; p.prevY = p.y
        p.vx = (Math.random() - 0.5) * 15
        p.vy = -(10 + mid * 40)
        p.life = 1
        p.maxLife = 2 + Math.random() * 3
        p.size = 1 + mid * 2
        p.color = lerpColor(bgRgb, glowRgb, 0.3 + mid * 0.4)
        p.alpha = 0.1 + mid * 0.2
        p.trail = false
        p.angle = 0; p.angularV = 0; p.radialV = 0; p.radius = 0
      }
    }
  }, [])

  /* ---- animation loop ---- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const dpr = window.devicePixelRatio || 1
      const rect = parent.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const loop = (time: number) => {
      const dt = Math.min((time - (lastTimeRef.current || time)) / 1000, 0.05)
      lastTimeRef.current = time

      const dpr = window.devicePixelRatio || 1
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      const cx = w / 2
      const cy = h / 2

      // --- Read audio frequency data ---
      const an = analyserRef.current
      const fd = freqDataRef.current
      if (an && fd) {
        const energy = getAudioEnergy(an, fd)
        // Smooth with exponential moving average
        const smooth = 0.3 // higher = more responsive
        bassRef.current += (energy.bass - bassRef.current) * smooth
        midRef.current += (energy.mid - midRef.current) * smooth
        highRef.current += (energy.high - highRef.current) * smooth
        overallRef.current += (energy.overall - overallRef.current) * smooth
      }

      const bass = bassRef.current
      const mid = midRef.current
      const high = highRef.current
      const overall = overallRef.current

      // Detect bass transients (sudden increases = kick/snare hits)
      const bassTransient = Math.max(0, bass - prevBassRef.current - 0.05)
      prevBassRef.current = bass

      // Drive glow from bass energy
      const targetGlow = bass * 0.8 + overall * 0.2
      glowRef.current += (targetGlow - glowRef.current) * 0.15

      // Shake from bass transients
      if (bassTransient > 0.2) {
        shakeRef.current = Math.max(shakeRef.current, bassTransient * 15)
      }

      // --- Spawn particles from audio energy ---
      spawnFromEnergy(bass, mid, high, bassTransient, cx, cy)

      // --- shake ---
      if (shakeRef.current > 0.1) {
        shakeXRef.current = (Math.random() - 0.5) * shakeRef.current
        shakeYRef.current = (Math.random() - 0.5) * shakeRef.current
        shakeRef.current *= 0.88
      } else {
        shakeXRef.current = 0
        shakeYRef.current = 0
        shakeRef.current = 0
      }

      ctx.save()
      ctx.translate(shakeXRef.current, shakeYRef.current)
      ctx.clearRect(-10, -10, w + 20, h + 20)

      const glowRgb = hexToRgb(moodGlowRef.current)
      const bgRgb = hexToRgb(moodBgRef.current)
      const glow = glowRef.current

      // --- Ambient glow — driven by bass ---
      if (glow > 0.03) {
        ctx.fillStyle = `rgba(${glowRgb[0]},${glowRgb[1]},${glowRgb[2]},${glow * 0.12})`
        ctx.beginPath()
        ctx.arc(cx, cy, w * 0.4 + bass * w * 0.15, 0, Math.PI * 2)
        ctx.fill()
      }

      // --- Frequency bars — mirrored from center, prominent ---
      if (an && fd) {
        const barCount = 64
        const gap = 2
        const totalW = w * 0.85
        const barWidth = (totalW - gap * barCount) / barCount
        const maxBarH = h * 0.38
        const binStep = Math.max(1, Math.floor(fd.length / barCount))
        const startX = (w - totalW) / 2

        for (let i = 0; i < barCount; i++) {
          let sum = 0
          for (let j = 0; j < binStep; j++) {
            sum += fd[i * binStep + j] || 0
          }
          const v = (sum / binStep) / 255
          // Apply power curve to make quiet parts more visible
          const vCurved = Math.pow(v, 0.7)
          const barH = vCurved * maxBarH

          // Color: bass bins glow bright, mids are mood color, highs are lighter
          const t = i / barCount
          const barColor = t < 0.1
            ? glowRgb
            : t < 0.4
              ? lerpColor(glowRgb, bgRgb, (t - 0.1) / 0.3)
              : lerpColor(bgRgb, [200, 200, 255] as [number, number, number], (t - 0.4) / 0.6)

          const x = startX + i * (barWidth + gap)

          // Main bar — solid, from bottom
          const barAlpha = 0.25 + v * 0.45
          ctx.fillStyle = `rgba(${barColor[0]},${barColor[1]},${barColor[2]},${barAlpha})`
          ctx.fillRect(x, h - barH, barWidth, barH)

          // Top cap — brighter accent line
          if (barH > 3) {
            ctx.fillStyle = `rgba(${barColor[0]},${barColor[1]},${barColor[2]},${0.5 + v * 0.4})`
            ctx.fillRect(x, h - barH, barWidth, 2)
          }

          // Reflection above (mirrored, shorter, faded)
          if (barH > 8) {
            const reflH = barH * 0.25
            ctx.fillStyle = `rgba(${barColor[0]},${barColor[1]},${barColor[2]},${barAlpha * 0.3})`
            ctx.fillRect(x, h - barH - reflH - 2, barWidth, reflH)
          }
        }
      }

      // --- Shockwaves ---
      const waves = shockwavesRef.current
      for (let i = waves.length - 1; i >= 0; i--) {
        const sw = waves[i]
        sw.radius += (sw.maxRadius - sw.radius) * 0.06 + dt * 300
        sw.life -= dt * 1.5
        if (sw.life <= 0) {
          waves.splice(i, 1)
          continue
        }
        ctx.beginPath()
        ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${sw.color[0]},${sw.color[1]},${sw.color[2]},${sw.life * 0.5})`
        ctx.lineWidth = sw.lineWidth * sw.life
        ctx.stroke()
      }

      // --- Particles ---
      const pool = poolRef.current
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i]
        if (!p.alive) continue

        p.prevX = p.x
        p.prevY = p.y
        p.life -= dt / p.maxLife

        if (p.life <= 0) { p.alive = false; continue }

        switch (p.kind) {
          case ParticleKind.Burst:
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.vx *= 0.97
            p.vy *= 0.97
            p.vy += 15 * dt
            break
          case ParticleKind.Spiral:
            p.angle += p.angularV * dt
            p.radius += p.radialV * dt
            p.radialV *= 0.99
            p.x = cx + Math.cos(p.angle) * p.radius
            p.y = cy + Math.sin(p.angle) * p.radius
            break
          case ParticleKind.Float:
            p.x += p.vx * dt + Math.sin(time * 0.001 + i) * 0.3
            p.y += p.vy * dt
            break
          case ParticleKind.Spark:
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.vx *= 0.94
            p.vy *= 0.94
            break
        }

        const lifeAlpha = p.life < 0.3 ? p.life / 0.3 : 1
        const drawAlpha = p.alpha * lifeAlpha
        if (drawAlpha < 0.01) { p.alive = false; continue }

        // Trail
        if (p.trail && (p.kind === ParticleKind.Burst || p.kind === ParticleKind.Spark)) {
          const dx = p.x - p.prevX
          const dy = p.y - p.prevY
          if (dx * dx + dy * dy > 4) {
            ctx.beginPath()
            ctx.moveTo(p.prevX, p.prevY)
            ctx.lineTo(p.x, p.y)
            ctx.strokeStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${drawAlpha * 0.4})`
            ctx.lineWidth = p.size * 0.6
            ctx.stroke()
          }
        }

        // Particle dot
        ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${drawAlpha})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()

        // Cheap glow halo
        if (p.size > 2 && drawAlpha > 0.3) {
          ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${drawAlpha * 0.12})`
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // --- Center orb — pulses with bass ---
      const orbR = 6 + bass * 18 + Math.sin(time * 0.003) * 2
      if (bass > 0.05 || glow > 0.05) {
        ctx.fillStyle = `rgba(${glowRgb[0]},${glowRgb[1]},${glowRgb[2]},${Math.min(0.15, glow * 0.1 + bass * 0.08)})`
        ctx.beginPath()
        ctx.arc(cx, cy, orbR * 4, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, bass * 0.4 + glow * 0.2)})`
        ctx.beginPath()
        ctx.arc(cx, cy, orbR, 0, Math.PI * 2)
        ctx.fill()
      }

      // --- Energy ring — radius breathes with mid, alpha with overall ---
      const ringR = 35 + mid * 50 + Math.sin(time * 0.002) * 5
      const ringAlpha = 0.03 + overall * 0.1
      ctx.fillStyle = `rgba(${glowRgb[0]},${glowRgb[1]},${glowRgb[2]},${ringAlpha})`
      const ringSegs = 30
      const ringRot = time * 0.0005
      for (let s = 0; s < ringSegs; s++) {
        const a = (s / ringSegs) * Math.PI * 2 + ringRot
        const mod = 0.5 + 0.5 * Math.sin(a * 3 + time * 0.004)
        if (mod < 0.3) continue
        ctx.beginPath()
        ctx.arc(cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR, 1 + overall * 1.5, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()

      // --- Mood label ---
      const moodLabel = moodRef.current
      if (moodLabel) {
        ctx.save()
        ctx.translate(shakeXRef.current, shakeYRef.current)
        ctx.font = '600 11px system-ui, -apple-system, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = `rgba(${glowRgb[0]},${glowRgb[1]},${glowRgb[2]},${0.3 + glow * 0.4})`
        ctx.fillText(moodLabel.toUpperCase(), cx, h - 16)
        ctx.restore()
      }

      animRef.current = requestAnimationFrame(loop)
    }

    animRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [spawnFromEnergy])

  return (
    <canvas
      ref={canvasRef}
      className="beat-visualizer-canvas"
    />
  )
}
