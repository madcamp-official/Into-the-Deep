import { describe, expect, it } from "vitest";
import { buildUserProfile } from "./index";
import type { FrameFeature } from "../types";

describe("buildUserProfile", () => {
  it("uses median centers and MAD deviations from reliable calibration frames", () => {
    const profile = buildUserProfile([
      createFrame(0, 0, 0.9),
      createFrame(1000, 2, 0.95),
      createFrame(2000, 100, 0.96),
      createFrame(3000, 4, 0.7),
    ]);

    expect(profile.originalCenters.shoulderTilt).toBe(2);
    expect(profile.featureDeviations.shoulderTilt).toBe(2);
    expect(profile.validFrameCount).toBe(3);
    expect(profile.calibrationDuration).toBe(2000);
  });
});

function createFrame(
  timestamp: number,
  shoulderTilt: number,
  confidence: number,
): FrameFeature {
  return {
    timestamp,
    confidence,
    shoulderTilt,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    motionEnergy: 0,
  };
}
