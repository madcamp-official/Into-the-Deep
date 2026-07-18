import { describe, expect, it } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";
import { RELIABILITY_THRESHOLDS } from "../landmark-reliability";
import { toFrameFeature } from "./index";

function point(x: number, y: number, visibility: number): NormalizedLandmark {
  return { x, y, z: 0, visibility };
}

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

describe("toFrameFeature", () => {
  it("computes faceToShoulderRatio/pitchProxy/yawProxy when eyes and ears are fully visible", () => {
    const feature = toFrameFeature(createLandmarks(), 0);

    expect(feature?.faceToShoulderRatio).toBeDefined();
    expect(feature?.pitchProxy).toBeDefined();
    expect(feature?.yawProxy).toBeDefined();
  });

  it("omits faceToShoulderRatio/pitchProxy (but keeps yawProxy) when an eye is occluded", () => {
    // Before this fix, only landmark *presence* was checked, so this
    // low-visibility eye would have been used as if it were reliable.
    const landmarks = createLandmarks({
      leftEye: point(0.48, 0.38, RELIABILITY_THRESHOLDS.eyeMinConfidence - 0.1),
    });

    const feature = toFrameFeature(landmarks, 0);

    expect(feature?.faceToShoulderRatio).toBeUndefined();
    expect(feature?.pitchProxy).toBeUndefined();
    expect(feature?.yawProxy).toBeDefined();
  });

  it("omits yawProxy (but keeps faceToShoulderRatio/pitchProxy) when an ear is occluded", () => {
    const landmarks = createLandmarks({
      rightEar: point(0.55, 0.4, RELIABILITY_THRESHOLDS.earMinConfidence - 0.1),
    });

    const feature = toFrameFeature(landmarks, 0);

    expect(feature?.yawProxy).toBeUndefined();
    expect(feature?.faceToShoulderRatio).toBeDefined();
    expect(feature?.pitchProxy).toBeDefined();
  });

  it("folds eye/ear visibility into confidence, not just nose/shoulders", () => {
    const landmarks = createLandmarks({
      leftEar: point(0.45, 0.4, 0.2),
    });

    const feature = toFrameFeature(landmarks, 0);

    // nose/shoulders are all visibility 1 here, so pre-fix confidence would
    // have stayed 1 regardless of the occluded ear.
    expect(feature?.confidence).toBe(0.2);
  });
});
