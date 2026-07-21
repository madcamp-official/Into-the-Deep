import { describe, expect, it } from "vitest";
import { createInitialMADProfile } from "../mad-profile";
import { evaluatePostureRules, PostureRuleDetector } from "./index";
import { DEFAULT_POSTURE_RULES } from "../posture-rules";
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

  it("selects the candidate with the stronger normalized evidence", () => {
    const profile = createProfile();
    const rules: PostureRule[] = [
      {
        postureType: "FORWARD_HEAD",
        requiredLandmarks: [],
        required: [{ feature: "headXRatio", operator: "GT", threshold: 2, reference: "CALIBRATION" }],
        supporting: [],
        reason: "head forward",
      },
      {
        postureType: "HEAD_TILT",
        requiredLandmarks: [],
        required: [{ feature: "shoulderTilt", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" }],
        supporting: [],
        reason: "head tilted",
      },
    ];
    const detector = new PostureRuleDetector(profile, createInitialMADProfile({
      values: { headXRatio: 0.1, shoulderTilt: 1 },
    }), { rules });

    const event = detector.update(
      createPostureFrame({ headXRatio: 0.5, shoulderTilt: 3 }),
    );

    expect(event.postureType).toBe("FORWARD_HEAD");
    expect(event.postureCandidates?.[0].score).toBeGreaterThan(event.postureCandidates?.[1].score ?? 0);
  });

  it("does not call a small yaw-only fluctuation a head turn", () => {
    const profile = createPostureProfile();
    const matches = evaluatePostureRules(
      createPostureFrame({ yawProxy: 0.14, headXRatio: 0.01 }),
      profile,
      createInitialMADProfile(),
      DEFAULT_POSTURE_RULES,
    );

    expect(matches.some((match) => match.postureType === "HEAD_TURN")).toBe(false);
  });

  it("requires both yaw and horizontal head displacement for a head turn", () => {
    const profile = createPostureProfile();
    const matches = evaluatePostureRules(
      createPostureFrame({ yawProxy: 0.3, headXRatio: 0.15, headRoll: 0 }),
      profile,
      createInitialMADProfile(),
      DEFAULT_POSTURE_RULES,
    );

    expect(matches.some((match) => match.postureType === "HEAD_TURN")).toBe(true);
  });
});

function createProfile(): UserProfile {
  return {
    originalCenters: { headXRatio: 0.1, shoulderTilt: 0 },
    adaptiveCenters: { headXRatio: 0.1, shoulderTilt: 0 },
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

function createPostureProfile(): UserProfile {
  return {
    originalCenters: { yawProxy: 0, headXRatio: 0, headRoll: 0 },
    adaptiveCenters: { yawProxy: 0, headXRatio: 0, headRoll: 0 },
    featureDeviations: {},
    calibrationDuration: 5000,
    validFrameCount: 100,
  };
}

function createPostureFrame(overrides: Partial<FrameFeature>): FrameFeature {
  return {
    timestamp: 0,
    confidence: 0.95,
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    motionEnergy: 0,
    ...overrides,
  };
}
