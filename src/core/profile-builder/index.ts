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
  // Needed as calibration baselines for posture-rule-detector's generic
  // CALIBRATION-reference normalization (FORWARD_LEAN, BACKWARD_LEAN,
  // HEAD_TURN, HEAD_BACK, TORSO_TWIST rules).
  "correctedYaw",
  "forwardLeanProxy",
  "shoulderWidthRatio",
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
