import { describe, expect, it } from "vitest";
import { buildCameraProfile, computeCameraDelta } from "./index";
import type { CameraProfile, CameraRawFeature } from "../types";

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

describe("computeCameraDelta", () => {
  const profile: CameraProfile = {
    shoulderWidth: 0.3,
    faceCenterX: 0.5,
    faceCenterY: 0.3,
    shoulderCenterX: 0.5,
    shoulderCenterY: 0.6,
    faceToShoulderRatio: 0.2,
    yawProxy: 0.05, // e.g. a webcam mounted slightly off to one side
    pitchProxy: 0.17,
  };

  it("reports zero delta and correctedYaw equal to baseline offset when nothing has changed since calibration", () => {
    const current = createFrame(1000, profile.shoulderWidth, profile.shoulderCenterX, profile.yawProxy);

    const delta = computeCameraDelta(current, profile);

    expect(delta.globalScaleDelta).toBeCloseTo(0, 10);
    expect(delta.globalTranslationX).toBeCloseTo(0, 10);
    expect(delta.globalTranslationY).toBeCloseTo(0, 10);
    // yawProxy unchanged from calibration -> the camera's inherent offset
    // is fully cancelled out, not reported as a head turn.
    expect(delta.correctedYaw).toBeCloseTo(0, 10);
  });

  it("computes globalScaleDelta as a signed ratio of the calibration shoulder width", () => {
    const closer = createFrame(1000, 0.36, profile.shoulderCenterX); // 20% wider -> closer to camera
    const delta = computeCameraDelta(closer, profile);

    expect(delta.globalScaleDelta).toBeCloseTo(0.2, 10);
  });

  it("subtracts the calibration-time yawProxy so a real head turn shows up net of the camera's own angle", () => {
    const current = createFrame(1000, profile.shoulderWidth, profile.shoulderCenterX, 0.2);
    const delta = computeCameraDelta(current, profile);

    expect(delta.correctedYaw).toBeCloseTo(0.15, 10);
  });
});

function createFrame(
  timestamp: number,
  shoulderWidth: number,
  centerX: number,
  yawProxy = 0,
): CameraRawFeature {
  return {
    timestamp,
    shoulderWidth,
    faceCenterX: centerX,
    faceCenterY: 0.3,
    shoulderCenterX: centerX,
    shoulderCenterY: 0.6,
    faceToShoulderRatio: 0.2,
    yawProxy,
    pitchProxy: 0.17,
  };
}
