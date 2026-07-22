import { describe, expect, it } from "vitest";
import { CameraAssessmentTracker } from "./index";
import type { CameraTransform } from "../types";

function transform(overrides: Partial<CameraTransform> = {}): CameraTransform {
  return {
    timestamp: 0,
    translationX: 0,
    translationY: 0,
    scale: 0,
    roll: 0,
    trackedPointCount: 12,
    inlierRatio: 0.9,
    reprojectionError: 1,
    confidence: 0.9,
    source: "BACKGROUND_FEATURES",
    ...overrides,
  };
}

describe("CameraAssessmentTracker", () => {
  it("holds VALID during a brief tracking gap", () => {
    const tracker = new CameraAssessmentTracker();
    expect(tracker.update(transform(), 0).state).toBe("VALID");
    expect(tracker.update(null, 200).state).toBe("VALID");
  });

  it("reports UNKNOWN after the grace period", () => {
    const tracker = new CameraAssessmentTracker();
    tracker.update(transform(), 0);
    tracker.update(null, 100);
    expect(tracker.update(null, 700).state).toBe("UNKNOWN");
  });

  it("requires three consecutive changed frames before entering MOVING", () => {
    const tracker = new CameraAssessmentTracker();
    tracker.update(transform(), 0);
    expect(tracker.update(transform({ translationX: 0.05 }), 100).motionPhase).toBe("STABLE");
    expect(tracker.update(transform({ translationX: 0.05 }), 200).motionPhase).toBe("STABLE");
    expect(tracker.update(transform({ translationX: 0.05 }), 300).motionPhase).toBe("MOVING");
    expect(tracker.update(transform({ translationX: 0 }), 800).motionPhase).toBe("SETTLING");
    expect(tracker.update(transform({ translationX: 0 }), 1200).state).toBe("ADJUSTED");
  });

  it("detects a slow camera movement from accumulated small changes", () => {
    const tracker = new CameraAssessmentTracker();
    tracker.update(transform(), 0);

    for (let index = 1; index <= 6; index += 1) {
      const result = tracker.update(transform({ translationX: 0.005 }), index * 100);
      if (index < 6) expect(result.motionPhase).not.toBe("MOVING");
    }

    expect(tracker.update(transform({ translationX: 0.005 }), 700).motionPhase).toBe("MOVING");
  });

  it("recovers after five consecutive good-quality frames", () => {
    const tracker = new CameraAssessmentTracker();
    const degraded = transform({
      trackedPointCount: 5,
      inlierRatio: 0.4,
      reprojectionError: 5,
      confidence: 0.3,
    });

    tracker.update(transform(), 0);
    expect(tracker.update(degraded, 100).qualityStatus).toBe("DEGRADED");

    for (let index = 1; index <= 4; index += 1) {
      const result = tracker.update(transform(), 100 + index * 100);
      expect(result.qualityStatus).toBe("RECOVERING");
      expect(result.state).toBe("UNKNOWN");
    }

    const recovered = tracker.update(transform(), 600);
    expect(recovered.qualityStatus).toBe("OK");
    expect(recovered.state).toBe("VALID");
  });

  it("requires recalibration when poor tracking persists", () => {
    const tracker = new CameraAssessmentTracker();
    const degraded = transform({
      trackedPointCount: 5,
      inlierRatio: 0.4,
      reprojectionError: 5,
      confidence: 0.3,
    });

    tracker.update(transform(), 0);
    tracker.update(degraded, 100);
    const result = tracker.update(degraded, 2200);

    expect(result.qualityStatus).toBe("RECALIBRATION_REQUIRED");
    expect(result.state).toBe("RECALIBRATION_REQUIRED");
  });
});
