import type { FrameFeature, DetectionEvent } from "../types";

export interface FixedThresholds {
  shoulderTiltDeg: number;
  headXOffsetRatio: number;
  shoulderXOffsetRatio: number;
  shoulderYOffsetRatio: number;
  bodyScaleIncreaseRatio: number;
  forwardHeadFaceRatioIncrease: number;
  forwardHeadBodyScaleToleranceRatio: number;
  forwardHeadPitchDeltaRatio: number;
  sustainedSeconds: number;
}

export const DEFAULT_THRESHOLDS: FixedThresholds = {
  shoulderTiltDeg: 8,
  headXOffsetRatio: 0.2,
  shoulderXOffsetRatio: 0.15,
  shoulderYOffsetRatio: 0.18,
  bodyScaleIncreaseRatio: 0.25,
  forwardHeadFaceRatioIncrease: 0.025,
  forwardHeadBodyScaleToleranceRatio: 0.3,
  forwardHeadPitchDeltaRatio: 0.01,
  sustainedSeconds: 1.5,
};

export function evaluateV0(
  feature: FrameFeature,
  referenceCenters: Record<string, number>,
  thresholds: FixedThresholds = DEFAULT_THRESHOLDS,
): DetectionEvent {
  const reason: string[] = [];

  if (
    exceedsAbsoluteThreshold(
      feature.shoulderTilt,
      referenceCenters.shoulderTilt,
      thresholds.shoulderTiltDeg,
    )
  ) {
    reason.push("shoulderTilt");
  }

  if (
    exceedsAbsoluteThreshold(
      feature.headXOffset,
      referenceCenters.headXOffset,
      thresholds.headXOffsetRatio,
    )
  ) {
    reason.push("headXOffset");
  }

  if (
    exceedsAbsoluteThreshold(
      feature.shoulderXOffset,
      referenceCenters.shoulderXOffset,
      thresholds.shoulderXOffsetRatio,
    )
  ) {
    reason.push("shoulderXOffset");
  }

  if (
    exceedsAbsoluteThreshold(
      feature.shoulderYOffset,
      referenceCenters.shoulderYOffset,
      thresholds.shoulderYOffsetRatio,
    )
  ) {
    reason.push("shoulderYOffset");
  }

  if (
    exceedsIncreaseRatio(
      feature.bodyScale,
      referenceCenters.bodyScale,
      thresholds.bodyScaleIncreaseRatio,
    )
  ) {
    reason.push("bodyScale");
  }

  if (isForwardHead(feature, referenceCenters, thresholds)) {
    reason.push("forwardHead");
  }

  const bad = reason.length > 0;

  return {
    timestamp: feature.timestamp,
    state: bad ? "BAD" : "STABLE",
    alert: bad,
    reason,
  };
}

function isForwardHead(
  feature: FrameFeature,
  referenceCenters: Record<string, number>,
  thresholds: FixedThresholds,
): boolean {
  return (
    feature.faceToShoulderRatio !== undefined &&
    feature.pitchProxy !== undefined &&
    exceedsIncreaseRatio(
      feature.faceToShoulderRatio,
      referenceCenters.faceToShoulderRatio,
      thresholds.forwardHeadFaceRatioIncrease,
    ) &&
    withinRelativeTolerance(
      feature.bodyScale,
      referenceCenters.bodyScale,
      thresholds.forwardHeadBodyScaleToleranceRatio,
    ) &&
    exceedsPositiveDelta(
      feature.pitchProxy,
      referenceCenters.pitchProxy,
      thresholds.forwardHeadPitchDeltaRatio,
    )
  );
}

export class FixedThresholdDetector {
  private badStartedAt: number | null = null;
  private readonly referenceCenters: Record<string, number>;
  private readonly thresholds: FixedThresholds;

  constructor(
    referenceCenters: Record<string, number>,
    thresholds: FixedThresholds = DEFAULT_THRESHOLDS,
  ) {
    this.referenceCenters = referenceCenters;
    this.thresholds = thresholds;
  }

  update(feature: FrameFeature): DetectionEvent {
    const frameEvent = evaluateV0(
      feature,
      this.referenceCenters,
      this.thresholds,
    );

    if (frameEvent.state !== "BAD") {
      this.reset();
      return frameEvent;
    }

    if (
      this.badStartedAt === null ||
      feature.timestamp < this.badStartedAt
    ) {
      this.badStartedAt = feature.timestamp;
    }

    const sustainedDurationSeconds =
      (feature.timestamp - this.badStartedAt) / 1000;

    return {
      ...frameEvent,
      alert: sustainedDurationSeconds >= this.thresholds.sustainedSeconds,
    };
  }

  reset(): void {
    this.badStartedAt = null;
  }
}

function exceedsAbsoluteThreshold(
  currentValue: number,
  referenceValue: number | undefined,
  threshold: number,
): boolean {
  if (referenceValue === undefined) {
    return false;
  }

  return Math.abs(currentValue - referenceValue) > threshold;
}

function exceedsIncreaseRatio(
  currentValue: number,
  referenceValue: number | undefined,
  increaseRatio: number,
): boolean {
  if (referenceValue === undefined || referenceValue <= 0) {
    return false;
  }

  return currentValue > referenceValue * (1 + increaseRatio);
}

function exceedsPositiveDelta(
  currentValue: number,
  referenceValue: number | undefined,
  threshold: number,
): boolean {
  if (referenceValue === undefined) {
    return false;
  }

  return currentValue - referenceValue > threshold;
}

function withinRelativeTolerance(
  currentValue: number,
  referenceValue: number | undefined,
  toleranceRatio: number,
): boolean {
  if (referenceValue === undefined || referenceValue <= 0) {
    return false;
  }

  return Math.abs(currentValue - referenceValue) / referenceValue <= toleranceRatio;
}
