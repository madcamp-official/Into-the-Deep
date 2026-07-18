import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, FixedThresholdDetector, evaluateV0 } from "./index";
import type { FrameFeature } from "../types";

const referenceCenters: Record<string, number> = {
  shoulderTilt: 0,
  headXOffset: 0,
  shoulderXOffset: 0,
  shoulderYOffset: 0,
  bodyScale: 1,
  faceToShoulderRatio: 0.28,
  pitchProxy: 0.2,
};

describe("evaluateV0", () => {
  it("returns STABLE with no alert when the frame matches the reference centers", () => {
    const feature: FrameFeature = {
      timestamp: 1,
      confidence: 0.95,
      shoulderTilt: 0.5,
      headXOffset: 0.01,
      shoulderXOffset: 0.01,
      shoulderYOffset: 0.01,
      bodyScale: 1.02,
      motionEnergy: 0.03,
    };

    expect(evaluateV0(feature, referenceCenters)).toEqual({
      timestamp: 1,
      state: "STABLE",
      alert: false,
      reason: [],
    });
  });

  it("flags BAD with the offending reasons when shoulderTilt and shoulderYOffset exceed thresholds", () => {
    const feature: FrameFeature = {
      timestamp: 2,
      confidence: 0.9,
      shoulderTilt: referenceCenters.shoulderTilt + DEFAULT_THRESHOLDS.shoulderTiltDeg + 1,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: referenceCenters.shoulderYOffset + DEFAULT_THRESHOLDS.shoulderYOffsetRatio + 0.05,
      bodyScale: 1,
      motionEnergy: 0.1,
    };

    expect(evaluateV0(feature, referenceCenters)).toEqual({
      timestamp: 2,
      state: "BAD",
      alert: true,
      reason: ["shoulderTilt", "shoulderYOffset"],
    });
  });

  it("flags BAD with shoulderXOffset when the shoulders shift sideways past the threshold", () => {
    const feature: FrameFeature = {
      timestamp: 3,
      confidence: 0.9,
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: referenceCenters.shoulderXOffset + DEFAULT_THRESHOLDS.shoulderXOffsetRatio + 0.05,
      shoulderYOffset: 0,
      bodyScale: 1,
      motionEnergy: 0.1,
    };

    expect(evaluateV0(feature, referenceCenters)).toEqual({
      timestamp: 3,
      state: "BAD",
      alert: true,
      reason: ["shoulderXOffset"],
    });
  });

  it("flags BAD with forwardHead when face ratio and pitch increase without body scale drift", () => {
    const feature: FrameFeature = {
      timestamp: 4,
      confidence: 0.9,
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: 0,
      bodyScale: 1.05,
      faceToShoulderRatio:
        referenceCenters.faceToShoulderRatio *
        (1 + DEFAULT_THRESHOLDS.forwardHeadFaceRatioIncrease + 0.02),
      pitchProxy:
        referenceCenters.pitchProxy +
        DEFAULT_THRESHOLDS.forwardHeadPitchDeltaRatio +
        0.02,
      motionEnergy: 0.1,
    };

    expect(evaluateV0(feature, referenceCenters)).toEqual({
      timestamp: 4,
      state: "BAD",
      alert: true,
      reason: ["forwardHead"],
    });
  });

  it("does not flag forwardHead when body scale changes too much", () => {
    const feature: FrameFeature = {
      timestamp: 5,
      confidence: 0.9,
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: 0,
      bodyScale:
        referenceCenters.bodyScale *
        (1 + DEFAULT_THRESHOLDS.forwardHeadBodyScaleToleranceRatio + 0.02),
      faceToShoulderRatio:
        referenceCenters.faceToShoulderRatio *
        (1 + DEFAULT_THRESHOLDS.forwardHeadFaceRatioIncrease + 0.02),
      pitchProxy:
        referenceCenters.pitchProxy +
        DEFAULT_THRESHOLDS.forwardHeadPitchDeltaRatio +
        0.02,
      motionEnergy: 0.1,
    };

    const event = evaluateV0(feature, referenceCenters);

    expect(event).toEqual({
      timestamp: 5,
      state: "BAD",
      alert: true,
      reason: ["bodyScale"],
    });
    expect(event.reason).not.toContain("forwardHead");
  });
});

describe("FixedThresholdDetector", () => {
  it("does not alert before the BAD state is sustained long enough", () => {
    const detector = new FixedThresholdDetector(referenceCenters);
    const badFrame = createBadFrame(0);

    expect(detector.update(badFrame)).toMatchObject({
      timestamp: 0,
      state: "BAD",
      alert: false,
      reason: ["shoulderYOffset"],
    });

    expect(detector.update(createBadFrame(1490))).toMatchObject({
      timestamp: 1490,
      state: "BAD",
      alert: false,
      reason: ["shoulderYOffset"],
    });
  });

  it("alerts when the BAD state lasts for the sustained threshold", () => {
    const detector = new FixedThresholdDetector(referenceCenters);

    detector.update(createBadFrame(10000));

    expect(detector.update(createBadFrame(11500))).toMatchObject({
      timestamp: 11500,
      state: "BAD",
      alert: true,
      reason: ["shoulderYOffset"],
    });
  });

  it("resets the sustained BAD timer when a stable frame arrives", () => {
    const detector = new FixedThresholdDetector(referenceCenters);

    detector.update(createBadFrame(20000));

    expect(detector.update(createStableFrame(21000))).toEqual({
      timestamp: 21000,
      state: "STABLE",
      alert: false,
      reason: [],
    });

    expect(detector.update(createBadFrame(22000))).toMatchObject({
      timestamp: 22000,
      state: "BAD",
      alert: false,
      reason: ["shoulderYOffset"],
    });
  });
});

function createStableFrame(timestamp: number): FrameFeature {
  return {
    timestamp,
    confidence: 0.95,
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    motionEnergy: 0.03,
  };
}

function createBadFrame(timestamp: number): FrameFeature {
  return {
    ...createStableFrame(timestamp),
    shoulderYOffset: DEFAULT_THRESHOLDS.shoulderYOffsetRatio + 0.01,
  };
}
