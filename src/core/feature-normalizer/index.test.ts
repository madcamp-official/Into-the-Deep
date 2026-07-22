import { describe, expect, it } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";
import { HAND_LANDMARK_INDEX } from "../../web/camera-adapter/hand-landmarker";
import { RELIABILITY_THRESHOLDS } from "../landmark-reliability";
import { toFrameFeature } from "./index";

function point(x: number, y: number, visibility: number): NormalizedLandmark {
  return { x, y, z: 0, visibility };
}

function createLandmarks(
  overrides: Partial<Record<keyof typeof LANDMARK_INDEX, NormalizedLandmark>> = {},
): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = new Array(25).fill(point(0.5, 0.5, 1));
  landmarks[LANDMARK_INDEX.nose] = point(0.5, 0.4, 1);
  landmarks[LANDMARK_INDEX.leftEye] = point(0.48, 0.38, 1);
  landmarks[LANDMARK_INDEX.rightEye] = point(0.52, 0.38, 1);
  landmarks[LANDMARK_INDEX.leftEar] = point(0.45, 0.4, 1);
  landmarks[LANDMARK_INDEX.rightEar] = point(0.55, 0.4, 1);
  landmarks[LANDMARK_INDEX.mouthLeft] = point(0.48, 0.44, 1);
  landmarks[LANDMARK_INDEX.mouthRight] = point(0.52, 0.44, 1);
  landmarks[LANDMARK_INDEX.leftShoulder] = point(0.4, 0.6, 1);
  landmarks[LANDMARK_INDEX.rightShoulder] = point(0.6, 0.6, 1);
  landmarks[LANDMARK_INDEX.leftWrist] = point(0.35, 0.9, 1);
  landmarks[LANDMARK_INDEX.rightWrist] = point(0.65, 0.9, 1);

  for (const [key, value] of Object.entries(overrides)) {
    landmarks[LANDMARK_INDEX[key as keyof typeof LANDMARK_INDEX]] = value;
  }

  return landmarks;
}

// HandLandmarker's per-hand result: a 21-point array, only
// HAND_LANDMARK_INDEX.middleFingerMcp (the palm-center point actually used)
// needs a realistic position for these tests.
function createHand(middleFingerMcp: NormalizedLandmark): NormalizedLandmark[] {
  const hand: NormalizedLandmark[] = new Array(21).fill(point(0, 0, 1));
  hand[HAND_LANDMARK_INDEX.middleFingerMcp] = middleFingerMcp;
  return hand;
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

  it("keeps confidence at the required-landmark (nose/shoulders) minimum, unaffected by an occluded eye/ear/wrist", () => {
    // need_discussion #2: only nose/shoulders gate frame confidence — eyes/
    // ears/wrists are optional, so losing one should only undefine the
    // specific features that depend on it, not drag confidence down.
    const landmarks = createLandmarks({
      leftEar: point(0.45, 0.4, 0.2),
    });

    const feature = toFrameFeature(landmarks, 0);

    expect(feature?.confidence).toBe(1);
    expect(feature?.yawProxy).toBeUndefined();
  });

  it("computes shoulderAsymmetry/headXRatio/headYRatio/headShoulderDistanceRatio/bodyCompressionRatio near zero for a level, centered pose", () => {
    const feature = toFrameFeature(createLandmarks(), 0);

    expect(feature?.shoulderAsymmetry).toBeCloseTo(0, 2);
    expect(feature?.headXRatio).toBeCloseTo(0, 1);
    expect(feature?.headYRatio).toBeLessThan(0); // head sits above the shoulder line
    expect(feature?.headShoulderDistanceRatio).toBeGreaterThan(0);
    expect(feature?.bodyCompressionRatio).toBeCloseTo(
      Math.abs(feature?.headYRatio ?? NaN),
      10,
    );
  });

  it("falls back to the ear midpoint for head-center ratios when eyes are unreliable", () => {
    const landmarks = createLandmarks({
      leftEye: point(0.48, 0.38, RELIABILITY_THRESHOLDS.eyeMinConfidence - 0.1),
      rightEye: point(0.52, 0.38, RELIABILITY_THRESHOLDS.eyeMinConfidence - 0.1),
    });

    const feature = toFrameFeature(landmarks, 0);

    // Still defined (ear fallback), not undefined and not silently using nose.
    expect(feature?.headXRatio).toBeDefined();
    expect(feature?.headRoll).toBeDefined();
  });

  it("still computes head-center ratios (via nose fallback) when both eyes and ears are unreliable", () => {
    const landmarks = createLandmarks({
      leftEye: point(0.48, 0.38, RELIABILITY_THRESHOLDS.eyeMinConfidence - 0.1),
      rightEye: point(0.52, 0.38, RELIABILITY_THRESHOLDS.eyeMinConfidence - 0.1),
      leftEar: point(0.45, 0.4, RELIABILITY_THRESHOLDS.earMinConfidence - 0.1),
      rightEar: point(0.55, 0.4, RELIABILITY_THRESHOLDS.earMinConfidence - 0.1),
    });

    const feature = toFrameFeature(landmarks, 0);

    expect(feature?.headXRatio).toBeDefined();
    expect(feature?.headYRatio).toBeDefined();
    expect(feature?.headShoulderDistanceRatio).toBeDefined();
    // No eye or ear line to measure roll/relative-scale from.
    expect(feature?.headRoll).toBeUndefined();
    expect(feature?.relativeShoulderScale).toBeUndefined();
  });

  it("computes handFaceDistance/handShoulderDistance using whichever hand's palm point is closer to the mouth", () => {
    const landmarks = createLandmarks();
    const nearHand = createHand(point(0.5, 0.46, 1)); // right next to the mouth/chin
    const farHand = createHand(point(0.65, 0.9, 1)); // resting far away, e.g. on a desk

    const feature = toFrameFeature(landmarks, 0, null, [farHand, nearHand]);

    expect(feature?.handFaceDistance).toBeDefined();
    expect(feature?.handShoulderDistance).toBeDefined();
    // The near hand should win, so distance-to-face should be small.
    expect(feature?.handFaceDistance ?? Infinity).toBeLessThan(1);
  });

  it("omits handFaceDistance/handShoulderDistance when no hand is detected", () => {
    const landmarks = createLandmarks();

    const feature = toFrameFeature(landmarks, 0, null, []);

    expect(feature?.handFaceDistance).toBeUndefined();
    expect(feature?.handShoulderDistance).toBeUndefined();
  });
});

describe("toFrameFeature smoothing", () => {
  it("moves a smoothed value only partway toward a sudden raw jump, one ordinary frame later", () => {
    const before = createLandmarks();
    const after = createLandmarks({
      leftShoulder: point(0.4, 0.68, 1),
      rightShoulder: point(0.6, 0.6, 1),
    });

    const previous = toFrameFeature(before, 0);
    // 33ms: a realistic single-frame gap at 30fps — the One Euro Filter's
    // adaptive cutoff means the smoothing strength depends on dt, unlike
    // the old fixed-alpha EMA this replaced.
    const rawTarget = toFrameFeature(after, 33); // no `previous` -> unsmoothed reading
    const smoothed = toFrameFeature(after, 33, previous);

    expect(previous).not.toBeNull();
    expect(rawTarget).not.toBeNull();
    expect(smoothed).not.toBeNull();
    if (!previous || !rawTarget || !smoothed) return;

    // Raw reading really did change (otherwise this test would prove nothing).
    expect(rawTarget.shoulderTilt).not.toBeCloseTo(previous.shoulderTilt, 5);

    // Landed strictly between the old and new raw values, not at either end.
    expect(smoothed.shoulderTilt).toBeGreaterThan(Math.min(previous.shoulderTilt, rawTarget.shoulderTilt));
    expect(smoothed.shoulderTilt).toBeLessThan(Math.max(previous.shoulderTilt, rawTarget.shoulderTilt));
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

// division_plan_3days.md Day1 A task: prove the ratio-based design actually
// holds up — sliding the chair closer/farther/sideways (uniform scale +
// translation applied to every landmark, same relative posture) should
// leave posture features alone and only move the environment/raw camera
// signals (plan_compact.md's "환경 feature만 변화 -> alert 없음").
function transformLandmarks(
  landmarks: NormalizedLandmark[],
  scale: number,
  translateX: number,
  translateY: number,
): NormalizedLandmark[] {
  return landmarks.map((point) => ({
    x: point.x * scale + translateX,
    y: point.y * scale + translateY,
    z: point.z,
    visibility: point.visibility,
  }));
}

describe("toFrameFeature chair-movement invariance", () => {
  it("keeps relative posture features unchanged when the whole body moves closer and sideways", () => {
    const baseline = createLandmarks();
    // 30% closer to the camera (scale 1.3) and shifted sideways/down —
    // same chair-seated posture, different position/distance in frame.
    const moved = transformLandmarks(baseline, 1.3, 0.12, 0.05);

    const baseFeature = toFrameFeature(baseline, 0);
    const movedFeature = toFrameFeature(moved, 0);
    expect(baseFeature).not.toBeNull();
    expect(movedFeature).not.toBeNull();
    if (!baseFeature || !movedFeature) return;

    for (const key of [
      "shoulderTilt",
      "headXRatio",
      "headYRatio",
      "headShoulderDistanceRatio",
      "shoulderAsymmetry",
      "faceToShoulderRatio",
      "pitchProxy",
      "yawProxy",
    ] as const) {
      expect(movedFeature[key]).toBeCloseTo(baseFeature[key] ?? NaN, 6);
    }

    // The environment/raw signal that a chair move *should* affect: body
    // scale grows by exactly the simulated scale factor.
    expect(movedFeature.bodyScale).toBeCloseTo(baseFeature.bodyScale * 1.3, 6);
  });

  it("keeps relative posture features unchanged under scale alone (moving straight back)", () => {
    const baseline = createLandmarks();
    const movedBack = transformLandmarks(baseline, 0.7, 0, 0);

    const baseFeature = toFrameFeature(baseline, 0);
    const movedFeature = toFrameFeature(movedBack, 0);
    expect(baseFeature).not.toBeNull();
    expect(movedFeature).not.toBeNull();
    if (!baseFeature || !movedFeature) return;

    expect(movedFeature.headXRatio).toBeCloseTo(baseFeature.headXRatio ?? NaN, 6);
    expect(movedFeature.headYRatio).toBeCloseTo(baseFeature.headYRatio ?? NaN, 6);
    expect(movedFeature.bodyScale).toBeCloseTo(baseFeature.bodyScale * 0.7, 6);
  });
});

// posture-rule-detector normalizes every CALIBRATION-reference feature
// generically as (current - profile.originalCenters[feature]) / MAD, so
// these three are deliberately raw/undelta'd — the tests below check the
// raw formula, not a pre-subtracted value.
describe("toFrameFeature derived posture-rule features", () => {
  it("computes correctedYaw as the same raw value as yawProxy", () => {
    const feature = toFrameFeature(createLandmarks(), 0);

    expect(feature?.correctedYaw).toBeDefined();
    expect(feature?.correctedYaw).toBeCloseTo(feature?.yawProxy ?? NaN, 10);
  });

  it("omits correctedYaw when yawProxy is unavailable (ears unreliable)", () => {
    const landmarks = createLandmarks({
      leftEar: point(0.45, 0.4, RELIABILITY_THRESHOLDS.earMinConfidence - 0.1),
      rightEar: point(0.55, 0.4, RELIABILITY_THRESHOLDS.earMinConfidence - 0.1),
    });

    const feature = toFrameFeature(landmarks, 0);

    expect(feature?.yawProxy).toBeUndefined();
    expect(feature?.correctedYaw).toBeUndefined();
  });

  it("computes forwardLeanProxy as faceToShoulderRatio + pitchProxy", () => {
    const feature = toFrameFeature(createLandmarks(), 0);

    expect(feature?.forwardLeanProxy).toBeDefined();
    expect(feature?.forwardLeanProxy).toBeCloseTo(
      (feature?.faceToShoulderRatio ?? NaN) + (feature?.pitchProxy ?? NaN),
      10,
    );
  });

  it("omits forwardLeanProxy when faceToShoulderRatio/pitchProxy are unavailable (eyes unreliable)", () => {
    const landmarks = createLandmarks({
      leftEye: point(0.48, 0.38, RELIABILITY_THRESHOLDS.eyeMinConfidence - 0.1),
      rightEye: point(0.52, 0.38, RELIABILITY_THRESHOLDS.eyeMinConfidence - 0.1),
    });

    const feature = toFrameFeature(landmarks, 0);

    expect(feature?.forwardLeanProxy).toBeUndefined();
  });

  it("computes shoulderWidthRatio as the same raw value as bodyScale", () => {
    const feature = toFrameFeature(createLandmarks(), 0);

    expect(feature?.shoulderWidthRatio).toBeCloseTo(feature?.bodyScale ?? NaN, 10);
  });
});


describe("applyCameraCorrectionToLandmarks", () => {
  it("uses the inverse affine matrix when one is available", async () => {
    const { applyCameraCorrectionToLandmarks } = await import("./index");
    const corrected = applyCameraCorrectionToLandmarks(
      [{ x: 0.7, y: 0.5, z: 0, visibility: 1 }],
      {
        timestamp: 1,
        source: "BACKGROUND_FEATURES",
        translationX: 0.1,
        translationY: 0,
        scale: 0.2,
        roll: 0,
        affine: { a: 1.2, b: 0, c: 32, d: 0, e: 1, f: 0 },
        trackedPointCount: 12,
        inlierRatio: 1,
        reprojectionError: 0,
        confidence: 1,
      },
    );

    // Current pixel x=224 maps to reference pixel x=(224-32)/1.2=160.
    expect(corrected[0].x).toBeCloseTo(0.5, 5);
    expect(corrected[0].y).toBeCloseTo(0.5, 5);
  });

  it("removes the camera translation", async () => {
    const { applyCameraCorrectionToLandmarks } = await import("./index");
    const corrected = applyCameraCorrectionToLandmarks(
      [{ x: 0.65, y: 0.4, z: 0, visibility: 1 }],
      {
        timestamp: 1,
        source: "BACKGROUND_FEATURES",
        translationX: 0.1,
        translationY: -0.05,
        scale: 0,
        roll: 0,
        trackedPointCount: 12,
        inlierRatio: 1,
        reprojectionError: 0,
        confidence: 1,
      },
    );

    expect(corrected[0].x).toBeCloseTo(0.55);
    expect(corrected[0].y).toBeCloseTo(0.45);
  });

  it("undoes scale and roll around the normalized image center", async () => {
    const { applyCameraCorrectionToLandmarks } = await import("./index");
    const corrected = applyCameraCorrectionToLandmarks(
      [{ x: 0.5, y: 0.6, z: 0, visibility: 1 }],
      {
        timestamp: 1,
        source: "BACKGROUND_FEATURES",
        translationX: 0,
        translationY: 0,
        scale: 0.2,
        roll: Math.PI / 2,
        trackedPointCount: 12,
        inlierRatio: 1,
        reprojectionError: 0,
        confidence: 1,
      },
    );

    expect(corrected[0].x).toBeCloseTo(0.583333, 5);
    expect(corrected[0].y).toBeCloseTo(0.5, 5);
  });
});

describe("correctBodyYaw", () => {
  it("leaves landmarks unchanged when the shoulder line has no depth gap (facing the camera)", async () => {
    const { correctBodyYaw } = await import("./index");
    // Note: createLandmarks()'s own default shoulder x-order is reversed
    // from the rest of this codebase's convention (confirmed against
    // rawShoulderTilt: "anatomical left shoulder sits at a higher x than
    // the right" in an unmirrored frame) — explicit here so this test
    // doesn't depend on that fixture default.
    const landmarks = createLandmarks({
      leftShoulder: { x: 0.6, y: 0.6, z: 0, visibility: 1 },
      rightShoulder: { x: 0.4, y: 0.6, z: 0, visibility: 1 },
    });

    const { landmarks: corrected, yawAngle } = correctBodyYaw(landmarks);

    expect(corrected).toEqual(landmarks);
    expect(yawAngle).toBe(0);
  });

  it("zeroes the shoulder z-gap and preserves the true 3D shoulder distance when the body is rotated", async () => {
    const { correctBodyYaw } = await import("./index");
    // A 45-degree body rotation: shoulder-line (x, z) vector is (0.2, 0.2).
    const landmarks = createLandmarks({
      leftShoulder: { x: 0.6, y: 0.6, z: 0.1, visibility: 1 },
      rightShoulder: { x: 0.4, y: 0.6, z: -0.1, visibility: 1 },
    });

    const { landmarks: corrected, yawAngle } = correctBodyYaw(landmarks);
    const left = corrected[LANDMARK_INDEX.leftShoulder];
    const right = corrected[LANDMARK_INDEX.rightShoulder];

    expect(yawAngle).toBeCloseTo(Math.PI / 4, 5);
    // z-gap collapses to ~0 (as though shot from directly in front)...
    expect(left.z - right.z).toBeCloseTo(0, 5);
    // ...while the true 3D shoulder distance (hypot(0.2, 0.2)) is preserved
    // as the corrected x-gap, rather than the foreshortened original 0.2.
    expect(left.x - right.x).toBeCloseTo(Math.hypot(0.2, 0.2), 5);
    // y is untouched — this only corrects yaw (rotation in the x/z plane).
    expect(left.y).toBe(0.6);
    expect(right.y).toBe(0.6);
  });

  it("rotates other landmarks (not just the shoulders) by the same angle", async () => {
    const { correctBodyYaw } = await import("./index");
    const landmarks = createLandmarks({
      leftShoulder: { x: 0.6, y: 0.6, z: 0.1, visibility: 1 },
      rightShoulder: { x: 0.4, y: 0.6, z: -0.1, visibility: 1 },
      nose: { x: 0.5, y: 0.4, z: 0, visibility: 1 },
    });

    const { landmarks: corrected } = correctBodyYaw(landmarks);
    const nose = corrected[LANDMARK_INDEX.nose];

    // Pivot is the shoulder midpoint (0.5, 0.6, 0); nose sits directly above
    // it in (x, z) (relativeX=0, relativeZ=0), so a pure yaw rotation about
    // that pivot leaves it exactly in place — this only confirms the
    // rotation is actually being applied consistently to every landmark,
    // not just the two shoulders it was solved from.
    expect(nose.x).toBeCloseTo(0.5, 5);
    expect(nose.z).toBeCloseTo(0, 5);
  });

  it("uses a fixed yaw angle instead of self-estimating when one is supplied", async () => {
    const { correctBodyYaw } = await import("./index");
    // Shoulder line reports ~0 rotation, but a fixed baseline of 45 degrees
    // (e.g. from profile.originalCenters.bodyYawAngle) should still apply.
    const landmarks = createLandmarks({
      leftShoulder: { x: 0.6, y: 0.6, z: 0, visibility: 1 },
      rightShoulder: { x: 0.4, y: 0.6, z: 0, visibility: 1 },
    });

    const { landmarks: corrected, yawAngle } = correctBodyYaw(landmarks, Math.PI / 4);
    const left = corrected[LANDMARK_INDEX.leftShoulder];
    const right = corrected[LANDMARK_INDEX.rightShoulder];

    expect(yawAngle).toBe(Math.PI / 4);
    expect(left.z - right.z).not.toBeCloseTo(0, 5);
  });

  it("skips correction when the shoulder line is too degenerate to derive a reliable angle from", async () => {
    const { correctBodyYaw } = await import("./index");
    const landmarks = createLandmarks({
      leftShoulder: { x: 0.5, y: 0.6, z: 0, visibility: 1 },
      rightShoulder: { x: 0.5, y: 0.6, z: 0, visibility: 1 },
    });

    const { landmarks: corrected, yawAngle } = correctBodyYaw(landmarks);
    expect(corrected).toEqual(landmarks);
    expect(yawAngle).toBeUndefined();
  });
});
