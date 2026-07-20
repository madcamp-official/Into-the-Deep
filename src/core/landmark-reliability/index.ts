import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";
import type { LandmarkName, LandmarkQuality } from "../types";

export const RELIABILITY_THRESHOLDS = {
  minConfidence: 0.5,
  // Separate constants (not reuses of minConfidence) so eye/ear/wrist
  // sensitivity can be tuned independently later — see the
  // forwardHead/yawProxy review that flagged eye/ear landmarks as never
  // being visibility-checked.
  eyeMinConfidence: 0.5,
  earMinConfidence: 0.5,
  // Wrists back hand-relative features (handFaceDistance,
  // handShoulderDistance per feature_discussion) — elbows are deliberately
  // not tracked per need_discussion's "팔꿈치 없애기" decision.
  wristMinConfidence: 0.5,
  // Distance from the 0..1 frame edge a landmark must clear to count as
  // "in frame" — a small margin so partially-clipped shoulders/face
  // register as unreliable before they fully leave the image.
  frameMargin: 0.02,
};

// Day2 draft of the Reliability Filter (plan.md section 8). Frames that
// fail this check should be treated as UNKNOWN by downstream detectors,
// not as BAD posture. Sudden landmark jumps are a Day3 concern once we
// have a motion-energy baseline to compare against.
export function assessLandmarkQuality(
  landmarks: NormalizedLandmark[] | undefined,
  timestamp: number,
): LandmarkQuality {
  const nose = landmarks?.[LANDMARK_INDEX.nose];
  const leftShoulder = landmarks?.[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks?.[LANDMARK_INDEX.rightShoulder];
  const leftEye = landmarks?.[LANDMARK_INDEX.leftEye];
  const rightEye = landmarks?.[LANDMARK_INDEX.rightEye];
  const leftEar = landmarks?.[LANDMARK_INDEX.leftEar];
  const rightEar = landmarks?.[LANDMARK_INDEX.rightEar];
  const leftWrist = landmarks?.[LANDMARK_INDEX.leftWrist];
  const rightWrist = landmarks?.[LANDMARK_INDEX.rightWrist];

  const personPresent = Boolean(nose && leftShoulder && rightShoulder);
  if (!personPresent || !nose || !leftShoulder || !rightShoulder) {
    return {
      timestamp,
      personPresent: false,
      faceInFrame: false,
      shouldersInFrame: false,
      confidence: 0,
      reliable: false,
      eyesReliable: false,
      earsReliable: false,
      wristsReliable: false,
      landmarkCoverage: 0,
      occlusionRate: 0,
      reliableLandmarks: [],
      unreliableLandmarks: ["nose", "leftShoulder", "rightShoulder"],
    };
  }

  const confidence = Math.min(nose.visibility, leftShoulder.visibility, rightShoulder.visibility);
  const faceInFrame = isInFrame(nose);
  const shouldersInFrame = isInFrame(leftShoulder) && isInFrame(rightShoulder);
  const reliable = faceInFrame && shouldersInFrame && confidence >= RELIABILITY_THRESHOLDS.minConfidence;

  // MediaPipe always fills in an entry for every landmark index once a
  // person is detected at all, even when that specific point (e.g. an ear
  // hidden by hair, or turned away from camera) isn't actually visible —
  // so these need their own visibility check rather than a presence check.
  const eyesReliable = isVisible(leftEye, RELIABILITY_THRESHOLDS.eyeMinConfidence) &&
    isVisible(rightEye, RELIABILITY_THRESHOLDS.eyeMinConfidence);
  const earsReliable = isVisible(leftEar, RELIABILITY_THRESHOLDS.earMinConfidence) &&
    isVisible(rightEar, RELIABILITY_THRESHOLDS.earMinConfidence);
  // Unlike eyes/ears (symmetric pair, both needed for one feature), hand
  // features only need whichever single wrist is near the face/shoulder —
  // e.g. resting a chin on one hand leaves the other arm off on a desk or
  // out of frame, which shouldn't disqualify the gesture.
  const wristsReliable = isVisible(leftWrist, RELIABILITY_THRESHOLDS.wristMinConfidence) ||
    isVisible(rightWrist, RELIABILITY_THRESHOLDS.wristMinConfidence);

  const landmarkChecks: Array<{
    name: LandmarkName;
    point: NormalizedLandmark | undefined;
    minConfidence: number;
  }> = [
    { name: "nose", point: nose, minConfidence: RELIABILITY_THRESHOLDS.minConfidence },
    {
      name: "leftShoulder",
      point: leftShoulder,
      minConfidence: RELIABILITY_THRESHOLDS.minConfidence,
    },
    {
      name: "rightShoulder",
      point: rightShoulder,
      minConfidence: RELIABILITY_THRESHOLDS.minConfidence,
    },
    { name: "leftEye", point: leftEye, minConfidence: RELIABILITY_THRESHOLDS.eyeMinConfidence },
    { name: "rightEye", point: rightEye, minConfidence: RELIABILITY_THRESHOLDS.eyeMinConfidence },
    { name: "leftEar", point: leftEar, minConfidence: RELIABILITY_THRESHOLDS.earMinConfidence },
    { name: "rightEar", point: rightEar, minConfidence: RELIABILITY_THRESHOLDS.earMinConfidence },
    {
      name: "leftWrist",
      point: leftWrist,
      minConfidence: RELIABILITY_THRESHOLDS.wristMinConfidence,
    },
    {
      name: "rightWrist",
      point: rightWrist,
      minConfidence: RELIABILITY_THRESHOLDS.wristMinConfidence,
    },
  ];
  const reliableLandmarks = landmarkChecks
    .filter(({ point, minConfidence }) =>
      point !== undefined && isInFrame(point) && point.visibility >= minConfidence,
    )
    .map(({ name }) => name);
  const unreliableLandmarks = landmarkChecks
    .filter(({ point, minConfidence }) =>
      point === undefined || !isInFrame(point) || point.visibility < minConfidence,
    )
    .map(({ name }) => name);

  // landmarkCoverage: how much of the tracked landmark set (landmarkChecks
  // above) MediaPipe both reports *and* trusts this frame. occlusionRate:
  // of that same set, how many are present but not trustworthy (hidden by
  // hair/hand/turned away) — MediaPipe always fills every index once a
  // person is detected, so "present" alone doesn't mean visible.
  const landmarkCoverage = reliableLandmarks.length / landmarkChecks.length;
  const occlusionRate = unreliableLandmarks.length / landmarkChecks.length;

  return {
    timestamp,
    personPresent,
    faceInFrame,
    shouldersInFrame,
    confidence,
    reliable,
    eyesReliable,
    earsReliable,
    wristsReliable,
    landmarkCoverage,
    occlusionRate,
    reliableLandmarks,
    unreliableLandmarks,
  };
}

// Day3 A-task (plan.md: "사람이 화면 밖으로 나간 경우 NO_PERSON 처리").
// Everything else that fails the reliability check (low confidence,
// partially off-frame, etc.) stays lumped as UNKNOWN per plan.md section 8
// — only "no person at all" gets pulled out as its own label. Callers
// should only use this when `quality.reliable` is already false.
export function describeUnreliableState(quality: LandmarkQuality): "NO_PERSON" | "UNKNOWN" {
  return quality.personPresent ? "UNKNOWN" : "NO_PERSON";
}

function isVisible(point: NormalizedLandmark | undefined, minConfidence: number): boolean {
  return point !== undefined && point.visibility >= minConfidence;
}

function isInFrame(point: NormalizedLandmark): boolean {
  const m = RELIABILITY_THRESHOLDS.frameMargin;
  return point.x > m && point.x < 1 - m && point.y > m && point.y < 1 - m;
}
