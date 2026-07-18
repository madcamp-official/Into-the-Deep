import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, FixedThresholdDetector, evaluateV0 } from "./index";
import type { FrameFeature } from "../types";

const referenceCenters: Record<string, number> = {
  shoulderTilt: 0,
  headXOffset: 0,
  headYOffset: 0,
  bodyScale: 1,
};

describe("evaluateV0", () => {
  it("returns STABLE with no alert when the frame matches the reference centers", () => {
    const feature: FrameFeature = {
      timestamp: 1,
      confidence: 0.95,
      shoulderTilt: 0.5,
      headXOffset: 0.01,
      headYOffset: 0.01,
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

  it("flags BAD with the offending reasons when shoulderTilt and headYOffset exceed thresholds", () => {
    const feature: FrameFeature = {
      timestamp: 2,
      confidence: 0.9,
      shoulderTilt: referenceCenters.shoulderTilt + DEFAULT_THRESHOLDS.shoulderTiltDeg + 1,
      headXOffset: 0,
      headYOffset: referenceCenters.headYOffset + DEFAULT_THRESHOLDS.headYOffsetRatio + 0.05,
      bodyScale: 1,
      motionEnergy: 0.1,
    };

    expect(evaluateV0(feature, referenceCenters)).toEqual({
      timestamp: 2,
      state: "BAD",
      alert: true,
      reason: ["shoulderTilt", "headYOffset"],
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
      reason: ["headYOffset"],
    });

    expect(detector.update(createBadFrame(1.49))).toMatchObject({
      timestamp: 1.49,
      state: "BAD",
      alert: false,
      reason: ["headYOffset"],
    });
  });

  it("alerts when the BAD state lasts for the sustained threshold", () => {
    const detector = new FixedThresholdDetector(referenceCenters);

    detector.update(createBadFrame(10));

    expect(detector.update(createBadFrame(11.5))).toMatchObject({
      timestamp: 11.5,
      state: "BAD",
      alert: true,
      reason: ["headYOffset"],
    });
  });

  it("resets the sustained BAD timer when a stable frame arrives", () => {
    const detector = new FixedThresholdDetector(referenceCenters);

    detector.update(createBadFrame(20));

    expect(detector.update(createStableFrame(21))).toEqual({
      timestamp: 21,
      state: "STABLE",
      alert: false,
      reason: [],
    });

    expect(detector.update(createBadFrame(22))).toMatchObject({
      timestamp: 22,
      state: "BAD",
      alert: false,
      reason: ["headYOffset"],
    });
  });
});

function createStableFrame(timestamp: number): FrameFeature {
  return {
    timestamp,
    confidence: 0.95,
    shoulderTilt: 0,
    headXOffset: 0,
    headYOffset: 0,
    bodyScale: 1,
    motionEnergy: 0.03,
  };
}

function createBadFrame(timestamp: number): FrameFeature {
  return {
    ...createStableFrame(timestamp),
    headYOffset: DEFAULT_THRESHOLDS.headYOffsetRatio + 0.01,
  };
}
