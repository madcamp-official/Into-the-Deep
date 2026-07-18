import { describe, expect, it } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";
import { RELIABILITY_THRESHOLDS, assessLandmarkQuality } from "./index";

function point(x: number, y: number, visibility: number): NormalizedLandmark {
  return { x, y, z: 0, visibility };
}

// Builds a full landmark array with nose/eyes/ears/shoulders centered and
// fully visible by default; overrides let a test drop one point's
// visibility to simulate an occluded/turned-away eye or ear. MediaPipe
// always fills every index once a person is detected, so this mirrors
// real input shape rather than a sparse array.
function createLandmarks(
  overrides: Partial<Record<keyof typeof LANDMARK_INDEX, NormalizedLandmark>> = {},
): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = new Array(13).fill(point(0.5, 0.5, 1));
  landmarks[LANDMARK_INDEX.nose] = point(0.5, 0.4, 1);
  landmarks[LANDMARK_INDEX.leftEye] = point(0.48, 0.38, 1);
  landmarks[LANDMARK_INDEX.rightEye] = point(0.52, 0.38, 1);
  landmarks[LANDMARK_INDEX.leftEar] = point(0.45, 0.4, 1);
  landmarks[LANDMARK_INDEX.rightEar] = point(0.55, 0.4, 1);
  landmarks[LANDMARK_INDEX.leftShoulder] = point(0.4, 0.6, 1);
  landmarks[LANDMARK_INDEX.rightShoulder] = point(0.6, 0.6, 1);

  for (const [key, value] of Object.entries(overrides)) {
    landmarks[LANDMARK_INDEX[key as keyof typeof LANDMARK_INDEX]] = value;
  }

  return landmarks;
}

describe("assessLandmarkQuality", () => {
  it("reports eyesReliable and earsReliable true when every point is well visible", () => {
    const quality = assessLandmarkQuality(createLandmarks(), 0);

    expect(quality.reliable).toBe(true);
    expect(quality.eyesReliable).toBe(true);
    expect(quality.earsReliable).toBe(true);
  });

  it("reports earsReliable false when one ear's visibility is below threshold, without affecting the overall reliable/eyesReliable flags", () => {
    const landmarks = createLandmarks({
      leftEar: point(0.45, 0.4, RELIABILITY_THRESHOLDS.earMinConfidence - 0.1),
    });

    const quality = assessLandmarkQuality(landmarks, 0);

    expect(quality.earsReliable).toBe(false);
    // nose/shoulders are still fully visible, so the top-level UNKNOWN gate
    // and eye reliability shouldn't be dragged down by one occluded ear.
    expect(quality.reliable).toBe(true);
    expect(quality.eyesReliable).toBe(true);
  });

  it("reports eyesReliable false when one eye's visibility is below threshold", () => {
    const landmarks = createLandmarks({
      rightEye: point(0.52, 0.38, RELIABILITY_THRESHOLDS.eyeMinConfidence - 0.1),
    });

    const quality = assessLandmarkQuality(landmarks, 0);

    expect(quality.eyesReliable).toBe(false);
    expect(quality.reliable).toBe(true);
  });
});
