/**
 * Pre-compute VRM bone rotations from Kalidokit-format pose data.
 *
 * Reads each pose JSON (format: "kalidokit"), runs Kalidokit Pose.solve
 * and Hand.solve per frame, then saves the resulting bone Euler rotations
 * so the frontend can apply them directly without runtime solving.
 *
 * Key improvements over runtime solving:
 *  - Visibility values forced high → avoids Kalidokit offscreen detection
 *  - Screen-Y clamped → avoids "bottom of screen" rest-pose fallback
 *  - Temporal smoothing applied to bone rotations after solving
 */

import { Pose, Hand } from 'kalidokit/dist/kalidokit.es.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const POSES_DIR = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/data/poses')
const SMOOTH_RADIUS = 2 // average over ±2 frames (5-frame window)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function xyz(v) {
  if (!v) return [0, 0, 0]
  return [v.x || 0, v.y || 0, v.z || 0]
}

function mapHandBones(bones, rig, side, prefix) {
  if (!rig) return
  // Wrist → hand bone
  bones[`${prefix}Hand`] = xyz(rig[`${side}Wrist`])
  // Thumb: Kalidokit names are offset by one joint from VRM names
  bones[`${prefix}ThumbMetacarpal`] = xyz(rig[`${side}ThumbProximal`])
  bones[`${prefix}ThumbProximal`] = xyz(rig[`${side}ThumbIntermediate`])
  bones[`${prefix}ThumbDistal`] = xyz(rig[`${side}ThumbDistal`])
  // Other fingers map directly
  for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
    for (const joint of ['Proximal', 'Intermediate', 'Distal']) {
      bones[`${prefix}${finger}${joint}`] = xyz(rig[`${side}${finger}${joint}`])
    }
  }
}

/** Temporal smoothing: average bone rotations across a window of frames. */
function smoothBoneFrames(boneFrames, radius) {
  if (radius <= 0 || boneFrames.length <= 1) return boneFrames

  const allBoneNames = Object.keys(boneFrames[0].bones)
  const result = []

  for (let i = 0; i < boneFrames.length; i++) {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(boneFrames.length - 1, i + radius)
    const windowSize = hi - lo + 1

    const smoothedBones = {}
    for (const name of allBoneNames) {
      let sx = 0, sy = 0, sz = 0
      for (let j = lo; j <= hi; j++) {
        const v = boneFrames[j].bones[name]
        if (v) { sx += v[0]; sy += v[1]; sz += v[2] }
      }
      smoothedBones[name] = [sx / windowSize, sy / windowSize, sz / windowSize]
    }

    result.push({
      bones: smoothedBones,
      pose: boneFrames[i].pose,
      left_hand: boneFrames[i].left_hand,
      right_hand: boneFrames[i].right_hand,
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const files = fs.readdirSync(POSES_DIR).filter(f => f.endsWith('.json'))
console.log(`Pre-computing bone rotations for ${files.length} pose files...\n`)

let success = 0
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(POSES_DIR, file), 'utf-8'))

  if (data.format !== 'kalidokit') {
    console.log(`  SKIP ${file} (format: ${data.format || 'unknown'})`)
    continue
  }

  const rawBoneFrames = data.frames.map(frame => {
    // Force high visibility and clamp screen Y to bypass offscreen detection
    const world3d = frame.pose_world.map(lm => ({
      x: lm[0], y: lm[1], z: lm[2],
      visibility: Math.max(lm[3] || 0, 0.9),
    }))
    const screen2d = frame.pose_screen.map(lm => ({
      x: lm[0],
      y: Math.min(lm[1], 0.98), // clamp to avoid "bottom of screen" trigger
      z: lm[2],
      visibility: Math.max(lm[3] || 0, 0.9),
    }))

    const poseRig = Pose.solve(world3d, screen2d, {
      runtime: 'mediapipe',
      enableLegs: false,
    })

    const bones = {}
    if (poseRig) {
      if (poseRig.Hips?.rotation) bones.hips = xyz(poseRig.Hips.rotation)
      bones.spine = xyz(poseRig.Spine)
      bones.leftUpperArm = xyz(poseRig.LeftUpperArm)
      bones.leftLowerArm = xyz(poseRig.LeftLowerArm)
      bones.rightUpperArm = xyz(poseRig.RightUpperArm)
      bones.rightLowerArm = xyz(poseRig.RightLowerArm)
      bones.leftHand = xyz(poseRig.LeftHand)
      bones.rightHand = xyz(poseRig.RightHand)
    }

    // Hands
    const hasLeft = frame.left_hand.some(lm => lm[0] !== 0 || lm[1] !== 0)
    const hasRight = frame.right_hand.some(lm => lm[0] !== 0 || lm[1] !== 0)

    if (hasLeft) {
      const lh = Hand.solve(
        frame.left_hand.map(lm => ({ x: lm[0], y: lm[1], z: lm[2] })),
        'Left',
      )
      mapHandBones(bones, lh, 'Left', 'left')
    }
    if (hasRight) {
      const rh = Hand.solve(
        frame.right_hand.map(lm => ({ x: lm[0], y: lm[1], z: lm[2] })),
        'Right',
      )
      mapHandBones(bones, rh, 'Right', 'right')
    }

    return {
      bones,
      pose: frame.pose,
      left_hand: frame.left_hand,
      right_hand: frame.right_hand,
    }
  })

  // Apply temporal smoothing to bone rotations
  const smoothedFrames = smoothBoneFrames(rawBoneFrames, SMOOTH_RADIUS)

  const output = {
    fps: data.fps,
    width: data.width,
    height: data.height,
    format: 'vrm_bones',
    frames: smoothedFrames,
  }

  fs.writeFileSync(path.join(POSES_DIR, file), JSON.stringify(output))

  const boneCount = Object.keys(smoothedFrames[0]?.bones || {}).length
  console.log(`  OK ${file} — ${smoothedFrames.length} frames, ${boneCount} bones`)
  success++
}

console.log(`\nDone: ${success}/${files.length} pre-computed`)
