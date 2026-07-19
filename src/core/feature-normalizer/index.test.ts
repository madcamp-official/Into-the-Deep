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

describe("toFrameFeature smoothing", () => {
  it("moves a smoothed value only SMOOTHING_ALPHA of the way toward a sudden raw jump", () => {
    const before = createLandmarks();
    const after = createLandmarks({
      leftShoulder: point(0.4, 0.68, 1),
      rightShoulder: point(0.6, 0.6, 1),
    });

    const previous = toFrameFeature(before, 0);
    const rawTarget = toFrameFeature(after, 1000); // no `previous` -> unsmoothed reading
    const smoothed = toFrameFeature(after, 1000, previous);

    expect(previous).not.toBeNull();
    expect(rawTarget).not.toBeNull();
    expect(smoothed).not.toBeNull();
    if (!previous || !rawTarget || !smoothed) return;

    // Raw reading really did change (otherwise this test would prove nothing).
    expect(rawTarget.shoulderTilt).not.toBeCloseTo(previous.shoulderTilt, 5);

    const expected = previous.shoulderTilt + 0.3 * (rawTarget.shoulderTilt - previous.shoulderTilt);
    expect(smoothed.shoulderTilt).toBeCloseTo(expected, 10);
    // Landed strictly between the old and new raw values, not at either end.
    expect(smoothed.shoulderTilt).not.toBeCloseTo(previous.shoulderTilt, 3);
    expect(smoothed.shoulderTilt).not.toBeCloseTo(rawTarget.shoulderTilt, 3);
  });

  it("does not smooth against a stale value after a reliability gap re-fills yawProxy", () => {
    const earOccluded = createLandmarks({
      rightEar: point(0.55, 0.4, RELIABILITY_THRESHOLDS.earMinConfidence - 0.1),
    });
    const earVisibleAgain = createLandmarks({
      // Asymmetric around the nose (x=0.5) so yawProxy comes out non-zero —
      // a symmetric pair would make this test pass even if smoothing were
      // wrongly applied, since 0 blended with anything still lands near 0.
      leftEar: point(0.4, 0.4, 1),
      rightEar: point(0.56, 0.4, 1),
    });

    const previous = toFrameFeature(earOccluded, 0);
    expect(previous?.yawProxy).toBeUndefined();

    const resumed = toFrameFeature(earVisibleAgain, 1000, previous);
    const rawTarget = toFrameFeature(earVisibleAgain, 1000); // unsmoothed reference

    expect(resumed?.yawProxy).toBeDefined();
    // No valid previous.yawProxy to anchor to, so this frame should be the
    // raw reading, not something blended against a value that never existed.
    expect(resumed?.yawProxy).toBeCloseTo(rawTarget?.yawProxy ?? NaN, 10);
  });
});

describe("toFrameFeature jump rejection", () => {
  it("rejects a frame whose raw reading jumps far from the previous frame", () => {
    const previous = toFrameFeature(createLandmarks(), 0);
    expect(previous).not.toBeNull();

    // A different person's landmarks landing in frame, or a momentary
    // mis-detection — shoulders/nose end up somewhere completely different
    // one frame later, which no real body actually does in ~33ms.
    const jumped = createLandmarks({
      nose: point(0.15, 0.15, 1),
      leftShoulder: point(0.05, 0.2, 1),
      rightShoulder: point(0.9, 0.85, 1),
    });

    expect(toFrameFeature(jumped, 1000, previous)).toBeNull();
  });

  it("does not reject ordinary small frame-to-frame motion", () => {
    const previous = toFrameFeature(createLandmarks(), 0);
    expect(previous).not.toBeNull();

    const nextFrame = createLandmarks({
      leftShoulder: point(0.4, 0.605, 1),
      rightShoulder: point(0.6, 0.598, 1),
    });

    expect(toFrameFeature(nextFrame, 33, previous)).not.toBeNull();
  });

  it("never rejects the first frame, even with no previous to compare against", () => {
    const extreme = createLandmarks({
      nose: point(0.15, 0.15, 1),
      leftShoulder: point(0.05, 0.2, 1),
      rightShoulder: point(0.9, 0.85, 1),
    });

    expect(toFrameFeature(extreme, 0)).not.toBeNull();
  });
});
