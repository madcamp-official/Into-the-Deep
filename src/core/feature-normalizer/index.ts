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

// How far a single frame's raw (pre-smoothing) reading is allowed to move
// from the previous smoothed reading, combined the same way as
// motionEnergy, before it's rejected outright instead of smoothed in. A
// real single-frame jump this large is far more likely to be a momentary
// mis-detection (another person's landmarks briefly overlapping, a hand
// crossing the face) than genuine motion — nobody's shoulders actually
// teleport between two 33ms-apart frames. Candidate value; not yet tuned
// against a real development session.
const JUMP_ENERGY_THRESHOLD = 25;

// FrameFeature calculation described in plan.md section 8. Coordinates are
// normalized to shoulder-center origin / shoulder-width scale rather than
// raw pixels. Values are exponentially smoothed against `previous` to cut
// down landmark jitter (plan.md Day3 "feature 흔들림 줄이기"), and a raw
// reading that jumps too far in one frame is rejected outright (returns
// null, same as a reliability gap) rather than smoothed in or used as-is.
//
// `previous` is the last FrameFeature (if any) — passing it anchors the
// smoothing/jump-rejection and lets this compute a real motionEnergy
// value; omit it (or pass null) to get an unsmoothed first reading and
// motionEnergy 0, e.g. on the first frame or right after a reliability gap.
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
  const leftWrist = landmarks[LANDMARK_INDEX.leftWrist];
  const rightWrist = landmarks[LANDMARK_INDEX.rightWrist];
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
  const wristsReliable =
    isVisible(leftWrist, RELIABILITY_THRESHOLDS.wristMinConfidence) ||
    isVisible(rightWrist, RELIABILITY_THRESHOLDS.wristMinConfidence);

  // Matches landmark-reliability's confidence definition (need_discussion
  // #2): only the required landmarks (nose, both shoulders) determine frame
  // confidence. Eyes/ears/wrists are optional — losing one shouldn't drag
  // down the frame-level value, only the specific features that need them.
  const confidence = Math.min(
    nose.visibility,
    leftShoulder.visibility,
    rightShoulder.visibility,
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

  // Head center for the ratio features below: prefer the eye midpoint (most
  // accurate), fall back to the ear midpoint, and finally to the nose —
  // nose is always present (it's a required landmark), so headXRatio/
  // headYRatio/headShoulderDistanceRatio are never undefined even when eyes
  // and ears are both unreliable (e.g. a head turned far to one side).
  const faceCenterX =
    eyesReliable && leftEye && rightEye ? (leftEye.x + rightEye.x) / 2 : undefined;
  const earCenterX =
    earsReliable && leftEar && rightEar ? (leftEar.x + rightEar.x) / 2 : undefined;
  const earCenterY =
    earsReliable && leftEar && rightEar ? (leftEar.y + rightEar.y) / 2 : undefined;
  const headCenterX = faceCenterX ?? earCenterX ?? nose.x;
  const headCenterY = faceCenterY ?? earCenterY ?? nose.y;

  const rawShoulderAsymmetry =
    shoulderWidth > 0 ? (leftShoulder.y - rightShoulder.y) / shoulderWidth : 0;
  const rawHeadXRatio = shoulderWidth > 0 ? (headCenterX - shoulderCenterX) / shoulderWidth : 0;
  const rawHeadYRatio = shoulderWidth > 0 ? (headCenterY - shoulderCenterY) / shoulderWidth : 0;
  const rawHeadShoulderDistanceRatio =
    shoulderWidth > 0
      ? Math.hypot(headCenterX - shoulderCenterX, headCenterY - shoulderCenterY) / shoulderWidth
      : 0;
  // Unsigned counterpart to headYRatio — "눕듯이 앉기"/"턱을 뒤로 당기기" rules
  // (feature_discussion) care about the head-to-shoulder gap shrinking
  // regardless of direction, not the signed offset.
  const rawBodyCompressionRatio = Math.abs(rawHeadYRatio);

  // Auxiliary torso-twist signal (feature_discussion's "z좌표는 보조값으로
  // 사용"): MediaPipe's z is depth relative to the hips, noisier than x/y,
  // so this only ever backs up shoulderTilt/torsoRotationProxy, never
  // stands alone as a rule condition.
  const rawShoulderDepthAsymmetry =
    shoulderWidth > 0 ? (leftShoulder.z - rightShoulder.z) / shoulderWidth : 0;

  // Head roll: angle of the eye line (fallback: ear line), same atan2
  // convention as shoulderTilt so a level head reads near 0.
  let rawHeadRoll: number | undefined;
  if (eyesReliable && leftEye && rightEye) {
    rawHeadRoll = (Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 180) / Math.PI;
  } else if (earsReliable && leftEar && rightEar) {
    rawHeadRoll = (Math.atan2(leftEar.y - rightEar.y, leftEar.x - rightEar.x) * 180) / Math.PI;
  }

  // Shoulder "rolling forward" proxy: shrinks as shoulders round forward and
  // narrow relative to a face width that stays roughly constant.
  const rawRelativeShoulderScale =
    eyeDistance !== undefined && eyeDistance > 0 ? shoulderWidth / eyeDistance : undefined;

  // Hand-relative features (turtle-neck-with-chin-resting rules): pick
  // whichever visible wrist sits closer to the head, since only one hand is
  // ever actually near the face/chin at a time — the other arm may be
  // resting on a desk or out of frame entirely.
  let rawHandFaceDistance: number | undefined;
  let rawHandShoulderDistance: number | undefined;
  if (wristsReliable) {
    const candidates = [leftWrist, rightWrist].filter(
      (wrist): wrist is NormalizedLandmark =>
        wrist !== undefined && isVisible(wrist, RELIABILITY_THRESHOLDS.wristMinConfidence),
    );
    const chosenWrist = candidates.reduce((closest, candidate) =>
      Math.hypot(candidate.x - headCenterX, candidate.y - headCenterY) <
      Math.hypot(closest.x - headCenterX, closest.y - headCenterY)
        ? candidate
        : closest,
    );
    if (shoulderWidth > 0) {
      rawHandFaceDistance =
        Math.hypot(chosenWrist.x - headCenterX, chosenWrist.y - headCenterY) / shoulderWidth;
      rawHandShoulderDistance =
        Math.hypot(chosenWrist.x - shoulderCenterX, chosenWrist.y - shoulderCenterY) /
        shoulderWidth;
    }
  }

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

  if (previous) {
    const rawJumpEnergy = Math.hypot(
      rawHeadXOffset - previous.headXOffset,
      rawShoulderXOffset - previous.shoulderXOffset,
      rawShoulderYOffset - previous.shoulderYOffset,
      rawShoulderTilt - previous.shoulderTilt,
      rawBodyScale - previous.bodyScale,
    );

    if (rawJumpEnergy > JUMP_ENERGY_THRESHOLD) {
      return null;
    }
  }

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
  const shoulderAsymmetry = smooth(rawShoulderAsymmetry, previous?.shoulderAsymmetry);
  const headXRatio = smooth(rawHeadXRatio, previous?.headXRatio);
  const headYRatio = smooth(rawHeadYRatio, previous?.headYRatio);
  const headShoulderDistanceRatio = smooth(
    rawHeadShoulderDistanceRatio,
    previous?.headShoulderDistanceRatio,
  );
  const bodyCompressionRatio = smooth(rawBodyCompressionRatio, previous?.bodyCompressionRatio);
  const shoulderDepthAsymmetry = smooth(
    rawShoulderDepthAsymmetry,
    previous?.shoulderDepthAsymmetry,
  );
  const headRoll =
    rawHeadRoll !== undefined ? smooth(rawHeadRoll, previous?.headRoll) : undefined;
  const relativeShoulderScale =
    rawRelativeShoulderScale !== undefined
      ? smooth(rawRelativeShoulderScale, previous?.relativeShoulderScale)
      : undefined;
  const handFaceDistance =
    rawHandFaceDistance !== undefined
      ? smooth(rawHandFaceDistance, previous?.handFaceDistance)
      : undefined;
  const handShoulderDistance =
    rawHandShoulderDistance !== undefined
      ? smooth(rawHandShoulderDistance, previous?.handShoulderDistance)
      : undefined;

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
    shoulderAsymmetry,
    headXRatio,
    headYRatio,
    headShoulderDistanceRatio,
    bodyCompressionRatio,
    shoulderDepthAsymmetry,
    ...(headRoll !== undefined ? { headRoll } : {}),
    ...(relativeShoulderScale !== undefined ? { relativeShoulderScale } : {}),
    ...(handFaceDistance !== undefined ? { handFaceDistance } : {}),
    ...(handShoulderDistance !== undefined ? { handShoulderDistance } : {}),
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
