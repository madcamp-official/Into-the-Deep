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
  yawProxy: 0,
  headXRatio: 0,
  headShoulderDistanceRatio: 0.5,
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
      faceToShoulderRatio: referenceCenters.faceToShoulderRatio,
      pitchProxy: referenceCenters.pitchProxy,
      headXRatio: referenceCenters.headXRatio,
      headShoulderDistanceRatio: referenceCenters.headShoulderDistanceRatio,
      motionEnergy: 0.03,
    };

    expect(evaluateV0(feature, referenceCenters)).toEqual({
      timestamp: 1,
      state: "STABLE",
      alert: false,
      reason: [],
    });
  });

  it("flags BAD with the offending reason when shoulderTilt exceeds threshold", () => {
    const feature: FrameFeature = {
      timestamp: 2,
      confidence: 0.9,
      shoulderTilt: referenceCenters.shoulderTilt + DEFAULT_THRESHOLDS.shoulderTiltDeg + 1,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: 0,
      bodyScale: 1,
      faceToShoulderRatio: referenceCenters.faceToShoulderRatio,
      pitchProxy: referenceCenters.pitchProxy,
      headXRatio: referenceCenters.headXRatio,
      headShoulderDistanceRatio: referenceCenters.headShoulderDistanceRatio,
      motionEnergy: 0.1,
    };

    expect(evaluateV0(feature, referenceCenters)).toEqual({
      timestamp: 2,
      state: "BAD",
      alert: true,
      reason: ["shoulderTilt"],
    });
  });

  it("does not flag BAD when only shoulderXOffset/shoulderYOffset move (e.g. sliding a chair back with the camera untouched)", () => {
    // These fields are shoulderCenter/shoulderWidth — sliding the chair back
    // shrinks shoulderWidth while shoulderCenter barely moves, so the ratio
    // grows even with zero real posture change. They're no longer checked
    // by evaluateV0 for exactly this reason.
    const feature: FrameFeature = {
      timestamp: 3,
      confidence: 0.9,
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: referenceCenters.shoulderXOffset + 5,
      shoulderYOffset: referenceCenters.shoulderYOffset + 5,
      bodyScale: 1,
      faceToShoulderRatio: referenceCenters.faceToShoulderRatio,
      pitchProxy: referenceCenters.pitchProxy,
      headXRatio: referenceCenters.headXRatio,
      headShoulderDistanceRatio: referenceCenters.headShoulderDistanceRatio,
      motionEnergy: 0.1,
    };

    expect(evaluateV0(feature, referenceCenters)).toEqual({
      timestamp: 3,
      state: "STABLE",
      alert: false,
      reason: [],
    });
  });

  it("flags BAD with forwardHead when face ratio and headShoulderDistanceRatio grow, even with a big bodyScale shift", () => {
    // bodyScale shifting a lot used to block forwardHead entirely (old
    // bodyScale-tolerance gate) — real turtle neck naturally brings the
    // head/torso a bit closer to the camera too, so that gate was wrong.
    // Confirmed live: it was blocking genuine detections.
    const feature: FrameFeature = {
      timestamp: 4,
      confidence: 0.9,
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: 0,
      bodyScale: referenceCenters.bodyScale * 1.35,
      faceToShoulderRatio:
        referenceCenters.faceToShoulderRatio *
        (1 + DEFAULT_THRESHOLDS.forwardHeadFaceRatioIncrease + 0.02),
      headShoulderDistanceRatio:
        referenceCenters.headShoulderDistanceRatio *
        (1 + DEFAULT_THRESHOLDS.forwardHeadDistanceIncreaseRatio + 0.02),
      headXRatio: referenceCenters.headXRatio,
      pitchProxy: referenceCenters.pitchProxy,
      motionEnergy: 0.1,
    };

    const event = evaluateV0(feature, referenceCenters);

    expect(event.state).toBe("BAD");
    expect(event.alert).toBe(true);
    expect(event.reason).toContain("forwardHead");
  });

  it("does not flag forwardHead when headXRatio has drifted too far (head turn, not turtle neck)", () => {
    const feature: FrameFeature = {
      timestamp: 5,
      confidence: 0.9,
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: 0,
      bodyScale: 1,
      faceToShoulderRatio:
        referenceCenters.faceToShoulderRatio *
        (1 + DEFAULT_THRESHOLDS.forwardHeadFaceRatioIncrease + 0.001),
      headShoulderDistanceRatio:
        referenceCenters.headShoulderDistanceRatio *
        (1 + DEFAULT_THRESHOLDS.forwardHeadDistanceIncreaseRatio + 0.02),
      headXRatio:
        referenceCenters.headXRatio + DEFAULT_THRESHOLDS.forwardHeadXRatioTolerance + 0.05,
      pitchProxy: referenceCenters.pitchProxy,
      motionEnergy: 0.1,
    };

    const event = evaluateV0(feature, referenceCenters);

    expect(event.reason).not.toContain("forwardHead");
  });

  it("flags BAD with forwardLean when face ratio and pitch shift together (whole torso leaning forward)", () => {
    const feature: FrameFeature = {
      timestamp: 8,
      confidence: 0.9,
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: 0,
      // Leaning the whole torso in naturally grows bodyScale too — this
      // shouldn't (and per the test above, doesn't) block detection.
      bodyScale: referenceCenters.bodyScale * 1.3,
      faceToShoulderRatio: referenceCenters.faceToShoulderRatio * 1.02,
      pitchProxy: referenceCenters.pitchProxy + 0.03,
      headXRatio: referenceCenters.headXRatio,
      headShoulderDistanceRatio: referenceCenters.headShoulderDistanceRatio,
      motionEnergy: 0.1,
    };

    const event = evaluateV0(feature, referenceCenters);

    expect(event.reason).toContain("forwardLean");
  });

  it("does not flag forwardLean when face ratio/pitch move the opposite way (leaning back)", () => {
    const feature: FrameFeature = {
      timestamp: 9,
      confidence: 0.9,
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: 0,
      bodyScale: 1,
      faceToShoulderRatio: referenceCenters.faceToShoulderRatio * 0.98,
      pitchProxy: referenceCenters.pitchProxy - 0.03,
      headXRatio: referenceCenters.headXRatio,
      headShoulderDistanceRatio: referenceCenters.headShoulderDistanceRatio,
      motionEnergy: 0.1,
    };

    const event = evaluateV0(feature, referenceCenters);

    expect(event.reason).not.toContain("forwardLean");
  });

  it("marks forwardHead/forwardLean as skipped (not BAD) when the underlying features are unavailable", () => {
    // Mirrors what feature-normalizer now produces when eyesReliable is
    // false (e.g. eyes occluded/turned away) — faceToShoulderRatio and
    // pitchProxy come back undefined rather than a garbage value.
    const feature: FrameFeature = {
      timestamp: 7,
      confidence: 0.9,
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: 0,
      bodyScale: 1,
      motionEnergy: 0.1,
    };

    const event = evaluateV0(feature, referenceCenters);

    expect(event.state).toBe("STABLE");
    expect(event.alert).toBe(false);
    expect(event.reason).toEqual([
      "forwardHead_skipped_low_confidence",
      "forwardLean_skipped_low_confidence",
    ]);
  });

  it("flags BAD with yawProxy when the head turns past the threshold", () => {
    const feature: FrameFeature = {
      timestamp: 6,
      confidence: 0.9,
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: 0,
      bodyScale: 1,
      faceToShoulderRatio: referenceCenters.faceToShoulderRatio,
      pitchProxy: referenceCenters.pitchProxy,
      headXRatio: referenceCenters.headXRatio,
      headShoulderDistanceRatio: referenceCenters.headShoulderDistanceRatio,
      yawProxy: referenceCenters.yawProxy + DEFAULT_THRESHOLDS.yawProxyRatio + 0.05,
      motionEnergy: 0.1,
    };

    expect(evaluateV0(feature, referenceCenters)).toEqual({
      timestamp: 6,
      state: "BAD",
      alert: true,
      reason: ["yawProxy"],
    });
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
      reason: ["shoulderTilt"],
    });

    expect(detector.update(createBadFrame(1490))).toMatchObject({
      timestamp: 1490,
      state: "BAD",
      alert: false,
      reason: ["shoulderTilt"],
    });
  });

  it("alerts when the BAD state lasts for the sustained threshold", () => {
    const detector = new FixedThresholdDetector(referenceCenters);

    detector.update(createBadFrame(10000));

    expect(detector.update(createBadFrame(11500))).toMatchObject({
      timestamp: 11500,
      state: "BAD",
      alert: true,
      reason: ["shoulderTilt"],
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
      reason: ["shoulderTilt"],
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
    faceToShoulderRatio: referenceCenters.faceToShoulderRatio,
    pitchProxy: referenceCenters.pitchProxy,
    headXRatio: referenceCenters.headXRatio,
    headShoulderDistanceRatio: referenceCenters.headShoulderDistanceRatio,
    motionEnergy: 0.03,
  };
}

function createBadFrame(timestamp: number): FrameFeature {
  return {
    ...createStableFrame(timestamp),
    shoulderTilt: DEFAULT_THRESHOLDS.shoulderTiltDeg + 1,
  };
}
