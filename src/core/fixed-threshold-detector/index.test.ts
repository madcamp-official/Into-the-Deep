import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, evaluateV0 } from "./index";
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
