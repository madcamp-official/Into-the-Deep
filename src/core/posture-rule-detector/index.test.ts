import { describe, expect, it } from "vitest";
import { createInitialMADProfile } from "../mad-profile";
import { PostureRuleDetector } from "./index";
import type { FrameFeature, PostureRule, UserProfile } from "../types";

describe("PostureRuleDetector", () => {
  it("returns the matched posture, features, reason, and sustained alert", () => {
    const profile = createProfile();
    const rule: PostureRule = {
      postureType: "FORWARD_HEAD",
      requiredLandmarks: ["nose", "leftShoulder", "rightShoulder"],
      required: [{ feature: "headXRatio", operator: "GT", threshold: 2, reference: "CALIBRATION" }],
      supporting: [],
      reason: "head is forward",
    };
    const detector = new PostureRuleDetector(profile, createInitialMADProfile({ values: { headXRatio: 0.1 } }), {
      rules: [rule],
      sustainedSeconds: 1.5,
    });

    expect(detector.update(createFrame(0, 0.31))).toMatchObject({
      state: "BAD",
      alert: false,
      postureType: "FORWARD_HEAD",
      matchedFeatures: ["headXRatio"],
    });
    expect(detector.update(createFrame(1500, 0.31))).toMatchObject({
      state: "BAD",
      alert: true,
    });
  });
});

function createProfile(): UserProfile {
  return {
    originalCenters: { headXRatio: 0.1 },
    adaptiveCenters: { headXRatio: 0.1 },
    featureDeviations: {},
    calibrationDuration: 5000,
    validFrameCount: 100,
  };
}

function createFrame(timestamp: number, headXRatio: number): FrameFeature {
  return {
    timestamp,
    confidence: 0.95,
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    motionEnergy: 0.01,
    headXRatio,
  };
}
