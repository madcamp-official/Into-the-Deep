import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FrameFeature } from "../types";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";
import { RELIABILITY_THRESHOLDS } from "../landmark-reliability";

// How much each frame's smoothed value moves toward the raw reading —
// lower is smoother/slower to react, 1 disables smoothing entirely.
// Candidate value; not yet tuned against a real development session. Same
// weight for every feature for now, even though yawProxy in particular
// looked noisier than the rest during the V1 driftScore review — worth
// revisiting with a per-feature weight if this uniform value isn't enough.
const SMOOTHING_ALPHA = 0.3;

// FrameFeature calculation described in plan.md section 8. Coordinates are
// normalized to shoulder-center origin / shoulder-width scale rather than
// raw pixels. Values are exponentially smoothed against `previous` to cut
// down landmark jitter (plan.md Day3 "feature 흔들림 줄이기"); outright
// jump rejection is a separate, not-yet-implemented concern.
//
// `previous` is the last FrameFeature (if any) — passing it anchors the
// smoothing and lets this compute a real motionEnergy value; omit it (or
// pass null) to get an unsmoothed first reading and motionEnergy 0, e.g.
// on the first frame or right after a reliability gap.
export function toFrameFeature(
  landmarks: NormalizedLandmark[],
  timestamp: number,
  previous?: FrameFeature | null,
): FrameFeature | null {
  const nose = landmarks[LANDMARK_INDEX.nose];
  const leftEye = landmarks[LANDMARK_INDEX.leftEye];
  const rightEye = landmarks[LANDMARK_INDEX.rightEye];
  const leftEar = landmarks[LANDMARK_INDEX.leftEar];
  const rightEar = landmarks[LANDMARK_INDEX.rightEar];
  const leftShoulder = landmarks[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks[LANDMARK_INDEX.rightShoulder];
  if (!nose || !leftShoulder || !rightShoulder) return null;

  const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderCenterY = (leftShoulder.y + rightShoulder.y) / 2;
  const shoulderWidth = Math.hypot(
    rightShoulder.x - leftShoulder.x,
    rightShoulder.y - leftShoulder.y,
  );

  // Angle measured from the anatomical right shoulder to the left shoulder.
  // In an unmirrored camera frame, the anatomical left shoulder sits at a
  // higher x than the right, so this convention keeps the tilt near 0 for
  // level shoulders instead of near +-180.
  const rawShoulderTilt =
    (Math.atan2(leftShoulder.y - rightShoulder.y, leftShoulder.x - rightShoulder.x) *
      180) /
    Math.PI;

  // MediaPipe fills in every landmark index once a person is detected at
  // all, even for points that aren't actually visible (hair-covered ears,
  // a head turned enough that one ear is off to the side, etc.) — so eye/
  // ear inputs need their own visibility check rather than just a presence
  // check, same as landmark-reliability's assessLandmarkQuality does for
  // nose/shoulders. Using the same shared thresholds keeps the two in sync.
  const eyesReliable =
    isVisible(leftEye, RELIABILITY_THRESHOLDS.eyeMinConfidence) &&
    isVisible(rightEye, RELIABILITY_THRESHOLDS.eyeMinConfidence);
  const earsReliable =
    isVisible(leftEar, RELIABILITY_THRESHOLDS.earMinConfidence) &&
    isVisible(rightEar, RELIABILITY_THRESHOLDS.earMinConfidence);

  const confidence = Math.min(
    nose.visibility,
    leftShoulder.visibility,
    rightShoulder.visibility,
    ...(leftEye ? [leftEye.visibility] : []),
    ...(rightEye ? [rightEye.visibility] : []),
    ...(leftEar ? [leftEar.visibility] : []),
    ...(rightEar ? [rightEar.visibility] : []),
  );
  const rawHeadXOffset = shoulderWidth > 0 ? (nose.x - shoulderCenterX) / shoulderWidth : 0;
  const rawBodyScale = shoulderWidth;
  const faceCenterY =
    eyesReliable && leftEye && rightEye ? (leftEye.y + rightEye.y) / 2 : undefined;
  const eyeDistance =
    eyesReliable && leftEye && rightEye
      ? Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y)
      : undefined;
  const rawFaceToShoulderRatio =
    eyeDistance !== undefined && shoulderWidth > 0 ? eyeDistance / shoulderWidth : undefined;
  const rawPitchProxy =
    faceCenterY !== undefined && shoulderWidth > 0 ? (nose.y - faceCenterY) / shoulderWidth : undefined;

  // Head-turn proxy: how asymmetric the nose sits between the two ears,
  // mirrors camera-profile's yawProxy. Facing the camera straight-on keeps
  // this near 0; turning the head left/right pushes it toward +-1.
  let rawYawProxy: number | undefined;
  if (earsReliable && leftEar && rightEar) {
    const leftDist = Math.abs(nose.x - leftEar.x);
    const rightDist = Math.abs(nose.x - rightEar.x);
    const total = leftDist + rightDist;
    rawYawProxy = total > 0 ? (leftDist - rightDist) / total : 0;
  }

  // Shoulder-center position scaled by shoulder width, same convention as
  // headXOffset. Raw frame-normalized position would confound camera
  // distance with real movement (moving closer shrinks apparent drift,
  // moving away exaggerates it); dividing by shoulderWidth cancels that out
  // since both scale together with distance-to-camera. There's no other
  // landmark to take an "offset" from, so drift is judged directly against
  // the calibrated reference center in evaluateV0. shoulderXOffset tracks
  // sideways shifting (e.g. sliding sideways in a chair); shoulderYOffset
  // tracks shoulders rising/dropping and replaces headYOffset as the
  // posture-height signal.
  const rawShoulderXOffset = shoulderWidth > 0 ? shoulderCenterX / shoulderWidth : 0;
  const rawShoulderYOffset = shoulderWidth > 0 ? shoulderCenterY / shoulderWidth : 0;

  const shoulderTilt = smooth(rawShoulderTilt, previous?.shoulderTilt);
  const headXOffset = smooth(rawHeadXOffset, previous?.headXOffset);
  const shoulderXOffset = smooth(rawShoulderXOffset, previous?.shoulderXOffset);
  const shoulderYOffset = smooth(rawShoulderYOffset, previous?.shoulderYOffset);
  const bodyScale = smooth(rawBodyScale, previous?.bodyScale);
  const faceToShoulderRatio =
    rawFaceToShoulderRatio !== undefined
      ? smooth(rawFaceToShoulderRatio, previous?.faceToShoulderRatio)
      : undefined;
  const pitchProxy =
    rawPitchProxy !== undefined ? smooth(rawPitchProxy, previous?.pitchProxy) : undefined;
  const yawProxy = rawYawProxy !== undefined ? smooth(rawYawProxy, previous?.yawProxy) : undefined;

  const motionEnergy = previous
    ? Math.hypot(
        headXOffset - previous.headXOffset,
        shoulderXOffset - previous.shoulderXOffset,
        shoulderYOffset - previous.shoulderYOffset,
        shoulderTilt - previous.shoulderTilt,
        bodyScale - previous.bodyScale,
      )
    : 0;

  return {
    timestamp,
    confidence,
    shoulderTilt,
    headXOffset,
    shoulderXOffset,
    shoulderYOffset,
    bodyScale,
    ...(faceToShoulderRatio !== undefined ? { faceToShoulderRatio } : {}),
    ...(pitchProxy !== undefined ? { pitchProxy } : {}),
    ...(yawProxy !== undefined ? { yawProxy } : {}),
    motionEnergy,
  };
}

// Exponential moving average: nudges the smoothed value toward the raw
// reading by SMOOTHING_ALPHA each frame rather than jumping straight to
// it. `previous` is undefined on the first frame (or right after a
// reliability gap, since main.ts resets its previousFeature to null then),
// so there's nothing to smooth against yet — just return the raw reading.
function smooth(current: number, previous: number | undefined): number {
  return previous === undefined ? current : previous + SMOOTHING_ALPHA * (current - previous);
}

function isVisible(point: NormalizedLandmark | undefined, minConfidence: number): boolean {
  return point !== undefined && point.visibility >= minConfidence;
}
