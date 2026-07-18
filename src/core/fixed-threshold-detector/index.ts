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
      feature.headYOffset,
      referenceCenters.headYOffset,
      thresholds.headYOffsetRatio,
    )
  ) {
    reason.push("headYOffset");
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

  if (
    feature.torsoLean !== undefined &&
    exceedsAbsoluteThreshold(
      feature.torsoLean,
      referenceCenters.torsoLean,
      thresholds.torsoLeanDeg,
    )
  ) {
    reason.push("torsoLean");
  }

  const bad = reason.length > 0;

  return {
    timestamp: feature.timestamp,
    state: bad ? "BAD" : "STABLE",
    alert: bad,
    reason,
  };
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
