import { describe, expect, it } from "vitest";
import { labelsFromEntries, SessionRecorder } from "./index";
import type { CameraProfile, FrameFeature, UserProfile } from "../../core/types";

describe("SessionRecorder development markers", () => {
  it("keeps scenario markers and the active ground-truth label in JSON entries", () => {
    const recorder = new SessionRecorder();
    recorder.start();
    recorder.mark({
      timestamp: 100,
      type: "SCENARIO_STARTED",
      label: "FORWARD_LEAN",
    });
    recorder.record(createFeature(110), "SETTLING", "UNKNOWN");
    recorder.mark({
      timestamp: 500,
      type: "DRIFT_ONSET",
      label: "FORWARD_LEAN",
    });
    recorder.record(createFeature(510), "FORWARD_LEAN", "UNKNOWN");
    recorder.mark({
      timestamp: 1000,
      type: "SCENARIO_ENDED",
      label: "FORWARD_LEAN",
    });
    const entries = recorder.stop();

    expect(entries[0].markers).toEqual([
      { timestamp: 100, type: "SCENARIO_STARTED", label: "FORWARD_LEAN" },
    ]);
    expect(entries[1].markers).toEqual([
      { timestamp: 500, type: "DRIFT_ONSET", label: "FORWARD_LEAN" },
      { timestamp: 1000, type: "SCENARIO_ENDED", label: "FORWARD_LEAN" },
    ]);
    expect(labelsFromEntries(entries)).toEqual([
      { timestamp: 100, label: "SETTLING" },
      { timestamp: 500, label: "FORWARD_LEAN" },
      { timestamp: 1000, label: "NORMAL_WORK" },
    ]);
  });

  it("stores the calibration snapshot in the first JSONL entry", () => {
    const recorder = new SessionRecorder();
    const userProfile = createUserProfile();
    const cameraProfile = createCameraProfile();

    recorder.start({
      userProfile,
      cameraProfile,
      profileCreatedAt: 1234,
    });
    recorder.record(createFeature(10), "NORMAL_WORK", "UNKNOWN");
    recorder.record(createFeature(20), "NORMAL_WORK", "UNKNOWN");

    const entries = recorder.stop();

    expect(entries[0].metadata).toEqual({
      userProfile,
      cameraProfile,
      profileCreatedAt: 1234,
    });
    expect(entries[1].metadata).toBeUndefined();
  });

  it("logs feature_discussion's relative/environment fields, not just the original nine", () => {
    const recorder = new SessionRecorder();
    recorder.start();
    recorder.record(
      {
        ...createFeature(10),
        shoulderWidth: 0.32,
        handFaceDistance: 0.11,
        landmarkCoverage: 0.9,
      },
      "NORMAL_WORK",
      "UNKNOWN",
    );
    const [entry] = recorder.stop();

    expect(entry.features).toMatchObject({
      shoulderWidth: 0.32,
      handFaceDistance: 0.11,
      landmarkCoverage: 0.9,
    });
    // still carries the original fields too
    expect(entry.features).toMatchObject({ shoulderTilt: 0, motionEnergy: 0 });
    // timestamp/confidence stay top-level, not duplicated inside features
    expect(entry.features).not.toHaveProperty("timestamp");
    expect(entry.features).not.toHaveProperty("confidence");
  });
});

function createFeature(timestamp: number): FrameFeature {
  return {
    timestamp,
    confidence: 0.95,
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    motionEnergy: 0,
  };
}

function createUserProfile(): UserProfile {
  return {
    originalCenters: { shoulderTilt: 0 },
    adaptiveCenters: { shoulderTilt: 0 },
    featureDeviations: { shoulderTilt: 0.1 },
    calibrationDuration: 3000,
    validFrameCount: 30,
  };
}

function createCameraProfile(): CameraProfile {
  return {
    shoulderWidth: 0.4,
    faceCenterX: 0.5,
    faceCenterY: 0.3,
    shoulderCenterX: 0.5,
    shoulderCenterY: 0.6,
    faceToShoulderRatio: 0.2,
    yawProxy: 0,
    pitchProxy: 0.17,
  };
}
