import { describe, expect, it } from "vitest";
import type { CameraTransform, DetectionEvent } from "../../core/types";
import type { SessionLogEntry } from "../recorder";
import { analyzeCameraBoundarySession } from "./index";

function transform(translationX: number): CameraTransform {
  return {
    timestamp: 0,
    source: "BACKGROUND_FEATURES",
    translationX,
    translationY: 0,
    scale: 0,
    roll: 0,
    trackedPointCount: 12,
    inlierRatio: 1,
    reprojectionError: 0.2,
    confidence: 1,
  };
}

function event(alert: boolean): DetectionEvent {
  return { timestamp: 0, state: alert ? "ALERTED" : "STABLE", alert, reason: [] };
}

describe("analyzeCameraBoundarySession", () => {
  it("separates no-adjustment, adjustment, and remeasurement samples", () => {
    const entries = [
      {
        timestamp: 0,
        metadata: {
          userProfile: {} as never,
          cameraProfile: {} as never,
          profileCreatedAt: 0,
          sessionType: "CAMERA_BOUNDARY" as const,
        },
        groundTruth: "CAMERA_TRANSLATION_X",
        cameraState: "VALID",
        cameraTransform: transform(0.02),
        cameraAssessment: { state: "VALID" },
        postureEvent: event(false),
        confidence: 1,
        features: {},
        markers: [
          { timestamp: 0, type: "SCENARIO_STARTED", label: "CAMERA_TRANSLATION_X" },
          { timestamp: 0, type: "CHANGE_ONSET", label: "CAMERA_TRANSLATION_X" },
        ],
      },
      {
        timestamp: 1000,
        groundTruth: "CAMERA_TRANSLATION_X",
        cameraState: "ADJUSTED",
        cameraTransform: transform(0.06),
        cameraAssessment: { state: "ADJUSTED" },
        postureEvent: event(false),
        confidence: 1,
        features: {},
        markers: [],
      },
      {
        timestamp: 2000,
        groundTruth: "CAMERA_TRANSLATION_X",
        cameraState: "ADJUSTED",
        cameraTransform: transform(0.1),
        cameraAssessment: { state: "ADJUSTED" },
        postureEvent: event(true),
        confidence: 1,
        features: {},
        markers: [{ timestamp: 2000, type: "SCENARIO_ENDED", label: "CAMERA_TRANSLATION_X" }],
      },
    ] as unknown as SessionLogEntry[];

    const result = analyzeCameraBoundarySession(entries);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].noAdjustmentMax).toBeCloseTo(0.02);
    expect(result.scenarios[0].adjustmentMin).toBeCloseTo(0.06);
    expect(result.scenarios[0].remeasurementMin).toBeCloseTo(0.1);
  });
});
