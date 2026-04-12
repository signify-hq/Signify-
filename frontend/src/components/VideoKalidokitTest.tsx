import React, { useRef, useEffect, useState, useCallback, Suspense, type ReactNode } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm'
import { Hand } from 'kalidokit'
import '@mediapipe/holistic'

const Holistic = (globalThis as any).Holistic as new (config: {
  locateFile: (file: string) => string
}) => {
  setOptions: (opts: Record<string, unknown>) => void
  onResults: (cb: (results: HolisticResults) => void) => void
  send: (input: { image: HTMLVideoElement | HTMLCanvasElement }) => Promise<void>
  close: () => void
}

type HolisticResults = Record<string, any>
type Landmark = { x: number; y: number; z: number }

interface VideoKalidokitTestProps {
  sign?: string
}

// ---------------------------------------------------------------------------
// Shared stores (mutable, no re-renders)
// ---------------------------------------------------------------------------

const landmarkStore: {
  world: Landmark[] | null
  leftHand: Record<string, { x: number; y: number; z: number }> | null  // Kalidokit-solved VRM LEFT hand rig
  rightHand: Record<string, { x: number; y: number; z: number }> | null // Kalidokit-solved VRM RIGHT hand rig
  leftHandLandmarks: Landmark[] | null   // Raw MediaPipe hand landmarks for VRM left hand (subject's right)
  rightHandLandmarks: Landmark[] | null  // Raw MediaPipe hand landmarks for VRM right hand (subject's left)
} = { world: null, leftHand: null, rightHand: null, leftHandLandmarks: null, rightHandLandmarks: null }

const statusStore = {
  mpLoaded: false,
  fps: 0,
  boneCount: 0,
  debug: '' as string,
}

// Bone pairs for computing rest directions (parent → child)
const ARM_BONE_PAIRS: [string, string][] = [
  ['leftUpperArm', 'leftLowerArm'],
  ['leftLowerArm', 'leftHand'],
  ['rightUpperArm', 'rightLowerArm'],
  ['rightLowerArm', 'rightHand'],
]

const ARM_BONE_NAMES = [
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
]

// ---------------------------------------------------------------------------
// VRM Model — direct landmark→bone computation for arms AND hands
// ---------------------------------------------------------------------------

function VrmModel({ modelUrl }: { modelUrl: string }) {
  const gltf = useLoader(GLTFLoader, modelUrl, (loader) => {
    loader.register((parser: unknown) => new VRMLoaderPlugin(parser as never))
  })
  const vrm = gltf.userData.vrm as VRM
  const { camera } = useThree()

  const restDirs = useRef<Record<string, THREE.Vector3>>({})
  const frameCount = useRef(0)

  // Measure T-pose rest directions for ALL bones (arms + fingers)
  useEffect(() => {
    if (!vrm?.humanoid) return

    // Reset arm bones to identity
    for (const name of ARM_BONE_NAMES) {
      const bone = vrm.humanoid.getNormalizedBoneNode(name as any)
      if (bone) bone.quaternion.identity()
    }
    vrm.scene.updateMatrixWorld(true)

    // Measure parent→child rest directions for arms
    for (const [parent, child] of ARM_BONE_PAIRS) {
      const pNode = vrm.humanoid.getNormalizedBoneNode(parent as any)
      const cNode = vrm.humanoid.getNormalizedBoneNode(child as any)
      if (pNode && cNode) {
        const pPos = new THREE.Vector3()
        const cPos = new THREE.Vector3()
        pNode.getWorldPosition(pPos)
        cNode.getWorldPosition(cPos)
        const dir = cPos.sub(pPos)
        if (dir.lengthSq() > 0.000001) {
          restDirs.current[parent] = dir.normalize()
        }
      }
    }

    // Auto-frame camera
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const targetY = center.y + size.y * 0.15
    camera.position.set(0, targetY, size.y * 1.1)
    camera.lookAt(0, targetY, 0)
    camera.updateProjectionMatrix()
  }, [vrm, camera])

  useFrame((_state, delta) => {
    if (!vrm?.humanoid) return
    try {
      const hum = vrm.humanoid
      const wl = landmarkStore.world
      let bonesSet = 0

      if (wl && wl.length >= 25) {
        // MediaPipe world → VRM scene (MIRRORED: negate X)
        const toScene = (i: number) =>
          new THREE.Vector3(-wl[i].x, -wl[i].y, -wl[i].z)

        // Mirror: subject's RIGHT → VRM LEFT, subject's LEFT → VRM RIGHT
        const lShoulder = toScene(12), lElbow = toScene(14), lWrist = toScene(16)
        const rShoulder = toScene(11), rElbow = toScene(13), rWrist = toScene(15)

        // Spine
        const hipMid = toScene(23).add(toScene(24)).multiplyScalar(0.5)
        const shoulderMid = lShoulder.clone().add(rShoulder).multiplyScalar(0.5)
        const spineDir = shoulderMid.clone().sub(hipMid).normalize()
        const spineBone = hum.getNormalizedBoneNode('spine' as any)
        if (spineBone) {
          const sx = Math.asin(Math.max(-1, Math.min(1, -spineDir.z))) * 0.3
          const sz = Math.asin(Math.max(-1, Math.min(1, spineDir.x))) * 0.3
          spineBone.quaternion.setFromEuler(new THREE.Euler(sx, 0, sz))
          bonesSet++
        }

        // Arms via setFromUnitVectors
        const forwardZ = new THREE.Vector3(0, 0, 0.35)
        const armPairs: [string, THREE.Vector3, THREE.Vector3][] = [
          ['leftUpperArm', lElbow.clone().sub(lShoulder), lWrist.clone().sub(lElbow)],
          ['rightUpperArm', rElbow.clone().sub(rShoulder), rWrist.clone().sub(rElbow)],
        ]
        for (const [upperName, upperDir, foreDir] of armPairs) {
          const lowerName = upperName.replace('Upper', 'Lower')
          const rest = restDirs.current[upperName]
          const lowerRest = restDirs.current[lowerName]
          if (!rest || !lowerRest || upperDir.lengthSq() < 0.00001) continue

          const biasedDir = upperDir.clone().normalize().add(forwardZ).normalize()
          const upperQ = new THREE.Quaternion().setFromUnitVectors(rest, biasedDir)
          const upperBone = hum.getNormalizedBoneNode(upperName as any)
          if (upperBone) { upperBone.quaternion.copy(upperQ); bonesSet++ }

          if (foreDir.lengthSq() > 0.00001) {
            const biasedFore = foreDir.clone().normalize().add(forwardZ).normalize()
            const localFore = biasedFore.clone().applyQuaternion(upperQ.clone().invert()).normalize()
            const lowerQ = new THREE.Quaternion().setFromUnitVectors(lowerRest, localFore)
            const lowerBone = hum.getNormalizedBoneNode(lowerName as any)
            if (lowerBone) { lowerBone.quaternion.copy(lowerQ); bonesSet++ }
          }
        }

        // -----------------------------------------------------------------
        // Fingers via Kalidokit Hand.solve() — Z negated for correct curl
        // -----------------------------------------------------------------

        const handSlerp = Math.min(1, delta * 12)

        // Compute wrist quaternion from raw hand landmarks
        const computeWristQ = (
          handLms: Landmark[] | null,
          side: 'left' | 'right',
        ): THREE.Quaternion | null => {
          if (!handLms || handLms.length < 21) return null
          // Hand landmark indices: 0=wrist, 5=index_MCP, 9=middle_MCP, 17=pinky_MCP
          // Build hand coordinate frame from landmarks (in screen-normalized space)
          const w = new THREE.Vector3(handLms[0].x, handLms[0].y, handLms[0].z)
          const midMCP = new THREE.Vector3(handLms[9].x, handLms[9].y, handLms[9].z)
          const idxMCP = new THREE.Vector3(handLms[5].x, handLms[5].y, handLms[5].z)
          const pnkMCP = new THREE.Vector3(handLms[17].x, handLms[17].y, handLms[17].z)

          // Forward = wrist → middle_MCP
          const forward = midMCP.clone().sub(w)
          if (forward.lengthSq() < 1e-8) return null
          forward.normalize()

          // Palm lateral = index_MCP → pinky_MCP (across the palm)
          const lateral = pnkMCP.clone().sub(idxMCP)
          if (lateral.lengthSq() < 1e-8) return null
          lateral.normalize()

          // Palm normal (points out of palm)
          const palmNormal = new THREE.Vector3().crossVectors(forward, lateral).normalize()

          // Build rotation matrix from hand frame
          // MediaPipe screen coords: x=right, y=down, z=toward_camera
          // Mirror swap: subject's right hand landmarks → VRM left hand
          // The landmarks have already been captured from the mirrored side,
          // so we just need to convert their frame to VRM space.
          //
          // VRM T-pose: left hand points +X (left), right hand points -X (right)
          // fingers point along the arm axis, palm faces down (-Y in VRM)
          //
          // In MediaPipe hand landmarks (screen normalized):
          //   forward (wrist→finger) roughly along -Y (up in screen = negative Y)
          //   palmNormal roughly along +Z or -Z depending on facing
          //
          // We compute a relative rotation: how much the hand has rotated
          // from a neutral pose. We use small euler angles for simplicity.

          // Convert to VRM-like coords: negate Y (MediaPipe Y is down, VRM Y is up),
          // negate Z (MediaPipe Z is toward camera, VRM Z is toward viewer in mirror)
          const fwd = new THREE.Vector3(forward.x, -forward.y, -forward.z)
          const nrm = new THREE.Vector3(palmNormal.x, -palmNormal.y, -palmNormal.z)

          // In a neutral pose (hand straight, palm down), for VRM left hand:
          //   fwd would be roughly (1, 0, 0) — pointing left along the arm
          //   nrm would be roughly (0, -1, 0) — palm facing down
          // For VRM right hand:
          //   fwd would be (-1, 0, 0), nrm = (0, -1, 0)

          // Compute wrist angles as deviation from neutral
          // Flexion/Extension (X): angle of forward vector in the Y direction
          const flexion = Math.asin(Math.max(-1, Math.min(1, fwd.y)))
          // Radial/Ulnar deviation (Z): forward vector's Z component
          const deviation = Math.asin(Math.max(-1, Math.min(1, fwd.z)))
          // Pronation/Supination (twist around arm axis): palm normal Y component
          // In neutral, nrm.y ≈ -1 (palm down). As you twist, nrm.z changes.
          const twist = Math.atan2(nrm.z, -nrm.y)

          // Clamp to physiological wrist range
          const cx = Math.max(-0.8, Math.min(0.8, flexion))    // flex/extend
          const cz = Math.max(-0.4, Math.min(0.4, deviation))  // radial/ulnar
          const cy = Math.max(-0.8, Math.min(0.8, twist * 0.5)) // pronate/supinate (damped)

          const invert = side === 'left' ? 1 : -1
          return new THREE.Quaternion().setFromEuler(
            new THREE.Euler(cx, cy * invert, cz * invert)
          )
        }

        // Kalidokit finger curl + dampened wrist
        const applyHandRig = (
          rig: Record<string, { x: number; y: number; z: number }> | null,
          side: 'left' | 'right',
        ) => {
          if (!rig) return
          const S = side === 'left' ? 'Left' : 'Right'

          const rotateBone = (boneName: string, rotation: { x: number; y: number; z: number } | undefined) => {
            if (!rotation) return
            const bone = hum.getNormalizedBoneNode(boneName as any)
            if (!bone) return
            bone.quaternion.slerp(
              new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, -rotation.z)),
              handSlerp,
            )
            bonesSet++
          }

          // Wrist: Kalidokit values applied directly (no Z negation, matching Wawa Sensei approach)
          const wristBone = hum.getNormalizedBoneNode(`${side}Hand` as any)
          if (wristBone) {
            const wr = rig[`${S}Wrist`]
            if (wr) {
              wristBone.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(
                wr.x,
                Math.max(-0.6, Math.min(0.6, wr.y)),
                Math.max(-1.0, Math.min(1.0, wr.z)),
              )), handSlerp)
            } else {
              wristBone.quaternion.slerp(new THREE.Quaternion(), handSlerp)
            }
            bonesSet++
          }

          // Thumb (Kalidokit offset: ThumbProximal → VRM ThumbMetacarpal, etc.)
          rotateBone(`${side}ThumbMetacarpal`, rig[`${S}ThumbProximal`])
          rotateBone(`${side}ThumbProximal`, rig[`${S}ThumbIntermediate`])
          rotateBone(`${side}ThumbDistal`, rig[`${S}ThumbDistal`])
          // Fingers (Kalidokit curl — confirmed working for open/close)
          for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
            for (const joint of ['Proximal', 'Intermediate', 'Distal']) {
              rotateBone(`${side}${finger}${joint}`, rig[`${S}${finger}${joint}`])
            }
          }
        }

        applyHandRig(landmarkStore.leftHand, 'left')
        applyHandRig(landmarkStore.rightHand, 'right')

        if (frameCount.current % 60 === 0) {
          const ld = lElbow.clone().sub(lShoulder).normalize()
          const rd = rElbow.clone().sub(rShoulder).normalize()
          const lh = landmarkStore.leftHand ? 'Y' : 'N'
          const rh = landmarkStore.rightHand ? 'Y' : 'N'
          statusStore.debug =
            `f=${frameCount.current} bones=${bonesSet} ` +
            `L=(${ld.x.toFixed(2)},${ld.y.toFixed(2)},${ld.z.toFixed(2)}) ` +
            `R=(${rd.x.toFixed(2)},${rd.y.toFixed(2)},${rd.z.toFixed(2)}) ` +
            `hands:L=${lh},R=${rh}`
        }
      }

      statusStore.boneCount = bonesSet
      vrm.update(delta)
      frameCount.current++
    } catch (err) {
      statusStore.debug = `Frame error: ${(err as Error).message}`
    }
  })

  return <primitive object={vrm.scene} />
}

// ---------------------------------------------------------------------------
// Draw landmarks on canvas overlay
// ---------------------------------------------------------------------------

function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  results: HolisticResults,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height)
  const draw = (lms: Array<{ x: number; y: number }> | undefined, color: string, r: number) => {
    if (!lms) return
    ctx.fillStyle = color
    for (const lm of lms) {
      ctx.beginPath()
      ctx.arc(lm.x * width, lm.y * height, r, 0, 2 * Math.PI)
      ctx.fill()
    }
  }
  draw(results.poseLandmarks, '#00ff00', 3)
  draw(results.leftHandLandmarks, '#ff6600', 2)
  draw(results.rightHandLandmarks, '#0066ff', 2)
}

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

class ErrorBoundary extends React.Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(err: Error) { return { error: err.message } }
  render() {
    if (this.state.error) {
      return <div style={{ padding: 16, color: '#ff4444', background: '#1a1a1a', borderRadius: 8, fontFamily: 'monospace', fontSize: 13 }}>VRM Error: {this.state.error}</div>
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VideoKalidokitTest({ sign = 'make' }: VideoKalidokitTestProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const webcamRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const holisticRef = useRef<Holistic | null>(null)
  const animFrameRef = useRef(0)
  const fpsCounterRef = useRef({ frames: 0, lastTime: performance.now() })
  const streamRef = useRef<MediaStream | null>(null)

  const [status, setStatus] = useState('Initializing...')
  const [fps, setFps] = useState(0)
  const [boneCount, setBoneCount] = useState(0)
  const [debug, setDebug] = useState('')
  const [inputMode, setInputMode] = useState<'webcam' | 'video'>('webcam')
  const [modelUrl, setModelUrl] = useState('/seed-san.vrm')
  const inputModeRef = useRef(inputMode)
  inputModeRef.current = inputMode

  useEffect(() => {
    const iv = setInterval(() => {
      setFps(statusStore.fps)
      setBoneCount(statusStore.boneCount)
      setDebug(statusStore.debug)
    }, 300)
    return () => clearInterval(iv)
  }, [])

  // Store raw landmarks — no Kalidokit, just direct MediaPipe data
  const onResults = useCallback((results: HolisticResults) => {
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) drawLandmarks(ctx, results, canvas.width, canvas.height)
    }

    // Pose world landmarks
    const worldLandmarks = results.za ?? results.poseWorldLandmarks
    if (worldLandmarks && worldLandmarks.length >= 25) {
      landmarkStore.world = worldLandmarks
    }

    // Hands: Kalidokit Hand.solve() with mirror swap
    // Subject's RIGHT hand → VRM LEFT hand, Subject's LEFT → VRM RIGHT
    if (results.rightHandLandmarks) {
      const lms = results.rightHandLandmarks.map((lm: Landmark) => ({ x: lm.x, y: lm.y, z: lm.z }))
      landmarkStore.leftHand = Hand.solve(lms, 'Left') as Record<string, { x: number; y: number; z: number }> | null
      landmarkStore.leftHandLandmarks = lms
    } else {
      landmarkStore.leftHand = null
      landmarkStore.leftHandLandmarks = null
    }
    if (results.leftHandLandmarks) {
      const lms = results.leftHandLandmarks.map((lm: Landmark) => ({ x: lm.x, y: lm.y, z: lm.z }))
      landmarkStore.rightHand = Hand.solve(lms, 'Right') as Record<string, { x: number; y: number; z: number }> | null
      landmarkStore.rightHandLandmarks = lms
    } else {
      landmarkStore.rightHand = null
      landmarkStore.rightHandLandmarks = null
    }

    // FPS
    const counter = fpsCounterRef.current
    counter.frames++
    const now = performance.now()
    if (now - counter.lastTime >= 1000) {
      statusStore.fps = counter.frames
      counter.frames = 0
      counter.lastTime = now
    }
  }, [])

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

      if (inputMode === 'webcam') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
          })
          streamRef.current = stream
          const webcam = webcamRef.current
          if (!webcam || cancelled) { stream.getTracks().forEach(t => t.stop()); return }
          webcam.srcObject = stream
          await webcam.play()
          const oc = canvasRef.current
          if (oc) { oc.width = webcam.videoWidth; oc.height = webcam.videoHeight }
          setStatus('Webcam ready. Processing...')
          statusStore.mpLoaded = true
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
      } else {
        const video = videoRef.current
        if (!video) return
        await new Promise<void>((r) => {
          if (video.readyState >= 2) r()
          else video.addEventListener('loadeddata', () => r(), { once: true })
        })
        if (cancelled) return
        const oc = canvasRef.current
        if (oc) { oc.width = video.videoWidth; oc.height = video.videoHeight }
        setStatus('Video ready. Processing...')
        statusStore.mpLoaded = true
        async function processFrame() {
          if (cancelled) return
          const v = videoRef.current
          if (v && !v.paused && !v.ended && v.readyState >= 2) {
            try { await holistic.send({ image: v }) } catch {}
          }
          if (!cancelled) animFrameRef.current = requestAnimationFrame(processFrame)
        }
        video.play().catch(() => setStatus('Click to play video'))
        animFrameRef.current = requestAnimationFrame(processFrame)
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
  }, [onResults, inputMode])

  const videoSrc = `/test-${sign}.mp4`

  return (
    <div style={{ fontFamily: 'monospace', background: '#111', color: '#eee', padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#888', fontSize: 12, marginRight: 4 }}>Input:</span>
        <button onClick={() => setInputMode('webcam')} style={{
          padding: '6px 16px', border: 'none', borderRadius: 6, cursor: 'pointer',
          background: inputMode === 'webcam' ? '#66ff66' : '#333',
          color: inputMode === 'webcam' ? '#000' : '#888',
          fontWeight: 700, fontSize: 13, fontFamily: 'monospace',
        }}>WEBCAM</button>
        <button onClick={() => setInputMode('video')} style={{
          padding: '6px 16px', border: 'none', borderRadius: 6, cursor: 'pointer',
          background: inputMode === 'video' ? '#ff6666' : '#333',
          color: inputMode === 'video' ? '#000' : '#888',
          fontWeight: 700, fontSize: 13, fontFamily: 'monospace',
        }}>VIDEO</button>
        <span style={{ color: '#888', fontSize: 12, marginLeft: 16, marginRight: 4 }}>Model:</span>
        <button onClick={() => setModelUrl('/seed-san.vrm')} style={{
          padding: '6px 16px', border: 'none', borderRadius: 6, cursor: 'pointer',
          background: modelUrl === '/seed-san.vrm' ? '#66ccff' : '#333',
          color: modelUrl === '/seed-san.vrm' ? '#000' : '#888',
          fontWeight: 700, fontSize: 13, fontFamily: 'monospace',
        }}>SEED-SAN</button>
        <button onClick={() => setModelUrl('/avatar.vrm')} style={{
          padding: '6px 16px', border: 'none', borderRadius: 6, cursor: 'pointer',
          background: modelUrl === '/avatar.vrm' ? '#ffcc66' : '#333',
          color: modelUrl === '/avatar.vrm' ? '#000' : '#888',
          fontWeight: 700, fontSize: 13, fontFamily: 'monospace',
        }}>OUR AVATAR</button>
      </div>
      <div style={{
        display: 'flex', gap: 24, alignItems: 'center', marginBottom: 12,
        padding: '8px 12px', background: '#222', borderRadius: 6, fontSize: 13,
      }}>
        <span>Status: <span style={{ color: statusStore.mpLoaded ? '#0f0' : '#ff0' }}>{status}</span></span>
        <span>FPS: <strong style={{ color: '#0ff' }}>{fps}</strong></span>
        <span>Bones: <strong style={{ color: '#f80' }}>{boneCount}</strong></span>
      </div>
      {debug && (
        <div style={{ padding: '4px 12px', background: '#1a1a2e', borderRadius: 4, fontSize: 11, color: '#8af', marginBottom: 8, wordBreak: 'break-all' }}>
          {debug}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#888' }}>
            {inputMode === 'webcam' ? 'Webcam' : 'Video'} + Landmarks
          </h3>
          <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
            <video ref={webcamRef} muted playsInline style={{
              width: '100%', display: inputMode === 'webcam' ? 'block' : 'none',
              transform: 'scaleX(-1)',
            }} />
            <video ref={videoRef} src={videoSrc} loop muted playsInline crossOrigin="anonymous" style={{
              width: '100%', display: inputMode === 'video' ? 'block' : 'none',
            }} />
            <canvas ref={canvasRef} style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              pointerEvents: 'none',
              transform: inputMode === 'webcam' ? 'scaleX(-1)' : 'none',
            }} />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#888' }}>
            VRM Avatar (Direct landmarks)
          </h3>
          <div style={{ height: 480, background: '#1a1a2e', borderRadius: 8, overflow: 'hidden' }}>
            <ErrorBoundary>
              <Suspense fallback={
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 14 }}>Loading VRM...</div>
              }>
                <Canvas
                  key={modelUrl}
                  frameloop="always"
                  camera={{ position: [0, 1.2, 2.0], fov: 40, near: 0.1, far: 20 }}
                  gl={{ alpha: true, antialias: true }}
                  style={{ width: '100%', height: '100%' }}
                  onCreated={({ gl }) => { gl.setClearColor(0x1a1a2e, 1); gl.outputColorSpace = THREE.SRGBColorSpace }}
                >
                  <ambientLight intensity={0.7} />
                  <directionalLight position={[0, 2, 3]} intensity={0.9} />
                  <VrmModel modelUrl={modelUrl} />
                </Canvas>
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  )
}
