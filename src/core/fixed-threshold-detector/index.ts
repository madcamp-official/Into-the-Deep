import type { FrameFeature, DetectionEvent } from "../types";

export interface FixedThresholds {
  shoulderTiltDeg: number;
  headXOffsetRatio: number;
  bodyScaleIncreaseRatio: number;
  forwardHeadFaceRatioIncrease: number;
  // How much headShoulderDistanceRatio must grow from calibration for the
  // head to count as "extended away from the shoulders" (turtle neck).
  forwardHeadDistanceIncreaseRatio: number;
  // How far headXRatio may drift from its calibration center and still
  // count as "facing forward" — excludes rule 5 (head turn) rather than
  // gating on bodyScale like the old design did (see forwardLean below for
  // why that gate was wrong).
  forwardHeadXRatioTolerance: number;
  // forwardLeanProxy = faceToShoulderRatio delta ratio + weight * pitchProxy
  // delta (feature_discussion's forwardLeanProxy, λ weight).
  forwardLeanPitchWeight: number;
  forwardLeanThreshold: number;
  yawProxyRatio: number;
  sustainedSeconds: number;
}

export const DEFAULT_THRESHOLDS: FixedThresholds = {
  shoulderTiltDeg: 8,
  headXOffsetRatio: 0.2,
  bodyScaleIncreaseRatio: 0.25,
  forwardHeadFaceRatioIncrease: 0.025,
  // Candidate values, not yet tuned against a development session.
  forwardHeadDistanceIncreaseRatio: 0.05,
  forwardHeadXRatioTolerance: 0.08,
  forwardLeanPitchWeight: 1,
  forwardLeanThreshold: 0.04,
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

  // shoulderXOffset/shoulderYOffset checks were removed here (used to flag
  // BAD on their own): those two fields are shoulderCenter/shoulderWidth —
  // an *absolute* screen position divided by scale, not a difference of two
  // points. Sliding a chair straight back shrinks shoulderWidth while
  // shoulderCenter barely moves, so the ratio grows even though posture
  // never changed — confirmed live (moving the chair back with the camera
  // untouched triggered a false BAD via shoulderYOffset). headXOffset above
  // doesn't have this problem since it's already a difference
  // (nose.x - shoulderCenterX) before dividing by shoulderWidth, so
  // translation cancels out. The thing shoulderXOffset/shoulderYOffset were
  // trying to catch (shoulders drifting in frame) is a camera/chair-position
  // signal, not posture — that's CameraDelta.globalTranslationX/Y's job now.

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

  const forwardLeanResult = evaluateForwardLean(feature, referenceCenters, thresholds);
  if (forwardLeanResult === "BAD") {
    reason.push("forwardLean");
  } else if (forwardLeanResult === "SKIPPED_LOW_CONFIDENCE") {
    reason.push("forwardLean_skipped_low_confidence");
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

type PostureRuleResult = "BAD" | "STABLE" | "SKIPPED_LOW_CONFIDENCE";

// Turtle neck (feature_discussion rule 1): head extends forward/down away
// from the shoulders while roughly still facing the camera. Used to gate
// on bodyScale staying within tolerance of calibration, but real turtle
// neck naturally brings the head (and a bit of the torso) closer to the
// camera too — that gate was blocking genuine detections, confirmed live.
// headShoulderDistanceRatio increasing + headXRatio staying put is a more
// direct signal and doesn't fight against a normal bodyScale change.
function evaluateForwardHead(
  feature: FrameFeature,
  referenceCenters: Record<string, number>,
  thresholds: FixedThresholds,
): PostureRuleResult {
  const { faceToShoulderRatio, headShoulderDistanceRatio, headXRatio } = feature;

  if (
    faceToShoulderRatio === undefined ||
    headShoulderDistanceRatio === undefined ||
    headXRatio === undefined
  ) {
    return "SKIPPED_LOW_CONFIDENCE";
  }

  const bad =
    exceedsIncreaseRatio(
      faceToShoulderRatio,
      referenceCenters.faceToShoulderRatio,
      thresholds.forwardHeadFaceRatioIncrease,
    ) &&
    exceedsIncreaseRatio(
      headShoulderDistanceRatio,
      referenceCenters.headShoulderDistanceRatio,
      thresholds.forwardHeadDistanceIncreaseRatio,
    ) &&
    !exceedsAbsoluteThreshold(
      headXRatio,
      referenceCenters.headXRatio,
      thresholds.forwardHeadXRatioTolerance,
    );

  return bad ? "BAD" : "STABLE";
}

// Forward lean / slouch (feature_discussion rule 4, "상체 앞으로 기울어짐"):
// the face growing relative to the shoulders combined with pitching down,
// same core signal the old forwardHead used — but as its own rule, not
// gated on bodyScale staying put, since leaning the whole torso forward is
// exactly what makes bodyScale grow.
function evaluateForwardLean(
  feature: FrameFeature,
  referenceCenters: Record<string, number>,
  thresholds: FixedThresholds,
): PostureRuleResult {
  const { faceToShoulderRatio, pitchProxy } = feature;

  if (faceToShoulderRatio === undefined || pitchProxy === undefined) {
    return "SKIPPED_LOW_CONFIDENCE";
  }

  const faceRatioDelta = ratioDelta(faceToShoulderRatio, referenceCenters.faceToShoulderRatio);
  const pitchDelta = referenceCenters.pitchProxy === undefined
    ? undefined
    : pitchProxy - referenceCenters.pitchProxy;

  if (faceRatioDelta === undefined || pitchDelta === undefined) {
    return "SKIPPED_LOW_CONFIDENCE";
  }

  const forwardLeanProxy = faceRatioDelta + thresholds.forwardLeanPitchWeight * pitchDelta;

  return forwardLeanProxy > thresholds.forwardLeanThreshold ? "BAD" : "STABLE";
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

// Signed fractional change from the calibration reference — e.g. 0.03 means
// "3% above calibration". Used for forwardLeanProxy, which needs the sign
// (a person leaning back should not add to a forward-lean score).
function ratioDelta(
  currentValue: number,
  referenceValue: number | undefined,
): number | undefined {
  if (referenceValue === undefined || referenceValue <= 0) {
    return undefined;
  }

  return (currentValue - referenceValue) / referenceValue;
}
