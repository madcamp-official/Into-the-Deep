import type { FrameFeature, DetectionEvent } from "../types";

export interface FixedThresholds {
  shoulderTiltDeg: number;
  headXOffsetRatio: number;
  headYOffsetRatio: number;
  bodyScaleIncreaseRatio: number;
  torsoLeanDeg: number;
  sustainedSeconds: number;
}

export const DEFAULT_THRESHOLDS: FixedThresholds = {
  shoulderTiltDeg: 8,
  headXOffsetRatio: 0.2,
  headYOffsetRatio: 0.18,
  bodyScaleIncreaseRatio: 0.25,
  torsoLeanDeg: 10,
  sustainedSeconds: 1.5,
};

// TODO(B): compare `feature` against calibration centers using DEFAULT_THRESHOLDS,
// track BAD duration, and emit a DetectionEvent once sustainedSeconds is exceeded.
export function evaluateV0(
  feature: FrameFeature,
  referenceCenters: Record<string, number>,
  thresholds: FixedThresholds = DEFAULT_THRESHOLDS,
): DetectionEvent {
  void feature;
  void referenceCenters;
  void thresholds;
  throw new Error("not implemented");
}
