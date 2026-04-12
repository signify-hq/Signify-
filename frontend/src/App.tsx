import React, { useState, useEffect, useRef, Suspense, Component, type ReactNode, type ErrorInfo } from 'react'
import { usePlayer } from './hooks/usePlayer'
import { AvatarDisplay } from './components/AvatarDisplay'
import { LyricsDisplay } from './components/LyricsDisplay'
import { BeatVisualizer } from './components/BeatVisualizer'
import { Controls } from './components/Controls'
import { VrmAvatar, type PoseData } from './components/VrmAvatar'
const VideoKalidokitTest = React.lazy(() => import('./components/VideoKalidokitTest').then(m => ({ default: m.VideoKalidokitTest })))
import { MOOD_COLORS } from './types'
import type { Timeline } from './types'
import './App.css'

// ---------------------------------------------------------------------------
// Isolated VRM diagnostic — visit http://localhost:5173/?test=make
// Just skeleton + one VRM sine wave, maximum error visibility
// ---------------------------------------------------------------------------
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm'

// Auto-frame camera to fit VRM model
function CameraFramer({ vrm }: { vrm: VRM }) {
  const { camera } = useThree()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    // Frame upper body — center on chest, back up enough to see full model
    const targetY = center.y + size.y * 0.15
    const dist = size.y * 1.1
    camera.position.set(0, targetY, dist)
    camera.lookAt(0, targetY, 0)
    camera.updateProjectionMatrix()
  }, [vrm, camera])
  return null
}

// VRM model with sine wave OR pose data
function VrmTestModel({
  onFrame,
  poseData,
}: {
  onFrame: (msg: string) => void
  poseData: PoseData | null
}) {
  const gltf = useLoader(GLTFLoader, '/avatar.vrm', (loader) => {
    loader.register((parser: any) => new VRMLoaderPlugin(parser))
  })
  const vrm = gltf.userData.vrm as VRM
  const frameCount = useRef(0)
  const poseRef = useRef(poseData)
  poseRef.current = poseData
  const { camera } = useThree()

  // Compute rest directions from actual VRM bone positions (T-pose)
  const restDirs = useRef<Record<string, THREE.Vector3>>({})
  useEffect(() => {
    if (!vrm?.humanoid) return
    onFrame('VRM loaded, reading T-pose bone positions...')

    // Reset all arm bones to identity so getWorldPosition returns T-pose positions
    const allArmBones = [
      'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
      'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    ]
    for (const name of allArmBones) {
      const bone = vrm.humanoid.getNormalizedBoneNode(name as any)
      if (bone) bone.quaternion.identity()
    }
    vrm.scene.updateMatrixWorld(true)

    const bonePairs: [string, string][] = [
      ['leftUpperArm', 'leftLowerArm'],
      ['leftLowerArm', 'leftHand'],
      ['rightUpperArm', 'rightLowerArm'],
      ['rightLowerArm', 'rightHand'],
    ]
    for (const [parent, child] of bonePairs) {
      const pNode = vrm.humanoid.getNormalizedBoneNode(parent as any)
      const cNode = vrm.humanoid.getNormalizedBoneNode(child as any)
      if (pNode && cNode) {
        const pPos = new THREE.Vector3()
        const cPos = new THREE.Vector3()
        pNode.getWorldPosition(pPos)
        cNode.getWorldPosition(cPos)
        const dir = cPos.sub(pPos).normalize()
        restDirs.current[parent] = dir
        onFrame(`  ${parent}: rest=(${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)})`)
      }
    }
    // Log rest directions permanently so we can debug
    const dirs = Object.entries(restDirs.current)
      .map(([k, v]) => `${k.replace('Arm', '')}=(${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)})`)
      .join(' ')
    onFrame(`REST: ${dirs}`)

    // Frame camera
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const targetY = center.y + size.y * 0.15
    const dist = size.y * 1.1
    camera.position.set(0, targetY, dist)
    camera.lookAt(0, targetY, 0)
    camera.updateProjectionMatrix()
  }, [vrm])

  useFrame((state, delta) => {
    if (!vrm?.humanoid) return
    try {
      const t = state.clock.elapsedTime
      const hum = vrm.humanoid

      const pd = poseRef.current
      if (pd && pd.frames.length > 0 && pd.frames[0].pose_world) {
        // --- POSE MODE: setFromUnitVectors with actual rest directions ---
        const totalFrames = pd.frames.length
        const loopDur = 3.0
        const progress = (t / loopDur) % 1
        const idx = Math.floor(progress * totalFrames) % totalFrames
        const frame = pd.frames[idx]
        const wl = frame.pose_world

        if (wl && wl.length >= 25) {
          // MediaPipe world → VRM scene coords
          // MP: +X=subject's left, +Y=down, +Z=away from camera
          // VRM: +X=model's left, +Y=up, +Z=model's forward (toward camera)
          // X: same (subject's left = model's left), Y: negate, Z: negate
          const toScene = (i: number) => new THREE.Vector3(wl[i][0], -wl[i][1], -wl[i][2])

          const lShoulder = toScene(11)
          const lElbow = toScene(13)
          const lWrist = toScene(15)
          const rShoulder = toScene(12)
          const rElbow = toScene(14)
          const rWrist = toScene(16)

          // Apply upper + lower arm rotations using setFromUnitVectors
          const armPairs: [string, THREE.Vector3, THREE.Vector3, number][] = [
            ['leftUpperArm', lElbow.clone().sub(lShoulder), lWrist.clone().sub(lElbow), 1],
            ['rightUpperArm', rElbow.clone().sub(rShoulder), rWrist.clone().sub(rElbow), -1],
          ]

          // Anti-clipping bias parameters
          const FORWARD_BIAS = 0.55       // push arms toward camera (+Z)
          const LATERAL_BIAS = 0.30       // push arms outward (left=+X, right=-X)
          const MIN_Z = 0.10              // floor: arm Z can never go below this

          // Bias a direction vector to prevent torso clipping:
          //   1. Add forward (+Z) bias to pull arms in front of the body
          //   2. Add lateral bias to push arms away from the torso centerline
          //   3. Clamp Z so arm direction never points behind the body
          const biasDir = (dir: THREE.Vector3, lateralSign: number): THREE.Vector3 => {
            const d = dir.clone().normalize()
            d.z += FORWARD_BIAS
            d.x += LATERAL_BIAS * lateralSign
            // Clamp: never let the arm point behind the torso
            if (d.z < MIN_Z) d.z = MIN_Z
            return d.normalize()
          }

          for (const [upperName, upperDir, foreDir, latSign] of armPairs) {
            const lowerName = upperName.replace('Upper', 'Lower')
            const rest = restDirs.current[upperName]
            const lowerRest = restDirs.current[lowerName]
            if (!rest || !lowerRest) continue
            if (upperDir.lengthSq() < 0.00001) continue

            // Bias the target direction to keep arms visible in front of torso
            const biasedDir = biasDir(upperDir, latSign)
            const upperQ = new THREE.Quaternion().setFromUnitVectors(rest, biasedDir)
            const upperBone = hum.getNormalizedBoneNode(upperName as any)
            if (upperBone) upperBone.quaternion.copy(upperQ)

            // Lower arm: compute forearm direction in upper arm's local space
            if (foreDir.lengthSq() > 0.00001) {
              const biasedFore = biasDir(foreDir, latSign)
              const localFore = biasedFore.clone().applyQuaternion(upperQ.clone().invert()).normalize()
              const lowerQ = new THREE.Quaternion().setFromUnitVectors(lowerRest, localFore)
              const lowerBone = hum.getNormalizedBoneNode(lowerName as any)
              if (lowerBone) lowerBone.quaternion.copy(lowerQ)
            }
          }

          if (frameCount.current % 60 === 0) {
            const ld = lElbow.clone().sub(lShoulder).normalize()
            const rd = rElbow.clone().sub(rShoulder).normalize()
            const lr = restDirs.current['leftUpperArm']
            const rr = restDirs.current['rightUpperArm']
            onFrame(
              `f=${idx}/${totalFrames} ` +
              `Lrest=(${lr?.x.toFixed(2)},${lr?.y.toFixed(2)},${lr?.z.toFixed(2)}) ` +
              `Ltgt=(${ld.x.toFixed(2)},${ld.y.toFixed(2)},${ld.z.toFixed(2)}) ` +
              `Rrest=(${rr?.x.toFixed(2)},${rr?.y.toFixed(2)},${rr?.z.toFixed(2)}) ` +
              `Rtgt=(${rd.x.toFixed(2)},${rd.y.toFixed(2)},${rd.z.toFixed(2)})`
            )
          }
        }
      } else {
        // --- SINE MODE: simple arm wave + reset bones ---
        const resetBones = [
          'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
          'spine', 'hips',
        ]
        for (const name of resetBones) {
          const bone = hum.getNormalizedBoneNode(name as any)
          if (bone) bone.quaternion.identity()
        }

        const leftArm = hum.getNormalizedBoneNode('leftUpperArm' as any)
        const rightArm = hum.getNormalizedBoneNode('rightUpperArm' as any)
        if (leftArm) {
          leftArm.quaternion.setFromEuler(
            new THREE.Euler(0, 0, -(Math.sin(t * 2) * 0.8 + 1.2))
          )
        }
        if (rightArm) {
          rightArm.quaternion.setFromEuler(
            new THREE.Euler(0, 0, Math.sin(t * 2 + 1) * 0.8 + 1.2)
          )
        }
        if (frameCount.current % 30 === 0) {
          onFrame(`SINE f=${frameCount.current} t=${t.toFixed(1)}s`)
        }
      }

      vrm.update(delta)
      frameCount.current++
    } catch (err: any) {
      onFrame(`ERR f=${frameCount.current}: ${err.message}`)
    }
  })

  return (
    <>
      <CameraFramer vrm={vrm} />
      <primitive object={vrm.scene} />
    </>
  )
}

// Error boundary that shows errors on screen
function VrmErrorCatcher({ children, onError }: { children: React.ReactNode; onError: (msg: string) => void }) {
  return (
    <ErrorBoundaryInner onError={onError}>
      {children}
    </ErrorBoundaryInner>
  )
}

class ErrorBoundaryInner extends Component<
  { children: ReactNode; onError: (msg: string) => void },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: '' }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, error: err.message }
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    this.props.onError(`CRASH: ${err.message}`)
  }
  render() {
    if (this.state.hasError) {
      return <div style={{ color: '#f66', fontSize: 11, padding: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>CRASH: {this.state.error}</div>
    }
    return this.props.children
  }
}

const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
]

function TestPage({ sign }: { sign: string }) {
  const [poseData, setPoseData] = useState<PoseData | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(0)
  const [vrmStatus, setVrmStatus] = useState('loading...')
  const [mode, setMode] = useState<'sine' | 'pose'>('sine')
  const isError = vrmStatus.startsWith('ERR') || vrmStatus.startsWith('CRASH')

  useEffect(() => {
    fetch(`/api/pose/${sign}`).then(r => r.json()).then(d => setPoseData(d)).catch(() => {})
  }, [sign])

  // Skeleton animation loop
  useEffect(() => {
    if (!poseData || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!
    const total = poseData.frames.length
    const interval = Math.max(30, 3000 / total)

    function draw() {
      const f = poseData!.frames[frameRef.current % total]
      ctx.clearRect(0, 0, 400, 500)
      const sx = 400 / poseData!.width * 0.75
      const sy = 500 / poseData!.height * 0.75
      const sc = Math.min(sx, sy)
      const ox = (400 - poseData!.width * sc) / 2
      const oy = (500 - poseData!.height * sc) / 2 + 20
      ctx.strokeStyle = '#0f0'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      for (const [a, b] of POSE_CONNECTIONS) {
        const pa = f.pose[a], pb = f.pose[b]
        if (!pa || !pb) continue
        ctx.beginPath()
        ctx.moveTo(pa[0] * sc + ox, pa[1] * sc + oy)
        ctx.lineTo(pb[0] * sc + ox, pb[1] * sc + oy)
        ctx.stroke()
      }
      ctx.fillStyle = '#0f0'
      for (let i = 11; i <= 24; i++) {
        const p = f.pose[i]
        if (!p) continue
        ctx.beginPath()
        ctx.arc(p[0] * sc + ox, p[1] * sc + oy, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      frameRef.current++
    }

    draw()
    const iv = setInterval(draw, interval)
    return () => clearInterval(iv)
  }, [poseData])

  // Pass pose data only in pose mode
  const activePose = mode === 'pose' ? poseData : null

  return (
    <div style={{ display: 'flex', gap: 24, padding: 20, background: '#111', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      {/* Skeleton reference */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 400, height: 500, border: '1px solid #333' }}>
          <canvas ref={canvasRef} width={400} height={500} />
        </div>
        <div style={{ color: '#0f0', textAlign: 'center', marginTop: 4, fontSize: 16, fontWeight: 700 }}>SKELETON</div>
      </div>

      {/* Single VRM panel — toggle between sine and pose */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 400, height: 500, border: '1px solid #333', position: 'relative' }}>
          <VrmErrorCatcher onError={setVrmStatus}>
            <Canvas
              frameloop="always"
              camera={{ position: [0, 1.2, 2.0], fov: 40, near: 0.1, far: 20 }}
              gl={{ alpha: true, antialias: true }}
              style={{ width: '100%', height: '100%', background: 'transparent' }}
              onCreated={({ gl }) => {
                gl.setClearColor(0x000000, 0)
                gl.outputColorSpace = THREE.SRGBColorSpace
              }}
            >
              <ambientLight intensity={0.7} />
              <directionalLight position={[0, 2, 3]} intensity={0.9} />
              <Suspense fallback={null}>
                <VrmTestModel onFrame={setVrmStatus} poseData={activePose} />
              </Suspense>
            </Canvas>
          </VrmErrorCatcher>
          <div
            style={{
              position: 'absolute', bottom: 4, left: 4, right: 4,
              background: 'rgba(0,0,0,0.85)',
              color: isError ? '#f66' : '#0f0',
              fontFamily: 'monospace', fontSize: 11, padding: '4px 8px', borderRadius: 3,
              zIndex: 10, pointerEvents: 'none',
            }}
          >
            {vrmStatus}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={() => setMode('sine')}
            style={{
              padding: '6px 16px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: mode === 'sine' ? '#66ff66' : '#333',
              color: mode === 'sine' ? '#000' : '#888',
              fontWeight: 700, fontSize: 13,
            }}
          >
            SINE WAVE
          </button>
          <button
            onClick={() => setMode('pose')}
            disabled={!poseData}
            style={{
              padding: '6px 16px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: mode === 'pose' ? '#ff6666' : '#333',
              color: mode === 'pose' ? '#000' : '#888',
              fontWeight: 700, fontSize: 13,
              opacity: poseData ? 1 : 0.4,
            }}
          >
            POSE DATA
          </button>
        </div>
      </div>

      <div style={{ color: '#888', fontSize: 12, maxWidth: 180 }}>
        <h3 style={{ color: '#fff' }}>{sign.toUpperCase()}</h3>
        <p>{poseData ? `${poseData.frames.length} frames` : 'Loading...'}</p>
        <p style={{ marginTop: 12, color: '#ff0', fontWeight: 600 }}>Toggle modes:</p>
        <p>SINE = arms wave (baseline)</p>
        <p>POSE = real pose data</p>
        <p style={{ marginTop: 8 }}>Same Canvas, same VRM.</p>
      </div>
    </div>
  )
}

// Router component — no hooks, just delegates to the right page
function App() {
  const testSign = new URLSearchParams(window.location.search).get('test')
  if (testSign === 'video') {
    return (
      <Suspense fallback={<div style={{color:'#fff',padding:40}}>Loading video test...</div>}>
        <VideoKalidokitTest sign="make" />
      </Suspense>
    )
  }
  if (testSign) return <TestPage sign={testSign} />
  return <MainApp />
}

function MainApp() {
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [audioUrl, setAudioUrl] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // upload form state
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')

  const {
    audioRef,
    playing,
    currentTime,
    currentSegment,
    currentToken,
    beatPulse,
    play,
    pause,
    seek,
  } = usePlayer(timeline)

  const mood = currentSegment?.mood || 'tender'
  const colors = MOOD_COLORS[mood] || MOOD_COLORS.tender

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!audioFile) return

    setLoading(true)
    setError('')

    const formData = new FormData()
    formData.append('audio', audioFile)
    if (title) formData.append('title', title)
    if (artist) formData.append('artist', artist)

    try {
      const res = await fetch('/api/process', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Processing failed')
      const data: Timeline = await res.json()
      setTimeline(data)
      setAudioUrl(URL.createObjectURL(audioFile))
    } catch (err) {
      setError('Failed to process song. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  // load pre-baked timeline for demo
  async function loadDemo() {
    setLoading(true)
    try {
      const res = await fetch('/api/timeline/test.mp3')
      const data: Timeline = await res.json()
      setTimeline(data)
      setAudioUrl('/api/audio/test.mp3')
    } catch {
      setError('Demo timeline not found. Run the backend first.')
    } finally {
      setLoading(false)
    }
  }

  if (!timeline) {
    return (
      <div className="upload-screen">
        <h1 className="logo">SIGNIFY</h1>
        <p className="tagline">Music made visible through sign language</p>

        <form className="upload-form" onSubmit={handleSubmit}>
          <label className="upload-label">
            {audioFile ? audioFile.name : 'Choose audio file'}
            <input
              type="file"
              accept=".mp3,.wav,.flac"
              onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
              hidden
            />
          </label>
          <input
            className="upload-input"
            placeholder="Song title (optional for online lyrics)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="upload-input"
            placeholder="Artist name (optional for online lyrics)"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
          />
          <button className="upload-btn" type="submit" disabled={!audioFile || loading}>
            {loading ? 'Processing...' : 'Signify'}
          </button>
        </form>

        <button className="demo-btn" onClick={loadDemo} disabled={loading}>
          Load Demo Song
        </button>

        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  return (
    <div
      className="player"
      style={{
        background: `radial-gradient(ellipse at center, ${colors.bg}22 0%, #0a0a0a 70%)`,
      }}
    >
      <audio ref={audioRef} src={audioUrl} />

      <div className="player-top">
        <BeatVisualizer
          beatPulse={beatPulse}
          mood={mood}
          moodBg={colors.bg}
          moodGlow={colors.glow}
        />
        <AvatarDisplay
          token={currentToken}
          beatPulse={beatPulse}
          moodGlow={colors.glow}
          moodBg={colors.bg}
          currentTime={currentTime}
        />
      </div>

      <LyricsDisplay
        timeline={timeline}
        currentSegment={currentSegment}
        currentTime={currentTime}
      />

      <Controls
        playing={playing}
        currentTime={currentTime}
        duration={timeline.duration}
        onPlay={play}
        onPause={pause}
        onSeek={seek}
      />
    </div>
  )
}

export default App
