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

    const average =
      values.reduce((sum, value) => sum + value, 0) /
      values.length;

    originalCenters[feature] = average;
    featureDeviations[feature] = 0;
  }

  return {
    originalCenters,
    adaptiveCenters: { ...originalCenters },
    featureDeviations,
    calibrationDuration: getCalibrationDuration(validFrames),
    validFrameCount: validFrames.length,
  };
}

function getCalibrationDuration(validFrames: FrameFeature[]): number {
  if (validFrames.length < 2) {
    return 0;
  }

  return validFrames[validFrames.length - 1].timestamp - validFrames[0].timestamp;
}
