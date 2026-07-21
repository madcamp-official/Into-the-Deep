import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Separate model from PoseLandmarker (Pose's 33 points have no full hand
// mesh — see pose-landmarker's LANDMARK_INDEX comment). Runs its own
// inference pass per frame, so this is strictly more expensive than reusing
// pose landmarks; only wired in because handFaceDistance/handShoulderDistance
// (chin-rest detection) need a point closer to the fingers than the wrist.
export async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_ASSET_PATH,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    // Only one hand is ever actually near the face/chin at a time (the
    // other arm may be resting on a desk or out of frame), but 2 keeps both
    // available so feature-normalizer can pick whichever is actually closer
    // to the mouth, same pattern as the old wrist-based selection.
    numHands: 2,
  });
}

export function detectHandsForVideoFrame(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): HandLandmarkerResult {
  return landmarker.detectForVideo(video, timestampMs);
}

// MediaPipe HandLandmarker's 21-point layout (see the model's official
// landmark diagram) — only the palm-center point is used today.
export const HAND_LANDMARK_INDEX = {
  wrist: 0,
  // Base of the middle finger: sits roughly at the palm's center, a much
  // steadier "where is the hand" point than any single fingertip.
  middleFingerMcp: 9,
} as const;
