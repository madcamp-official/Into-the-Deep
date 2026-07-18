import { describe, expect, it } from "vitest";
import {
  evaluateV1,
  PersonalizedDriftDetector,
} from "./index";
import type { FrameFeature, UserProfile } from "../types";

const profile: UserProfile = {
  originalCenters: {
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    faceToShoulderRatio: 0.2,
    pitchProxy: 0.17,
    yawProxy: 0,
  },
  adaptiveCenters: {
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    faceToShoulderRatio: 0.2,
    pitchProxy: 0.17,
    yawProxy: 0,
  },
  featureDeviations: {
    shoulderTilt: 1,
    headXOffset: 0.02,
    shoulderXOffset: 0.02,
    shoulderYOffset: 0.02,
    bodyScale: 0.01,
    faceToShoulderRatio: 0.005,
    pitchProxy: 0.005,
    yawProxy: 0.03,
  },
  calibrationDuration: 3000,
  validFrameCount: 90,
};

describe("evaluateV1", () => {
  it("averages the two largest normalized deviations and reports them as dominant", () => {
    const observation = evaluateV1(createFrame(0, {
      shoulderTilt: 4,
      yawProxy: 0.12,
      bodyScale: 2,
    }), profile);

    expect(observation.driftScore).toBeCloseTo(4);
    expect(observation.dominantFeatures).toEqual(["shoulderTilt", "yawProxy"]);
  });

  it("does not include bodyScale in the V1 posture score", () => {
    const observation = evaluateV1(createFrame(0, { bodyScale: 3 }), profile);

    expect(observation.driftScore).toBe(0);
    expect(observation.dominantFeatures).toEqual([]);
  });
});

describe("PersonalizedDriftDetector", () => {
  it("alerts only after the personalized score stays above 3.0 for 1.5 seconds", () => {
    const detector = new PersonalizedDriftDetector(profile);
    const badOverrides = { shoulderTilt: 4, yawProxy: 0.12 };

    expect(detector.update(createFrame(0, badOverrides)).event).toMatchObject({
      state: "BAD",
      alert: false,
    });
    expect(detector.update(createFrame(1499, badOverrides)).event).toMatchObject({
      state: "BAD",
      alert: false,
    });
    expect(detector.update(createFrame(1500, badOverrides)).event).toMatchObject({
      state: "BAD",
      alert: true,
    });
  });
});

function createFrame(
  timestamp: number,
  overrides: Partial<FrameFeature> = {},
): FrameFeature {
  return {
    timestamp,
    confidence: 0.95,
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    faceToShoulderRatio: 0.2,
    pitchProxy: 0.17,
    yawProxy: 0,
    motionEnergy: 0,
    ...overrides,
  };
}
