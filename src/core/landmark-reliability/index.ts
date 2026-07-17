import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";
import type { LandmarkQuality } from "../types";

export const RELIABILITY_THRESHOLDS = {
  minConfidence: 0.5,
  // Distance from the 0..1 frame edge a landmark must clear to count as
  // "in frame" — a small margin so partially-clipped shoulders/face
  // register as unreliable before they fully leave the image.
  frameMargin: 0.02,
};

// Day2 draft of the Reliability Filter (plan.md section 8). Frames that
// fail this check should be treated as UNKNOWN by downstream detectors,
// not as BAD posture. Sudden landmark jumps are a Day3 concern once we
// have a motion-energy baseline to compare against.
export function assessLandmarkQuality(
  landmarks: NormalizedLandmark[] | undefined,
  timestamp: number,
): LandmarkQuality {
  const nose = landmarks?.[LANDMARK_INDEX.nose];
  const leftShoulder = landmarks?.[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks?.[LANDMARK_INDEX.rightShoulder];

  const personPresent = Boolean(nose && leftShoulder && rightShoulder);
  if (!personPresent || !nose || !leftShoulder || !rightShoulder) {
    return {
      timestamp,
      personPresent: false,
      faceInFrame: false,
      shouldersInFrame: false,
      confidence: 0,
      reliable: false,
    };
  }

  const confidence = Math.min(nose.visibility, leftShoulder.visibility, rightShoulder.visibility);
  const faceInFrame = isInFrame(nose);
  const shouldersInFrame = isInFrame(leftShoulder) && isInFrame(rightShoulder);
  const reliable = faceInFrame && shouldersInFrame && confidence >= RELIABILITY_THRESHOLDS.minConfidence;

  return { timestamp, personPresent, faceInFrame, shouldersInFrame, confidence, reliable };
}

function isInFrame(point: NormalizedLandmark): boolean {
  const m = RELIABILITY_THRESHOLDS.frameMargin;
  return point.x > m && point.x < 1 - m && point.y > m && point.y < 1 - m;
}
