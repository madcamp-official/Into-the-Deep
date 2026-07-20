import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";
import type { CameraDelta, CameraProfile, CameraRawFeature } from "../types";

const CAMERA_PROFILE_FIELDS = [
  "shoulderWidth",
  "faceCenterX",
  "faceCenterY",
  "shoulderCenterX",
  "shoulderCenterY",
  "faceToShoulderRatio",
  "yawProxy",
  "pitchProxy",
] as const satisfies readonly (keyof CameraProfile)[];

export function buildCameraProfile(
  calibrationFrames: CameraRawFeature[],
): CameraProfile | null {
  if (calibrationFrames.length === 0) {
    return null;
  }

  const profile = {} as CameraProfile;

  for (const field of CAMERA_PROFILE_FIELDS) {
    profile[field] = median(calibrationFrames.map((frame) => frame[field]));
  }

  return profile;
}

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

// Raw camera-relative deltas (feature_discussion's globalScaleDelta,
// globalTranslationX/Y, correctedYaw) — calibration-relative, but computed
// straight from CameraProfile like the rest of A's camera-raw work, not
// from UserProfile. B's CameraAssessment turns these into a
// VALID/ADJUSTED/RECALIBRATION_REQUIRED judgment (plan_compact.md 부담
// 조정 포인트).
export function computeCameraDelta(
  current: CameraRawFeature,
  profile: CameraProfile,
): CameraDelta {
  return {
    timestamp: current.timestamp,
    globalScaleDelta:
      profile.shoulderWidth > 0
        ? (current.shoulderWidth - profile.shoulderWidth) / profile.shoulderWidth
        : 0,
    globalTranslationX: current.shoulderCenterX - profile.shoulderCenterX,
    globalTranslationY: current.shoulderCenterY - profile.shoulderCenterY,
    // baselineYawOffset per feature_discussion is exactly profile.yawProxy
    // (the calibration-time yawProxy, already stored) — no new profile
    // field needed, just subtract it here.
    correctedYaw: current.yawProxy - profile.yawProxy,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
