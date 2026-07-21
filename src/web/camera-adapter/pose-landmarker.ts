import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Day1 draft: loads MediaPipe's pretrained PoseLandmarker over CDN assets
// (see plan.md section 6.1). Model choice / self-hosting the assets is a
// later optimization, not a Day1 concern.
export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_ASSET_PATH,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    // 2, not 1: this MVP only ever tracks/scores one primary person
    // (selectPrimaryLandmarks() picks which of the returned poses that
    // is), but detecting a 2nd pose is what lets personCount
    // (feature_discussion's "다른 사람이 화면에 들어옴") notice someone else
    // stepping into frame at all.
    numPoses: 2,
  });
}

export function detectPoseForVideoFrame(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): PoseLandmarkerResult {
  return landmarker.detectForVideo(video, timestampMs);
}

export function countPersons(result: PoseLandmarkerResult): number {
  return result.landmarks.length;
}

// Shoulder-center position (normalized 0-1 frame coordinates), used as a
// lightweight identity anchor to keep tracking the same physical person
// across frames.
export interface PersonAnchor {
  x: number;
  y: number;
}

// MediaPipe's per-frame pose ordering isn't identity-stable: with numPoses
// > 1, landmarks[0] is whichever pose the model ranks first *this frame*,
// not "the same person as last frame". Confirmed as the cause of user
// reports that a second person entering frame (a colleague standing behind
// the laptop, someone joining a call) would occasionally steal the
// tracked landmarks. Fix: pick the pose whose shoulder center is closest
// to where the tracked user was last seen, instead of always trusting
// index 0.
export function selectPrimaryLandmarks(
  result: PoseLandmarkerResult,
  anchor: PersonAnchor | null,
): NormalizedLandmark[] | undefined {
  const { landmarks } = result;
  if (landmarks.length <= 1) return landmarks[0];

  if (!anchor) {
    // No established identity yet (first frame of a session): assume the
    // largest figure in frame is the laptop's user, since anyone else in
    // frame is almost always farther from the camera.
    return landmarks.reduce((closest, candidate) =>
      shoulderWidthOf(candidate) > shoulderWidthOf(closest) ? candidate : closest,
    );
  }

  return landmarks.reduce((closest, candidate) =>
    distanceToAnchor(candidate, anchor) < distanceToAnchor(closest, anchor) ? candidate : closest,
  );
}

// Call with whatever selectPrimaryLandmarks() returned to update the
// anchor for the next frame.
export function anchorFromLandmarks(landmarks: NormalizedLandmark[]): PersonAnchor | null {
  return shoulderCenterOf(landmarks);
}

function shoulderCenterOf(landmarks: NormalizedLandmark[]): PersonAnchor | null {
  const leftShoulder = landmarks[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks[LANDMARK_INDEX.rightShoulder];
  if (!leftShoulder || !rightShoulder) return null;
  return {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
  };
}

function shoulderWidthOf(landmarks: NormalizedLandmark[]): number {
  const leftShoulder = landmarks[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks[LANDMARK_INDEX.rightShoulder];
  if (!leftShoulder || !rightShoulder) return 0;
  return Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y);
}

function distanceToAnchor(landmarks: NormalizedLandmark[], anchor: PersonAnchor): number {
  const center = shoulderCenterOf(landmarks);
  if (!center) return Infinity;
  return Math.hypot(center.x - anchor.x, center.y - anchor.y);
}

// MediaPipe Pose landmark indices used across the pipeline (nose, eyes,
// shoulders, hips) — see plan.md section 8.
export const LANDMARK_INDEX = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  // Closest available point to "chin" — BlazePose's 33-point layout has no
  // dedicated chin/jaw landmark; Face Mesh (468 points) would, but that's a
  // separate, much heavier model not worth it just for this.
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  // Elbows are only used for skeleton-overlay drawing continuity
  // (shoulder->elbow->wrist), not for any feature computation — see
  // need_discussion's "팔꿈치 없애기" decision on the feature side.
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;
