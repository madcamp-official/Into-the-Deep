import {
  FilesetResolver,
  PoseLandmarker,
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
    // (result.landmarks[0]), but detecting a 2nd pose is what lets
    // personCount (feature_discussion's "다른 사람이 화면에 들어옴") notice
    // someone else stepping into frame at all.
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

// MediaPipe Pose landmark indices used across the pipeline (nose, eyes,
// shoulders, hips) — see plan.md section 8.
export const LANDMARK_INDEX = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
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
