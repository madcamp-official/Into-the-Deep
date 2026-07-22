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

  it("bridges a single-frame jitter dropout without resetting the dwell timer", () => {
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
      noMatchGraceMs: 300,
    });

    expect(detector.update(createFrame(0, 0.31))).toMatchObject({ state: "BAD", alert: false });
    // Landmark jitter drops headXRatio below the rule's threshold for a
    // single frame — held as BAD (not STABLE), dwell keeps counting.
    expect(detector.update(createFrame(100, 0.05))).toMatchObject({
      state: "BAD",
      alert: false,
      postureType: "FORWARD_HEAD",
    });
    expect(detector.update(createFrame(200, 0.31))).toMatchObject({ state: "BAD", alert: false });
    expect(detector.update(createFrame(1600, 0.31))).toMatchObject({ state: "BAD", alert: true });
  });

  it("reports STABLE once a no-match gap outlasts the grace window, and starts a fresh dwell afterward", () => {
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
      noMatchGraceMs: 300,
    });

    expect(detector.update(createFrame(0, 0.31))).toMatchObject({ state: "BAD", alert: false });
    expect(detector.update(createFrame(100, 0.05))).toMatchObject({ state: "BAD", alert: false });
    expect(detector.update(createFrame(200, 0.05))).toMatchObject({ state: "BAD", alert: false });
    // Gap has now outlasted noMatchGraceMs (450 - 100 = 350ms): a genuine
    // return to normal, not jitter.
    expect(detector.update(createFrame(450, 0.05))).toMatchObject({ state: "STABLE", alert: false });
    // Posture matches again — this is a fresh dwell, not a continuation of
    // the one from t=0 (which would already exceed sustainedSeconds by now).
    expect(detector.update(createFrame(500, 0.31))).toMatchObject({ state: "BAD", alert: false });
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

  it("only enters MOVING once elevated motionEnergy sustains past motionSustainMs, and preserves the dwell timer through it", () => {
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
      motionEnergyGate: 0.15,
      motionSustainMs: 250,
      motionSettleMs: 0, // isolate this from the post-motion settle period, covered separately below
    });

    expect(detector.update(createFrame(0, 0.31))).toMatchObject({ state: "BAD", alert: false });
    // A single elevated frame is just landmark jitter until it sustains
    // past motionSustainMs — still evaluated normally.
    expect(detector.update(createFrame(100, 0.31, 0.5))).toMatchObject({ state: "BAD", alert: false });
    // Now sustained for 300ms (>= 250ms): promoted to MOVING, judgment held.
    expect(detector.update(createFrame(400, 0.31, 0.5))).toMatchObject({ state: "MOVING", alert: false });
    // Motion stops; dwell should keep counting from t=0, not from t=400.
    expect(detector.update(createFrame(600, 0.31))).toMatchObject({ state: "BAD", alert: false });
    expect(detector.update(createFrame(1600, 0.31))).toMatchObject({ state: "BAD", alert: true });
  });

  it("keeps holding MOVING for motionSettleMs after motion drops back under the gate", () => {
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
      motionEnergyGate: 0.15,
      motionSustainMs: 250,
      motionSettleMs: 600,
    });

    expect(detector.update(createFrame(0, 0.31))).toMatchObject({ state: "BAD", alert: false });
    // Sustained motion confirmed at t=400 (streak since t=100 >= 250ms).
    expect(detector.update(createFrame(100, 0.31, 0.5))).toMatchObject({ state: "BAD", alert: false });
    expect(detector.update(createFrame(400, 0.31, 0.5))).toMatchObject({ state: "MOVING", alert: false });
    // Motion drops back under the gate, but settle window (600ms from t=400)
    // hasn't elapsed yet — still held.
    expect(detector.update(createFrame(700, 0.31))).toMatchObject({ state: "MOVING", alert: false });
    expect(detector.update(createFrame(950, 0.31))).toMatchObject({ state: "MOVING", alert: false });
    // Past the settle window: judgment resumes.
    expect(detector.update(createFrame(1050, 0.31))).toMatchObject({ state: "BAD", alert: false });
  });

  it("drops a stale dwell timer once motion is held past the reset window", () => {
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
      motionEnergyGate: 0.15,
      motionSustainMs: 250,
      motionSettleMs: 0, // isolate this from the post-motion settle period, covered separately above
    });

    expect(detector.update(createFrame(0, 0.31))).toMatchObject({ state: "BAD", alert: false });
    // Continuously elevated for longer than ALERT_TIMING.holdResetSec (4s),
    // fed as repeated frames like a real capture loop would: the old dwell
    // shouldn't silently count the whole moving interval once it clears.
    for (let timestamp = 200; timestamp <= 4600; timestamp += 200) {
      detector.update(createFrame(timestamp, 0.31, 0.5));
    }
    expect(detector.update(createFrame(4700, 0.31))).toMatchObject({ state: "BAD", alert: false });
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

function createFrame(timestamp: number, headXRatio: number, motionEnergy = 0.01): FrameFeature {
  return {
    timestamp,
    confidence: 0.95,
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    motionEnergy,
    headXRatio,
  };
}

function createPostureProfile(): UserProfile {
  return {
    // bodyScale: 1 matches createPostureFrame's own default, so HEAD_TURN's
    // bodyScale ABS_LT exclusion normalizes to 0 deviation (not undefined)
    // for frames that don't override it — a "didn't move toward the
    // camera" baseline, not a magic value.
    originalCenters: { yawProxy: 0, headXRatio: 0, headRoll: 0, bodyScale: 1 },
    adaptiveCenters: { yawProxy: 0, headXRatio: 0, headRoll: 0, bodyScale: 1 },
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
