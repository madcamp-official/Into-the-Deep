import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";
import type { CameraRawFeature } from "../types";

// Day2 draft: computes the raw camera-framing signals B's Camera Profile
// Validator needs (plan.md section 9). A only produces these numbers —
// deciding whether a change is a small correctable drift vs. a
// RECALIBRATION_REQUIRED jump is B's job (plan.md section 22, "부담 조정 포인트").
export function toCameraRawFeature(
  landmarks: NormalizedLandmark[],
  timestamp: number,
): CameraRawFeature | null {
  const nose = landmarks[LANDMARK_INDEX.nose];
  const leftEye = landmarks[LANDMARK_INDEX.leftEye];
  const rightEye = landmarks[LANDMARK_INDEX.rightEye];
  const leftEar = landmarks[LANDMARK_INDEX.leftEar];
  const rightEar = landmarks[LANDMARK_INDEX.rightEar];
  const leftShoulder = landmarks[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks[LANDMARK_INDEX.rightShoulder];
  if (!nose || !leftEye || !rightEye || !leftShoulder || !rightShoulder) return null;

  const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderCenterY = (leftShoulder.y + rightShoulder.y) / 2;
  const shoulderWidth = Math.hypot(
    rightShoulder.x - leftShoulder.x,
    rightShoulder.y - leftShoulder.y,
  );

  const faceCenterX = (leftEye.x + rightEye.x) / 2;
  const faceCenterY = (leftEye.y + rightEye.y) / 2;
  const eyeDistance = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  const faceToShoulderRatio = shoulderWidth > 0 ? eyeDistance / shoulderWidth : 0;

  // Head-turn proxy: how asymmetric the nose sits between the two ears.
  // Facing the camera straight-on keeps this near 0.
  let yawProxy = 0;
  if (leftEar && rightEar) {
    const leftDist = Math.abs(nose.x - leftEar.x);
    const rightDist = Math.abs(nose.x - rightEar.x);
    const total = leftDist + rightDist;
    yawProxy = total > 0 ? (leftDist - rightDist) / total : 0;
  }

  // Head-tilt proxy: nose position relative to the eye line, scaled by
  // shoulder width so it stays comparable across camera distances.
  const pitchProxy = shoulderWidth > 0 ? (nose.y - faceCenterY) / shoulderWidth : 0;

  return {
    timestamp,
    shoulderWidth,
    faceCenterX,
    faceCenterY,
    shoulderCenterX,
    shoulderCenterY,
    faceToShoulderRatio,
    yawProxy,
    pitchProxy,
  };
}
