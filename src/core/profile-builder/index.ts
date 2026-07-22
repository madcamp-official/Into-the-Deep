import type { FrameFeature, UserProfile } from "../types";

const MIN_CONFIDENCE = 0.8;

const PROFILE_FEATURES = [
  "shoulderTilt",
  "headXOffset",
  "shoulderXOffset",
  "shoulderYOffset",
  "bodyScale",
  "faceToShoulderRatio",
  "pitchProxy",
  "yawProxy",
  // Needed as calibration baselines for the forwardHead/forwardLean rules
  // (fixed-threshold-detector) and the V2 drift score (personalized-detector).
  "headXRatio",
  "headShoulderDistanceRatio",
  "bodyCompressionRatio",
  "headRoll",
  "relativeShoulderScale",
  // Needed as calibration baselines for posture-rule-detector's generic
  // CALIBRATION-reference normalization (FORWARD_LEAN, BACKWARD_LEAN,
  // HEAD_TURN, HEAD_BACK, TORSO_TWIST rules).
  "correctedYaw",
  "forwardLeanProxy",
  "shoulderWidthRatio",
  // Missing from this list meant CHIN_REST's handFaceDistance condition had
  // no CALIBRATION center to normalize against, so it always scored
  // undefined and the rule could never match — confirmed live via the
  // capture button (feature values present, no score shown).
  "handFaceDistance",
  "handShoulderDistance",
  // Needed as calibration baselines for ARMREST_LEAN's raw (non-scale-
  // normalized) screen-position conditions.
  "shoulderCenterX",
  "shoulderCenterY",
  // Averaging the per-calibration-frame self-estimated body-yaw angle
  // (see feature-normalizer's estimateBodyYawAngle) into one stable value
  // is the whole point of the fixed-angle correction — a fresh per-frame
  // estimate was confirmed live to swing ~27 degrees on a stationary
  // subject, too noisy to use directly. Median (not circular mean) is fine
  // here since real sitting angles don't wrap around +-180 degrees.
  "bodyYawAngle",
  // Needed as a calibration baseline for TORSO_TWIST's faceSize ABS_LT
  // guard (see posture-rules/index.ts) — "face size roughly unchanged from
  // calibration" needs a CALIBRATION-reference center to compare against.
  "faceSize",
] as const satisfies readonly (keyof FrameFeature)[];

export function buildUserProfile(calibrationFrames: FrameFeature[]): UserProfile {
  const validFrames = calibrationFrames.filter(
    (frame) => frame.confidence >= MIN_CONFIDENCE,
  );

  const originalCenters: Record<string, number> = {};
  const featureDeviations: Record<string, number> = {};

  for (const feature of PROFILE_FEATURES) {
    const values = validFrames
      .map((frame) => frame[feature])
      .filter((value): value is number => value !== undefined);
    if (values.length === 0) {
      continue;
    }

    const center = median(values);

    originalCenters[feature] = center;
    featureDeviations[feature] = median(
      values.map((value) => Math.abs(value - center)),
    );
  }

  return {
    originalCenters,
    adaptiveCenters: { ...originalCenters },
    featureDeviations,
    calibrationDuration: getCalibrationDuration(validFrames),
    validFrameCount: validFrames.length,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function getCalibrationDuration(validFrames: FrameFeature[]): number {
  if (validFrames.length < 2) {
    return 0;
  }

  return validFrames[validFrames.length - 1].timestamp - validFrames[0].timestamp;
}
