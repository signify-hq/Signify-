import { useRef, useEffect, useState, Suspense } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoseFrame {
  pose: number[][]
  pose_world: number[][]
  pose_screen: number[][]
  left_hand: number[][]
  right_hand: number[][]
  bones?: Record<string, number[]>
}

export interface PoseData {
  fps: number
  width: number
  height: number
  format?: string
  frames: PoseFrame[]
}

interface VrmAvatarProps {
  poseData: PoseData
  tokenStart: number
  tokenEnd: number
  currentTime: number
  moodGlow: string
}

// ---------------------------------------------------------------------------
// Frame interpolation & temporal smoothing
// ---------------------------------------------------------------------------

function lerpFrame(a: PoseFrame, b: PoseFrame, t: number): PoseFrame {
  const lerpArr = (arrA: number[][], arrB: number[][]) =>
    arrA.map((lm, i) => lm.map((v, j) => v + (arrB[i][j] - v) * t))
  return {
    pose: lerpArr(a.pose, b.pose),
    pose_world: lerpArr(a.pose_world, b.pose_world),
    pose_screen: lerpArr(a.pose_screen, b.pose_screen),
    left_hand: lerpArr(a.left_hand, b.left_hand),
    right_hand: lerpArr(a.right_hand, b.right_hand),
  }
}

function averageFrames(frames: PoseFrame[]): PoseFrame {
  const n = frames.length
  if (n === 1) return frames[0]
  const avg = (key: keyof PoseFrame) =>
    frames[0][key].map((_, i) =>
      frames[0][key][i].map((_, j) =>
        frames.reduce((s, f) => s + f[key][i][j], 0) / n,
      ),
    )
  return {
    pose: avg('pose'),
    pose_world: avg('pose_world'),
    pose_screen: avg('pose_screen'),
    left_hand: avg('left_hand'),
    right_hand: avg('right_hand'),
  }
}

// ---------------------------------------------------------------------------
// Diagnostic store
// ---------------------------------------------------------------------------

const diagStore = { info: '' }

// ---------------------------------------------------------------------------
// Apply pose — Euler angles with NEGATED Z axis
// Static test proved: Z=+90° = arms UP (bone convention is inverted from math)
// So we negate all computed Z angles to get correct visual direction
// ---------------------------------------------------------------------------

function applyPose(vrm: VRM, frame: PoseFrame) {
  const hum = vrm.humanoid
  if (!hum) return

  const wl = frame.pose_world

  // MediaPipe world → VRM scene coords
  // MP: +X=subject's left, +Y=down, +Z=away from camera
  // VRM: +X=model's left, +Y=up, +Z=model's forward (toward camera)
  // X: same (subject's left = model's left), Y: negate, Z: negate
  const lShoulder = new THREE.Vector3(wl[11][0], -wl[11][1], -wl[11][2])
  const lElbow    = new THREE.Vector3(wl[13][0], -wl[13][1], -wl[13][2])
  const lWrist    = new THREE.Vector3(wl[15][0], -wl[15][1], -wl[15][2])
  const rShoulder = new THREE.Vector3(wl[12][0], -wl[12][1], -wl[12][2])
  const rElbow    = new THREE.Vector3(wl[14][0], -wl[14][1], -wl[14][2])
  const rWrist    = new THREE.Vector3(wl[16][0], -wl[16][1], -wl[16][2])

  // Spine
  const hipMid = new THREE.Vector3(wl[23][0], -wl[23][1], -wl[23][2])
    .add(new THREE.Vector3(wl[24][0], -wl[24][1], -wl[24][2]))
    .multiplyScalar(0.5)
  const shoulderMid = lShoulder.clone().add(rShoulder).multiplyScalar(0.5)
  const spineDir = shoulderMid.clone().sub(hipMid).normalize()
  const spineBone = hum.getNormalizedBoneNode('spine' as any)
  if (spineBone) {
    // Small spine tilt from vertical
    const spineX = Math.asin(Math.max(-1, Math.min(1, -spineDir.z))) * 0.3
    const spineZ = Math.asin(Math.max(-1, Math.min(1, spineDir.x))) * 0.3
    spineBone.quaternion.setFromEuler(new THREE.Euler(spineX, 0, spineZ))
  }

  // --- Arm Euler computation (Z-negated for this model's bone convention) ---
  function armEuler(dir: THREE.Vector3, side: 'left' | 'right'): THREE.Euler {
    if (dir.lengthSq() < 0.0001) return new THREE.Euler(0, 0, 0)
    const d = dir.clone().normalize()
    if (side === 'left') {
      // Math gives: ey=asin(dz), ez=atan2(-dy,-dx)
      // But bone convention is Z-inverted, so negate ez
      const ey = Math.asin(Math.max(-1, Math.min(1, d.z)))
      const ez = -Math.atan2(-d.y, -d.x)
      return new THREE.Euler(0, ey, ez)
    } else {
      const ey = Math.asin(Math.max(-1, Math.min(1, -d.z)))
      const ez = -Math.atan2(d.y, d.x)
      return new THREE.Euler(0, ey, ez)
    }
  }

  // Upper arms (skip normalize if zero-length — frame has no data)
  const leftUpperDir = lElbow.clone().sub(lShoulder)
  const rightUpperDir = rElbow.clone().sub(rShoulder)

  const leftUpperQ = new THREE.Quaternion().setFromEuler(armEuler(leftUpperDir, 'left'))
  const leftUpperBone = hum.getNormalizedBoneNode('leftUpperArm' as any)
  if (leftUpperBone) leftUpperBone.quaternion.copy(leftUpperQ)

  const rightUpperQ = new THREE.Quaternion().setFromEuler(armEuler(rightUpperDir, 'right'))
  const rightUpperBone = hum.getNormalizedBoneNode('rightUpperArm' as any)
  if (rightUpperBone) rightUpperBone.quaternion.copy(rightUpperQ)

  // Lower arms (forearm direction in upper arm's local space)
  const leftForeDir = lWrist.clone().sub(lElbow)
  const leftLocalFore = leftForeDir.clone().applyQuaternion(leftUpperQ.clone().invert())
  const leftLowerQ = new THREE.Quaternion().setFromEuler(armEuler(leftLocalFore, 'left'))
  const leftLowerBone = hum.getNormalizedBoneNode('leftLowerArm' as any)
  if (leftLowerBone) leftLowerBone.quaternion.copy(leftLowerQ)

  const rightForeDir = rWrist.clone().sub(rElbow)
  const rightLocalFore = rightForeDir.clone().applyQuaternion(rightUpperQ.clone().invert())
  const rightLowerQ = new THREE.Quaternion().setFromEuler(armEuler(rightLocalFore, 'right'))
  const rightLowerBone = hum.getNormalizedBoneNode('rightLowerArm' as any)
  if (rightLowerBone) rightLowerBone.quaternion.copy(rightLowerQ)
}

// ---------------------------------------------------------------------------
// Camera auto-framer
// ---------------------------------------------------------------------------

function CameraFramer({ vrm }: { vrm: VRM }) {
  const { camera } = useThree()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const targetY = center.y + size.y * 0.15
    const dist = size.y * 1.0
    camera.position.set(0, targetY, dist)
    camera.lookAt(0, targetY, 0)
    camera.updateProjectionMatrix()
  }, [vrm, camera])

  return null
}

// ---------------------------------------------------------------------------
// VRM model
// ---------------------------------------------------------------------------

const SMOOTH_WINDOW = 3

function VrmModel({
  poseData,
  tokenStart,
  tokenEnd,
  currentTime,
}: Omit<VrmAvatarProps, 'moodGlow'>) {
  const gltf = useLoader(GLTFLoader, '/avatar.vrm', (loader) => {
    loader.register((parser: any) => new VRMLoaderPlugin(parser))
  })
  const vrm = gltf.userData.vrm as VRM

  const ctRef = useRef(currentTime)
  ctRef.current = currentTime
  const tsRef = useRef(tokenStart)
  const teRef = useRef(tokenEnd)
  tsRef.current = tokenStart
  teRef.current = tokenEnd

  const bufferRef = useRef<PoseFrame[]>([])
  const prevTokenRef = useRef(tokenStart)
  const frameCountRef = useRef(0)

  useEffect(() => {
    if (tokenStart !== prevTokenRef.current) {
      bufferRef.current = []
      prevTokenRef.current = tokenStart
    }
  }, [tokenStart])

  useFrame((state, delta) => {
    if (!vrm || !poseData) return

    try {
      const totalFrames = poseData.frames.length
      const tokenDur = Math.max(0.05, teRef.current - tsRef.current)
      // Use Three.js clock for reliable time (React prop updates don't flow well through R3F)
      const elapsed = state.clock.elapsedTime
      const progress = (elapsed / tokenDur) % 1
      const floatIdx = Math.abs(progress) * totalFrames
      const idx0 = Math.floor(floatIdx) % totalFrames
      const idx1 = (idx0 + 1) % totalFrames
      const subT = floatIdx - Math.floor(floatIdx)

      const interpolated = lerpFrame(poseData.frames[idx0], poseData.frames[idx1], subT)

      const buf = bufferRef.current
      buf.push(interpolated)
      if (buf.length > SMOOTH_WINDOW) buf.shift()
      const smoothed = averageFrames(buf)

      applyPose(vrm, smoothed)

      frameCountRef.current++
      if (frameCountRef.current % 30 === 0) {
        diagStore.info = `f=${idx0}/${totalFrames} t=${elapsed.toFixed(1)}s`
      }

      vrm.update(delta)
    } catch (err: any) {
      console.error('VRM frame error:', err)
      diagStore.info = `ERR: ${err.message}`
    }
  })

  return (
    <>
      <CameraFramer vrm={vrm} />
      <primitive object={vrm.scene} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

function MoodLights({ color }: { color: string }) {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[0, 2, 3]} intensity={0.9} />
      <pointLight position={[0, 1.2, 1.5]} intensity={0.5} color={color} />
    </>
  )
}

function LoadingFallback() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b',
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: 2,
      }}
    >
      LOADING...
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diagnostic overlay
// ---------------------------------------------------------------------------

function DiagOverlay() {
  const [info, setInfo] = useState('')
  useEffect(() => {
    const iv = setInterval(() => setInfo(diagStore.info), 500)
    return () => clearInterval(iv)
  }, [])
  if (!info) return null
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 4,
        left: 4,
        background: 'rgba(0,0,0,0.7)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: 9,
        padding: '2px 6px',
        borderRadius: 3,
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      {info}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

export function VrmAvatar({
  poseData,
  tokenStart,
  tokenEnd,
  currentTime,
  moodGlow,
}: VrmAvatarProps) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Suspense fallback={<LoadingFallback />}>
        <Canvas
          frameloop="always"
          camera={{ position: [0, 1.2, 2.0], fov: 40, near: 0.1, far: 20 }}
          gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
          style={{ width: '100%', height: '100%', background: 'transparent' }}
          resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0)
            gl.outputColorSpace = THREE.SRGBColorSpace
          }}
        >
          <MoodLights color={moodGlow} />
          <VrmModel
            poseData={poseData}
            tokenStart={tokenStart}
            tokenEnd={tokenEnd}
            currentTime={currentTime}
          />
        </Canvas>
      </Suspense>
      <DiagOverlay />
    </div>
  )
}
