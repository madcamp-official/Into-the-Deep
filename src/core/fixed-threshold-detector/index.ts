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
  yawProxyRatio: number;
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
  // Candidate value, not yet tuned against a development session (plan.md
  // "정면 약 30도" is a rough qualitative guide, not a ratio in this unit).
  yawProxyRatio: 0.3,
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

  const forwardHeadResult = evaluateForwardHead(feature, referenceCenters, thresholds);
  if (forwardHeadResult === "BAD") {
    reason.push("forwardHead");
  } else if (forwardHeadResult === "SKIPPED_LOW_CONFIDENCE") {
    // Not a BAD trigger — faceToShoulderRatio/pitchProxy couldn't be
    // computed because the eye landmarks weren't reliable enough
    // (feature-normalizer's eyesReliable gate). Surfaced separately from
    // "conditions checked but not met" so this doesn't get silently
    // conflated with a real forwardHead=false in logs/replay analysis.
    reason.push("forwardHead_skipped_low_confidence");
  }

  if (
    feature.yawProxy !== undefined &&
    exceedsAbsoluteThreshold(
      feature.yawProxy,
      referenceCenters.yawProxy,
      thresholds.yawProxyRatio,
    )
  ) {
    reason.push("yawProxy");
  }

  const bad = reason.some((entry) => !entry.endsWith("_skipped_low_confidence"));

  return {
    timestamp: feature.timestamp,
    state: bad ? "BAD" : "STABLE",
    alert: bad,
    reason,
  };
}

type ForwardHeadResult = "BAD" | "STABLE" | "SKIPPED_LOW_CONFIDENCE";

function evaluateForwardHead(
  feature: FrameFeature,
  referenceCenters: Record<string, number>,
  thresholds: FixedThresholds,
): ForwardHeadResult {
  const { faceToShoulderRatio, pitchProxy } = feature;

  if (faceToShoulderRatio === undefined || pitchProxy === undefined) {
    return "SKIPPED_LOW_CONFIDENCE";
  }

  const bad =
    exceedsIncreaseRatio(
      faceToShoulderRatio,
      referenceCenters.faceToShoulderRatio,
      thresholds.forwardHeadFaceRatioIncrease,
    ) &&
    withinRelativeTolerance(
      feature.bodyScale,
      referenceCenters.bodyScale,
      thresholds.forwardHeadBodyScaleToleranceRatio,
    ) &&
    exceedsPositiveDelta(
      pitchProxy,
      referenceCenters.pitchProxy,
      thresholds.forwardHeadPitchDeltaRatio,
    );

  return bad ? "BAD" : "STABLE";
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
