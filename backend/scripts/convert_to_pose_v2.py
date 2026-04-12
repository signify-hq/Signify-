"""Convert sign MP4 videos to pose JSON with BOTH world and screen landmarks.

This version saves data in the exact format Kalidokit expects:
  - pose_world: 33 world landmarks (3D meters, hip-centered) → Kalidokit.Pose.solve arg 1
  - pose_screen: 33 screen landmarks (normalized 0-1) → Kalidokit.Pose.solve arg 2
  - left_hand / right_hand: 21 hand landmarks (normalized 0-1) → Kalidokit.Hand.solve
"""
import os
import glob


def convert_video_to_pose(video_path: str, output_path: str):
    import mediapipe as mp
    import cv2
    import json

    mp_holistic = mp.solutions.holistic
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    all_frames = []

    with mp_holistic.Holistic(
        static_image_mode=False,
        model_complexity=2,  # highest quality for better hand detection
        min_detection_confidence=0.3,  # lower threshold to catch more hands
        min_tracking_confidence=0.3,
    ) as holistic:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = holistic.process(rgb)

            frame_data = {}

            # --- Pose: save BOTH world and screen landmarks ---
            if results.pose_world_landmarks:
                frame_data["pose_world"] = [
                    [lm.x, lm.y, lm.z, lm.visibility]
                    for lm in results.pose_world_landmarks.landmark
                ]
            else:
                frame_data["pose_world"] = [[0, 0, 0, 0]] * 33

            if results.pose_landmarks:
                frame_data["pose_screen"] = [
                    [lm.x, lm.y, lm.z, lm.visibility]
                    for lm in results.pose_landmarks.landmark
                ]
            else:
                frame_data["pose_screen"] = [[0, 0, 0, 0]] * 33

            # Also keep the pixel-space version for stick figure fallback
            if results.pose_landmarks:
                frame_data["pose"] = [
                    [lm.x * width, lm.y * height, lm.z * width, lm.visibility]
                    for lm in results.pose_landmarks.landmark
                ]
            else:
                frame_data["pose"] = [[0, 0, 0, 0]] * 33

            # --- Hands: normalized 0-1 (what Kalidokit.Hand.solve expects) ---
            for hand_name, hand_landmarks in [
                ("left_hand", results.left_hand_landmarks),
                ("right_hand", results.right_hand_landmarks),
            ]:
                if hand_landmarks:
                    frame_data[hand_name] = [
                        [lm.x, lm.y, lm.z, 1.0]
                        for lm in hand_landmarks.landmark
                    ]
                else:
                    frame_data[hand_name] = [[0, 0, 0, 0]] * 21

            all_frames.append(frame_data)

    cap.release()

    if not all_frames:
        return False

    pose_data = {
        "fps": fps,
        "width": width,
        "height": height,
        "format": "kalidokit",  # marks this as v2 format
        "frames": all_frames,
    }

    with open(output_path, "w") as f:
        json.dump(pose_data, f)

    return True


def main():
    signs_dir = os.path.join(os.path.dirname(__file__), "..", "data", "signs")
    poses_dir = os.path.join(os.path.dirname(__file__), "..", "data", "poses")
    os.makedirs(poses_dir, exist_ok=True)

    videos = sorted(glob.glob(os.path.join(signs_dir, "*.mp4")))
    print(f"Re-converting {len(videos)} videos to Kalidokit-compatible pose data...\n")

    success = 0
    for video in videos:
        name = os.path.splitext(os.path.basename(video))[0]
        output = os.path.join(poses_dir, f"{name}.json")

        print(f"  Converting {name}... ", end="", flush=True)
        try:
            if convert_video_to_pose(video, output):
                print("OK")
                success += 1
            else:
                print("EMPTY")
        except Exception as e:
            print(f"FAILED: {e}")

    print(f"\nDone: {success}/{len(videos)} converted")


if __name__ == "__main__":
    main()
