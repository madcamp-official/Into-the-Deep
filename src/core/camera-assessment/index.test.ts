import { describe, expect, it } from "vitest";
import { assessCameraTransform } from "./index";
import type { CameraTransform } from "../types";

function transform(overrides: Partial<CameraTransform> = {}): CameraTransform {
  return {
    timestamp: 1000,
    translationX: 0,
    translationY: 0,
    scale: 0,
    roll: 0,
    trackedPointCount: 16,
    inlierRatio: 0.9,
    reprojectionError: 1,
    confidence: 0.9,
    source: "BACKGROUND_FEATURES",
    ...overrides,
  };
}

describe("assessCameraTransform", () => {
  it("keeps a stable background as VALID", () => {
    expect(assessCameraTransform(transform()).state).toBe("VALID");
  });

  it("reports a moderate camera change as ADJUSTED", () => {
    expect(assessCameraTransform(transform({ translationX: 0.08 })).state).toBe("ADJUSTED");
  });

  it("requires recalibration for a large camera change", () => {
    expect(assessCameraTransform(transform({ scale: 0.25 })).state).toBe("RECALIBRATION_REQUIRED");
  });

  it("returns UNKNOWN when tracking confidence is low", () => {
    expect(assessCameraTransform(transform({ confidence: 0.2 })).state).toBe("UNKNOWN");
  });
});
