import { describe, expect, it } from "vitest";
import { analyzeCameraVerificationSession } from "./index";
import type { CameraTransform } from "../../core/types";
import type { SessionLogEntry } from "../recorder";

const transform: CameraTransform = {
  timestamp: 0,
  translationX: 0.1,
  translationY: 0,
  scale: 0,
  roll: 0,
  trackedPointCount: 12,
  inlierRatio: 0.8,
  reprojectionError: 1,
  confidence: 0.8,
  source: "BACKGROUND_FEATURES",
};

function entry(timestamp: number, label: SessionLogEntry["groundTruth"], state: "VALID" | "ADJUSTED"): SessionLogEntry {
  return {
    timestamp,
    groundTruth: label,
    cameraState: state,
    confidence: 0.9,
    features: {
      shoulderTilt: 0,
      headXOffset: 0,
      shoulderXOffset: 0,
      shoulderYOffset: 0,
      bodyScale: 1,
      motionEnergy: 0,
    },
    metadata: timestamp === 0
      ? {
          userProfile: {} as never,
          cameraProfile: {} as never,
          profileCreatedAt: 0,
          sessionType: "CAMERA",
        }
      : undefined,
    cameraTransform: { ...transform, timestamp },
    cameraAssessment: {
      timestamp,
      state,
      scaleCorrection: 0,
      offsetX: transform.translationX,
      offsetY: 0,
      reliability: 0.8,
      transform: { ...transform, timestamp },
    },
  };
}

describe("analyzeCameraVerificationSession", () => {
  it("measures detection delay from a new camera session", () => {
    const entries = [
      { ...entry(0, "NORMAL_WORK", "VALID"), markers: [{ timestamp: 0, type: "SCENARIO_STARTED" as const, label: "NORMAL_WORK" as const }] },
      { ...entry(1000, "CAMERA_TRANSLATION_X", "VALID"), markers: [{ timestamp: 1000, type: "SCENARIO_STARTED" as const, label: "CAMERA_TRANSLATION_X" as const }] },
      { ...entry(1500, "CAMERA_TRANSLATION_X", "VALID"), markers: [{ timestamp: 1500, type: "CHANGE_ONSET" as const, label: "CAMERA_TRANSLATION_X" as const }] },
      { ...entry(2000, "CAMERA_TRANSLATION_X", "ADJUSTED") },
      { ...entry(3000, "NORMAL_WORK", "VALID"), markers: [{ timestamp: 3000, type: "SCENARIO_ENDED" as const, label: "CAMERA_TRANSLATION_X" as const }] },
    ];
    const report = analyzeCameraVerificationSession(entries);
    expect(report.scenarioCount).toBe(1);
    expect(report.detectedScenarioCount).toBe(1);
    expect(report.averageDetectionDelaySeconds).toBeCloseTo(0.5);
  });

  it("rejects old logs without camera transform fields", () => {
    const oldEntry = entry(0, "NORMAL_WORK", "VALID");
    delete oldEntry.cameraTransform;
    delete oldEntry.cameraAssessment;
    expect(() => analyzeCameraVerificationSession([oldEntry])).toThrow(/old logs are not supported/);
  });
});
