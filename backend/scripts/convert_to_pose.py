"""Convert sign MP4 videos to .pose files using MediaPipe Holistic."""
import os
import glob

def convert_video_to_pose(video_path: str, output_path: str):
    from pose_format.pose_header import PoseHeader, PoseHeaderDimensions, PoseHeaderComponent
    from pose_format import Pose
    import mediapipe as mp
    import cv2
    import numpy as np

    mp_holistic = mp.solutions.holistic
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    all_frames_data = []

    with mp_holistic.Holistic(
        static_image_mode=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as holistic:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = holistic.process(rgb)

            frame_data = {}

            # extract pose landmarks
            if results.pose_landmarks:
                frame_data["pose"] = [
                    (lm.x * width, lm.y * height, lm.z * width, lm.visibility)
                    for lm in results.pose_landmarks.landmark
                ]
            else:
                frame_data["pose"] = [(0, 0, 0, 0)] * 33

            # extract hand landmarks
            for hand_name, hand_landmarks in [
                ("left_hand", results.left_hand_landmarks),
                ("right_hand", results.right_hand_landmarks),
            ]:
                if hand_landmarks:
                    frame_data[hand_name] = [
                        (lm.x * width, lm.y * height, lm.z * width, 1.0)
                        for lm in hand_landmarks.landmark
                    ]
                else:
                    frame_data[hand_name] = [(0, 0, 0, 0)] * 21

            all_frames_data.append(frame_data)

    cap.release()

    if not all_frames_data:
        return False

    # save as JSON (simpler than .pose binary for hackathon)
    import json
    pose_data = {
        "fps": fps,
        "width": width,
        "height": height,
        "frames": [
            {
                "pose": f["pose"],
                "left_hand": f["left_hand"],
                "right_hand": f["right_hand"],
            }
            for f in all_frames_data
        ],
    }

    with open(output_path, "w") as f:
        json.dump(pose_data, f)

    return True


def main():
    signs_dir = os.path.join(os.path.dirname(__file__), "..", "data", "signs")
    poses_dir = os.path.join(os.path.dirname(__file__), "..", "data", "poses")
    os.makedirs(poses_dir, exist_ok=True)

    videos = sorted(glob.glob(os.path.join(signs_dir, "*.mp4")))
    print(f"Converting {len(videos)} videos to pose data...\n")

    success = 0
    for video in videos:
        name = os.path.splitext(os.path.basename(video))[0]
        output = os.path.join(poses_dir, f"{name}.json")

        if os.path.exists(output):
            print(f"  EXISTS {name}")
            success += 1
            continue

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
