import { useRef, useEffect, useMemo, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EffectComposer, Bloom, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'

interface Props {
  beatPulse: boolean
  mood: string
  moodBg: string
  moodGlow: string
  analyser: AnalyserNode | null
}

/* ---------- helpers ---------- */

function hexToVec3(hex: string): THREE.Vector3 {
  const h = hex.replace('#', '')
  return new THREE.Vector3(
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  )
}

function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex)
}

/* ---------- audio energy ---------- */

interface AudioEnergy {
  bass: number
  mid: number
  high: number
  overall: number
  bassTransient: number
}

const energyState: AudioEnergy = { bass: 0, mid: 0, high: 0, overall: 0, bassTransient: 0 }
let prevBass = 0

function updateAudioEnergy(analyser: AnalyserNode | null, freqData: Uint8Array | null) {
  if (!analyser || !freqData) return
  analyser.getByteFrequencyData(freqData)
  // Also grab waveform
  if (sharedState.waveData) analyser.getByteTimeDomainData(sharedState.waveData)
  const len = freqData.length
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

  const rawBass = Math.min(1, bassSum / bassEnd)
  const rawMid = Math.min(1, midSum / (midEnd - bassEnd) * 1.2)
  const rawHigh = Math.min(1, highSum / (len - midEnd) * 2.5)
  const rawOverall = Math.min(1, total / len * 2)

  const smooth = 0.3
  energyState.bass += (rawBass - energyState.bass) * smooth
  energyState.mid += (rawMid - energyState.mid) * smooth
  energyState.high += (rawHigh - energyState.high) * smooth
  energyState.overall += (rawOverall - energyState.overall) * smooth
  energyState.bassTransient = Math.max(0, energyState.bass - prevBass - 0.05)
  prevBass = energyState.bass
}

/* ---------- Shared state for passing data into R3F ---------- */

const sharedState = {
  analyser: null as AnalyserNode | null,
  freqData: null as Uint8Array | null,
  waveData: null as Uint8Array | null, // time-domain waveform for oscilloscope ring
  moodGlow: '#a78bfa',
  moodBg: '#7c3aed',
  beatPulse: false,
  prevBeatPulse: false,
  chromaStrength: 0,
}

/* ---------- Particle system (GPU instanced) ---------- */

const PARTICLE_COUNT = 600
const BAR_COUNT = 64

// Pre-allocate particle data
interface PData {
  positions: Float32Array
  velocities: Float32Array
  lives: Float32Array    // [life, maxLife] interleaved
  sizes: Float32Array
  colors: Float32Array   // rgb interleaved
  alive: Uint8Array
}

function createParticleData(): PData {
  return {
    positions: new Float32Array(PARTICLE_COUNT * 3),
    velocities: new Float32Array(PARTICLE_COUNT * 3),
    lives: new Float32Array(PARTICLE_COUNT * 2),
    sizes: new Float32Array(PARTICLE_COUNT),
    colors: new Float32Array(PARTICLE_COUNT * 3),
    alive: new Uint8Array(PARTICLE_COUNT),
  }
}

function getSlot(pd: PData): number {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    if (!pd.alive[i]) return i
  }
  return -1
}

function spawnBurst(pd: PData, cx: number, cy: number, count: number, speed: number, size: number, color: THREE.Vector3, life: number) {
  for (let n = 0; n < count; n++) {
    const i = getSlot(pd)
    if (i === -1) return
    const angle = Math.random() * Math.PI * 2
    const s = speed * (0.6 + Math.random() * 0.8)
    pd.positions[i * 3] = cx + (Math.random() - 0.5) * 0.3
    pd.positions[i * 3 + 1] = cy + (Math.random() - 0.5) * 0.3
    pd.positions[i * 3 + 2] = 0
    pd.velocities[i * 3] = Math.cos(angle) * s
    pd.velocities[i * 3 + 1] = Math.sin(angle) * s
    pd.velocities[i * 3 + 2] = (Math.random() - 0.5) * s * 0.3
    pd.lives[i * 2] = 1
    pd.lives[i * 2 + 1] = life
    pd.sizes[i] = size * (0.5 + Math.random())
    const white = Math.random() * 0.4
    pd.colors[i * 3] = color.x + (1 - color.x) * white
    pd.colors[i * 3 + 1] = color.y + (1 - color.y) * white
    pd.colors[i * 3 + 2] = color.z + (1 - color.z) * white
    pd.alive[i] = 1
  }
}

function spawnSparks(pd: PData, cx: number, cy: number, count: number, speed: number, color: THREE.Vector3) {
  for (let n = 0; n < count; n++) {
    const i = getSlot(pd)
    if (i === -1) return
    const angle = Math.random() * Math.PI * 2
    const s = speed * (0.5 + Math.random())
    pd.positions[i * 3] = cx + (Math.random() - 0.5) * 0.8
    pd.positions[i * 3 + 1] = cy + (Math.random() - 0.5) * 0.8
    pd.positions[i * 3 + 2] = 0
    pd.velocities[i * 3] = Math.cos(angle) * s
    pd.velocities[i * 3 + 1] = Math.sin(angle) * s
    pd.velocities[i * 3 + 2] = 0
    pd.lives[i * 2] = 1
    pd.lives[i * 2 + 1] = 0.2 + Math.random() * 0.3
    pd.sizes[i] = 0.02 + Math.random() * 0.03
    pd.colors[i * 3] = Math.min(1, color.x + 0.5)
    pd.colors[i * 3 + 1] = Math.min(1, color.y + 0.5)
    pd.colors[i * 3 + 2] = Math.min(1, color.z + 0.5)
    pd.alive[i] = 1
  }
}

/* ---------- Particles mesh component ---------- */

function Particles() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const pdRef = useRef<PData>(createParticleData())
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const colorArr = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), [])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const pd = pdRef.current
    const dt = Math.min(delta, 0.05)

    // Update audio
    updateAudioEnergy(sharedState.analyser, sharedState.freqData)
    const { bass, mid, high, bassTransient } = energyState
    const glowV = hexToVec3(sharedState.moodGlow)

    // Spawn points — edges and bottom, NOT center (avoid obscuring skeleton)
    // Bottom center (above spectrum bars)
    const bottomY = -3.2
    // Left and right edges
    const edgeX = 5.5
    const side = Math.random() < 0.5 ? -1 : 1

    // Beat-triggered burst — from bottom and sides
    if (sharedState.beatPulse && !sharedState.prevBeatPulse) {
      // Burst from bottom
      spawnBurst(pd, 0, bottomY, Math.floor(5 + bass * 12), 3 + bass * 5, 0.06 + bass * 0.08, glowV, 0.6 + bass * 0.6)
      // Burst from sides
      spawnBurst(pd, edgeX * side, 0, Math.floor(3 + bass * 8), 2 + bass * 4, 0.05 + bass * 0.06, glowV, 0.5 + bass * 0.5)
      sharedState.chromaStrength = 0.003 + bass * 0.008
    }
    sharedState.prevBeatPulse = sharedState.beatPulse

    // Bass transient → burst from bottom
    if (bassTransient > 0.15) {
      spawnBurst(pd, (Math.random() - 0.5) * 4, bottomY, Math.floor(3 + bassTransient * 10), 2 + bassTransient * 5, 0.05 + bassTransient * 0.06, glowV, 0.5 + bassTransient * 0.5)
    }

    // High → sparks from edges (not center)
    if (high > 0.25 && Math.random() < high * 0.4) {
      spawnSparks(pd, edgeX * side + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4, Math.floor(1 + high * 3), 4 + high * 8, glowV)
    }

    // Mid → slow floaters from bottom edges
    if (mid > 0.3 && Math.random() < mid * 0.12) {
      const i = getSlot(pd)
      if (i !== -1) {
        pd.positions[i * 3] = (Math.random() - 0.5) * 10
        pd.positions[i * 3 + 1] = -4.5
        pd.positions[i * 3 + 2] = 0
        pd.velocities[i * 3] = (Math.random() - 0.5) * 0.3
        pd.velocities[i * 3 + 1] = 0.5 + mid * 1.5
        pd.velocities[i * 3 + 2] = 0
        pd.lives[i * 2] = 1
        pd.lives[i * 2 + 1] = 2 + Math.random() * 2
        pd.sizes[i] = 0.03 + mid * 0.04
        pd.colors[i * 3] = glowV.x * 0.7
        pd.colors[i * 3 + 1] = glowV.y * 0.7
        pd.colors[i * 3 + 2] = glowV.z * 0.7
        pd.alive[i] = 1
      }
    }

    // Update all particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (!pd.alive[i]) {
        dummy.position.set(0, 0, -100) // hide
        dummy.scale.setScalar(0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        continue
      }

      pd.lives[i * 2] -= dt / pd.lives[i * 2 + 1]
      if (pd.lives[i * 2] <= 0) {
        pd.alive[i] = 0
        dummy.position.set(0, 0, -100)
        dummy.scale.setScalar(0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        continue
      }

      // Move
      pd.positions[i * 3] += pd.velocities[i * 3] * dt
      pd.positions[i * 3 + 1] += pd.velocities[i * 3 + 1] * dt
      pd.positions[i * 3 + 2] += pd.velocities[i * 3 + 2] * dt
      // Drag
      pd.velocities[i * 3] *= 0.97
      pd.velocities[i * 3 + 1] *= 0.97
      pd.velocities[i * 3 + 2] *= 0.97

      const life = pd.lives[i * 2]
      const alpha = life < 0.3 ? life / 0.3 : 1
      const sz = pd.sizes[i] * (0.5 + alpha * 0.5)

      dummy.position.set(pd.positions[i * 3], pd.positions[i * 3 + 1], pd.positions[i * 3 + 2])
      dummy.scale.setScalar(sz)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      colorArr[i * 3] = pd.colors[i * 3] * alpha
      colorArr[i * 3 + 1] = pd.colors[i * 3 + 1] * alpha
      colorArr[i * 3 + 2] = pd.colors[i * 3 + 2] * alpha
    }

    mesh.instanceMatrix.needsUpdate = true
    const colorAttr = mesh.geometry.getAttribute('instanceColor') as THREE.InstancedBufferAttribute
    if (colorAttr) {
      colorAttr.array = colorArr
      colorAttr.needsUpdate = true
    }

    // Decay chroma
    sharedState.chromaStrength *= 0.92
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
      <sphereGeometry args={[1, 6, 6]}>
        <instancedBufferAttribute attach="attributes-instanceColor" args={[colorArr, 3]} />
      </sphereGeometry>
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

/* ---------- Spectrum Bars ---------- */

function SpectrumBars() {
  const groupRef = useRef<THREE.Group>(null)
  const barRefs = useRef<THREE.Mesh[]>([])
  const capRefs = useRef<THREE.Mesh[]>([])

  const barGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 0.1), [])
  const capGeo = useMemo(() => new THREE.BoxGeometry(1, 0.06, 0.12), [])

  const barMats = useMemo(() => {
    const mats: THREE.MeshBasicMaterial[] = []
    for (let i = 0; i < BAR_COUNT; i++) {
      mats.push(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, toneMapped: false }))
    }
    return mats
  }, [])

  const capMats = useMemo(() => {
    const mats: THREE.MeshBasicMaterial[] = []
    for (let i = 0; i < BAR_COUNT; i++) {
      mats.push(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, toneMapped: false }))
    }
    return mats
  }, [])

  useFrame(() => {
    const fd = sharedState.freqData
    const an = sharedState.analyser
    if (!fd || !an || !groupRef.current) return

    const glowColor = hexToColor(sharedState.moodGlow)
    const bgColor = hexToColor(sharedState.moodBg)
    const totalW = 12
    const gap = 0.02
    const barW = (totalW - gap * BAR_COUNT) / BAR_COUNT
    const startX = -totalW / 2
    const maxH = 2.5
    const binStep = Math.max(1, Math.floor(fd.length / BAR_COUNT))

    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = barRefs.current[i]
      const cap = capRefs.current[i]
      if (!bar || !cap) continue

      let sum = 0
      for (let j = 0; j < binStep; j++) {
        sum += fd[i * binStep + j] || 0
      }
      const v = Math.pow((sum / binStep) / 255, 0.7)
      const barH = Math.max(0.02, v * maxH)

      const x = startX + i * (barW + gap) + barW / 2

      bar.position.set(x, -4.8 + barH / 2, -0.5)
      bar.scale.set(barW, barH, 0.1)

      cap.position.set(x, -4.8 + barH, -0.5)
      cap.scale.set(barW, 1, 1)

      // Color gradient
      const t = i / BAR_COUNT
      const c = t < 0.15
        ? glowColor
        : t < 0.5
          ? glowColor.clone().lerp(bgColor, (t - 0.15) / 0.35)
          : bgColor.clone().lerp(new THREE.Color(0.8, 0.8, 1), (t - 0.5) / 0.5)

      barMats[i].color.copy(c)
      barMats[i].opacity = 0.25 + v * 0.5
      capMats[i].color.copy(c)
      capMats[i].opacity = 0.5 + v * 0.5
    }
  })

  const bars = useMemo(() => {
    const items: JSX.Element[] = []
    for (let i = 0; i < BAR_COUNT; i++) {
      items.push(
        <mesh
          key={`bar-${i}`}
          ref={(el) => { if (el) barRefs.current[i] = el }}
          geometry={barGeo}
          material={barMats[i]}
        />,
        <mesh
          key={`cap-${i}`}
          ref={(el) => { if (el) capRefs.current[i] = el }}
          geometry={capGeo}
          material={capMats[i]}
        />,
      )
    }
    return items
  }, [barGeo, capGeo, barMats, capMats])

  return <group ref={groupRef}>{bars}</group>
}

/* ---------- Center Orb ---------- */

function CenterOrb() {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null)
  // Position orb at bottom, above spectrum bars, out of skeleton's way
  const orbY = -3.0

  useFrame(({ clock }) => {
    const { bass, overall } = energyState
    const t = clock.getElapsedTime()
    const orbR = 0.1 + bass * 0.25 + Math.sin(t * 3) * 0.02
    const glowColor = hexToColor(sharedState.moodGlow)

    if (meshRef.current) {
      meshRef.current.scale.setScalar(orbR)
      meshRef.current.position.y = orbY
    }
    if (matRef.current) {
      matRef.current.color.set(0xffffff)
      matRef.current.opacity = 0.3 + bass * 0.5
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(orbR * 4 + overall * 1)
      glowRef.current.position.y = orbY
    }
    if (glowMatRef.current) {
      glowMatRef.current.color.copy(glowColor)
      glowMatRef.current.opacity = 0.05 + bass * 0.1
    }
  })

  return (
    <>
      <mesh ref={glowRef} position={[0, orbY, 0]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial ref={glowMatRef} transparent toneMapped={false} />
      </mesh>
      <mesh ref={meshRef} position={[0, orbY, 0]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial ref={matRef} transparent toneMapped={false} />
      </mesh>
    </>
  )
}

/* ---------- Shockwave Rings ---------- */

function ShockwaveRings() {
  const ringsRef = useRef<{ radius: number; maxRadius: number; life: number; color: THREE.Color }[]>([])
  const meshRefs = useRef<THREE.Mesh[]>([])
  const matRefs = useRef<THREE.MeshBasicMaterial[]>([])
  const MAX_RINGS = 6

  // Pre-create ring meshes
  const rings = useMemo(() => {
    const items: JSX.Element[] = []
    for (let i = 0; i < MAX_RINGS; i++) {
      items.push(
        <mesh
          key={i}
          ref={(el) => { if (el) meshRefs.current[i] = el }}
          position={[0, -3.0, 0]}
          rotation-x={Math.PI / 2}
        >
          <ringGeometry args={[0.95, 1, 64]} />
          <meshBasicMaterial
            ref={(el) => { if (el) matRefs.current[i] = el }}
            transparent
            toneMapped={false}
            side={THREE.DoubleSide}
            opacity={0}
          />
        </mesh>,
      )
    }
    return items
  }, [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const ringData = ringsRef.current
    const { bass } = energyState

    // Spawn on beat — rings expand from bottom area
    if (sharedState.beatPulse && !sharedState.prevBeatPulse) {
      if (ringData.length < MAX_RINGS) {
        ringData.push({
          radius: 0.2,
          maxRadius: 2.5 + bass * 4,
          life: 1,
          color: hexToColor(sharedState.moodGlow),
        })
      }
    }

    // Update rings
    for (let i = ringData.length - 1; i >= 0; i--) {
      const r = ringData[i]
      r.radius += (r.maxRadius - r.radius) * 0.06 + dt * 4
      r.life -= dt * 1.5
      if (r.life <= 0) {
        ringData.splice(i, 1)
      }
    }

    // Apply to meshes
    for (let i = 0; i < MAX_RINGS; i++) {
      const mesh = meshRefs.current[i]
      const mat = matRefs.current[i]
      if (!mesh || !mat) continue

      const r = ringData[i]
      if (r) {
        mesh.scale.setScalar(r.radius)
        mat.color.copy(r.color)
        mat.opacity = r.life * 0.5
      } else {
        mat.opacity = 0
      }
    }
  })

  return <>{rings}</>
}

/* ---------- Waveform Ring (circular oscilloscope) ---------- */

const WAVE_SEGMENTS = 128

function WaveformRing() {
  const lineRef = useRef<THREE.Line>(null)
  const positions = useMemo(() => new Float32Array((WAVE_SEGMENTS + 1) * 3), [])
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geo
  }, [positions])

  useFrame(({ clock }) => {
    const line = lineRef.current
    if (!line) return
    const wd = sharedState.waveData
    const { bass, overall } = energyState
    const t = clock.getElapsedTime()

    // Ring sits around the orb at the bottom
    const ringCenterY = -3.0
    const baseRadius = 1.2 + overall * 0.5
    const waveAmp = 0.15 + bass * 0.6 // how much waveform displaces the ring

    const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute

    for (let i = 0; i <= WAVE_SEGMENTS; i++) {
      const angle = (i / WAVE_SEGMENTS) * Math.PI * 2 + t * 0.2
      // Sample waveform — map ring segment to waveform index
      const waveIdx = wd ? Math.floor((i / WAVE_SEGMENTS) * wd.length) % wd.length : 0
      const waveVal = wd ? (wd[waveIdx] - 128) / 128 : 0 // -1 to 1
      const r = baseRadius + waveVal * waveAmp
      positions[i * 3] = Math.cos(angle) * r
      positions[i * 3 + 1] = ringCenterY + Math.sin(angle) * r
      positions[i * 3 + 2] = 0
    }
    posAttr.needsUpdate = true

    // Update color
    const mat = line.material as THREE.LineBasicMaterial
    mat.color.copy(hexToColor(sharedState.moodGlow))
    mat.opacity = 0.3 + overall * 0.5
  })

  return (
    <line ref={lineRef as any} geometry={geometry}>
      <lineBasicMaterial transparent toneMapped={false} linewidth={1.5} />
    </line>
  )
}

/* ---------- Side Spectrum Pillars (vertical bars on edges) ---------- */

const SIDE_BAR_COUNT = 24

function SideSpectrumPillars() {
  const leftRefs = useRef<THREE.Mesh[]>([])
  const rightRefs = useRef<THREE.Mesh[]>([])
  const barGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 0.08), [])

  const leftMats = useMemo(() => {
    const m: THREE.MeshBasicMaterial[] = []
    for (let i = 0; i < SIDE_BAR_COUNT; i++) {
      m.push(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, toneMapped: false }))
    }
    return m
  }, [])
  const rightMats = useMemo(() => {
    const m: THREE.MeshBasicMaterial[] = []
    for (let i = 0; i < SIDE_BAR_COUNT; i++) {
      m.push(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, toneMapped: false }))
    }
    return m
  }, [])

  useFrame(() => {
    const fd = sharedState.freqData
    if (!fd) return

    const glowColor = hexToColor(sharedState.moodGlow)
    const bgColor = hexToColor(sharedState.moodBg)
    const edgeX = 6.2
    const barH = 0.18
    const gap = 0.04
    const totalH = SIDE_BAR_COUNT * (barH + gap)
    const startY = -totalH / 2
    const maxW = 1.8
    const binStep = Math.max(1, Math.floor(fd.length / SIDE_BAR_COUNT))

    for (let i = 0; i < SIDE_BAR_COUNT; i++) {
      let sum = 0
      for (let j = 0; j < binStep; j++) {
        sum += fd[i * binStep + j] || 0
      }
      const v = Math.pow((sum / binStep) / 255, 0.7)
      const barW = Math.max(0.02, v * maxW)
      const y = startY + i * (barH + gap)

      const t = i / SIDE_BAR_COUNT
      const c = t < 0.2
        ? glowColor
        : glowColor.clone().lerp(bgColor, (t - 0.2) / 0.8)

      // Left side — grows leftward from edge
      const lBar = leftRefs.current[i]
      if (lBar) {
        lBar.position.set(-edgeX - barW / 2, y, -0.3)
        lBar.scale.set(barW, barH, 1)
      }
      leftMats[i].color.copy(c)
      leftMats[i].opacity = 0.15 + v * 0.4

      // Right side — mirrored
      const rBar = rightRefs.current[i]
      if (rBar) {
        rBar.position.set(edgeX + barW / 2, y, -0.3)
        rBar.scale.set(barW, barH, 1)
      }
      rightMats[i].color.copy(c)
      rightMats[i].opacity = 0.15 + v * 0.4
    }
  })

  const items = useMemo(() => {
    const els: JSX.Element[] = []
    for (let i = 0; i < SIDE_BAR_COUNT; i++) {
      els.push(
        <mesh key={`l-${i}`} ref={(el) => { if (el) leftRefs.current[i] = el }} geometry={barGeo} material={leftMats[i]} />,
        <mesh key={`r-${i}`} ref={(el) => { if (el) rightRefs.current[i] = el }} geometry={barGeo} material={rightMats[i]} />,
      )
    }
    return els
  }, [barGeo, leftMats, rightMats])

  return <>{items}</>
}

/* ---------- Star Field (ambient depth particles) ---------- */

const STAR_COUNT = 200

function StarField() {
  const meshRef = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const arr = new Float32Array(STAR_COUNT * 3)
    for (let i = 0; i < STAR_COUNT; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 20     // x: spread wide
      arr[i * 3 + 1] = (Math.random() - 0.5) * 12 // y: spread tall
      arr[i * 3 + 2] = -2 - Math.random() * 6     // z: behind everything
    }
    return arr
  }, [])
  const baseSizes = useMemo(() => {
    const arr = new Float32Array(STAR_COUNT)
    for (let i = 0; i < STAR_COUNT; i++) {
      arr[i] = 0.5 + Math.random() * 1.5
    }
    return arr
  }, [])

  useFrame(({ clock }) => {
    const pts = meshRef.current
    if (!pts) return
    const t = clock.getElapsedTime()
    const { overall, bass } = energyState
    const posAttr = pts.geometry.getAttribute('position') as THREE.BufferAttribute
    const sizeAttr = pts.geometry.getAttribute('size') as THREE.BufferAttribute

    for (let i = 0; i < STAR_COUNT; i++) {
      // Slow drift
      positions[i * 3 + 1] += 0.003 // drift up slowly
      if (positions[i * 3 + 1] > 7) positions[i * 3 + 1] = -7 // wrap

      // Twinkle — size pulses with unique phase per star
      const twinkle = 0.5 + 0.5 * Math.sin(t * (1.5 + (i % 7) * 0.3) + i * 1.7)
      // React to overall energy — stars brighten with music
      const energyBoost = 1 + overall * 1.5 + bass * 0.5
      baseSizes[i] = (0.5 + Math.random() * 0.01) * twinkle * energyBoost
    }

    posAttr.needsUpdate = true
    sizeAttr.needsUpdate = true

    // Color reacts to mood
    const mat = pts.material as THREE.PointsMaterial
    const glowColor = hexToColor(sharedState.moodGlow)
    mat.color.copy(glowColor)
    mat.opacity = 0.2 + overall * 0.3
  })

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[baseSizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        transparent
        toneMapped={false}
        sizeAttenuation
        size={0.08}
        opacity={0.3}
      />
    </points>
  )
}

/* ---------- Chromatic aberration controller ---------- */

function ChromaController({ offsetRef }: { offsetRef: React.MutableRefObject<THREE.Vector2> }) {
  useFrame(() => {
    const s = sharedState.chromaStrength
    offsetRef.current.set(s, s)
  })
  return null
}

/* ---------- Scene ---------- */

function Scene() {
  const { camera } = useThree()
  const chromaOffset = useRef(new THREE.Vector2(0, 0))

  useEffect(() => {
    camera.position.set(0, 0, 8)
    camera.lookAt(0, 0, 0)
  }, [camera])

  return (
    <>
      <color attach="background" args={['#0a0a0a']} />
      <StarField />
      <Particles />
      <SpectrumBars />
      <SideSpectrumPillars />
      <CenterOrb />
      <WaveformRing />
      <ShockwaveRings />
      <ChromaController offsetRef={chromaOffset} />
      <EffectComposer>
        <Bloom
          intensity={1.5}
          luminanceThreshold={0.2}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={chromaOffset.current}
          radialModulation={false}
          modulationOffset={0}
        />
      </EffectComposer>
    </>
  )
}

/* ---------- Main component ---------- */

export function BeatVisualizer({ beatPulse, mood, moodBg, moodGlow, analyser }: Props) {
  // Sync props into shared state for R3F components
  useEffect(() => {
    sharedState.moodGlow = moodGlow
    sharedState.moodBg = moodBg
  }, [moodGlow, moodBg])

  useEffect(() => {
    sharedState.beatPulse = beatPulse
  }, [beatPulse])

  useEffect(() => {
    sharedState.analyser = analyser
    if (analyser && !sharedState.freqData) {
      sharedState.freqData = new Uint8Array(analyser.frequencyBinCount)
      sharedState.waveData = new Uint8Array(analyser.frequencyBinCount)
    }
  }, [analyser])

  return (
    <div className="beat-visualizer-canvas" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      <Canvas
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 1.5]}
        style={{ width: '100%', height: '100%' }}
      >
        <Scene />
      </Canvas>
      {/* Mood label overlay */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        color: moodGlow,
        opacity: 0.5,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 3,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {mood.toUpperCase()}
      </div>
    </div>
  )
}
