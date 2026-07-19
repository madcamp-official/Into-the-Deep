import { describe, expect, it } from "vitest";
import { buildCameraProfile } from "./index";
import type { CameraRawFeature } from "../types";

describe("buildCameraProfile", () => {
  it("uses medians so a single framing outlier does not move the profile", () => {
    const profile = buildCameraProfile([
      createFrame(0, 0.3, 0.5),
      createFrame(1000, 0.31, 0.51),
      createFrame(2000, 0.8, 0.9),
    ]);

    expect(profile).toMatchObject({
      shoulderWidth: 0.31,
      faceCenterX: 0.51,
      shoulderCenterX: 0.51,
    });
  });

  it("returns null when no camera frames were collected", () => {
    expect(buildCameraProfile([])).toBeNull();
  });
});

function createFrame(
  timestamp: number,
  shoulderWidth: number,
  centerX: number,
): CameraRawFeature {
  return {
    timestamp,
    shoulderWidth,
    faceCenterX: centerX,
    faceCenterY: 0.3,
    shoulderCenterX: centerX,
    shoulderCenterY: 0.6,
    faceToShoulderRatio: 0.2,
    yawProxy: 0,
    pitchProxy: 0.17,
  };
}
