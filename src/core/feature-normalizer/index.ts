import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { CameraTransform, FrameFeature } from "../types";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";
import { HAND_LANDMARK_INDEX } from "../../web/camera-adapter/hand-landmarker";
import { RELIABILITY_THRESHOLDS } from "../landmark-reliability";

// One Euro Filter (Casiez et al.) replaced the old fixed-alpha EMA: a fixed
// alpha is a single trade-off between jitter suppression and lag, but
// landmark jitter is worst while roughly still and least noticeable during
// genuine fast motion — exactly the case an adaptive cutoff handles. Cutoff
// frequency rises with the signal's own speed, so slow/still frames (jitter)
// get smoothed hard while fast frames (real posture changes) get smoothed
// gently, cutting lag without giving back the jitter suppression.
//
// MIN_CUTOFF initially chosen to reproduce roughly the old alpha=0.3 EMA's
// smoothing strength at rest (~2.07, solving dt/(dt + 1/(2*pi*cutoff)) = 0.3
// at 30fps). User reported still-live jitter and asked for stronger
// suppression — lowering cutoff increases smoothing (lower cutoff -> larger
// tau -> smaller alpha), so 1.0 roughly halves the effective at-rest alpha
// to ~0.17. This likely needs some posture-rules/index.ts threshold
// re-verification live, unlike the original 2.07 pick. BETA (speed
// sensitivity) unchanged — not yet verified live against a real session;
// adjust if genuine posture transitions feel laggy.
const ONE_EURO_MIN_CUTOFF = 1.0;
const ONE_EURO_BETA = 0.05;

// How far a single frame's raw (pre-smoothing) reading is allowed to move
// from the previous smoothed reading, combined the same way as
// motionEnergy, before it's rejected outright instead of smoothed in. A
// real single-frame jump this large is far more likely to be a momentary
// mis-detection (another person's landmarks briefly overlapping, a hand
// crossing the face) than genuine motion — nobody's shoulders actually
// teleport between two 33ms-apart frames. Candidate value; not yet tuned
// against a real development session.
const JUMP_ENERGY_THRESHOLD = 25;

/**
 * Maps pose landmarks from the current camera view back toward the stored
 * calibration view. The background tracker currently exposes a similarity
 * transform, so this corrects translation, scale, and roll. Perspective
 * changes represented only by yaw/pitch remain assessment signals until the
 * tracker exposes a full projective transform.
 */
export function applyCameraCorrectionToLandmarks(
  landmarks: NormalizedLandmark[],
  transform: CameraTransform,
): NormalizedLandmark[] {
  if (transform.affine) {
    const corrected = applyAffineCorrection(landmarks, transform.affine);
    if (corrected) return corrected;
  }

  const scale = 1 + transform.scale;
  if (!Number.isFinite(scale) || scale <= 0) return landmarks;

  const cos = Math.cos(transform.roll);
  const sin = Math.sin(transform.roll);
  const centerX = 0.5;
  const centerY = 0.5;

  return landmarks.map((landmark) => {
    const shiftedX = landmark.x - centerX - transform.translationX;
    const shiftedY = landmark.y - centerY - transform.translationY;
    const correctedX = centerX + (cos * shiftedX + sin * shiftedY) / scale;
    const correctedY = centerY + (-sin * shiftedX + cos * shiftedY) / scale;

    return {
      ...landmark,
      x: clamp01(correctedX),
      y: clamp01(correctedY),
    };
  });
}

// The tracker estimates affine coefficients in its 320x180 background
// canvas. Applying the inverse matrix in that same coordinate system keeps
// translation, anisotropic scale, shear, and roll together instead of
// approximating them with separate normalized values.
function applyAffineCorrection(
  landmarks: NormalizedLandmark[],
  affine: NonNullable<CameraTransform["affine"]>,
): NormalizedLandmark[] | null {
  const determinant = affine.a * affine.e - affine.b * affine.d;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-6) return null;

  const width = 320;
  const height = 180;
  return landmarks.map((landmark) => {
    const currentX = landmark.x * width;
    const currentY = landmark.y * height;
    const translatedX = currentX - affine.c;
    const translatedY = currentY - affine.f;
    const referenceX = (affine.e * translatedX - affine.b * translatedY) / determinant;
    const referenceY = (-affine.d * translatedX + affine.a * translatedY) / determinant;
    return {
      ...landmark,
      x: clamp01(referenceX / width),
      y: clamp01(referenceY / height),
    };
  });
}

export function applyCameraCorrectionToHandLandmarks(
  hands: NormalizedLandmark[][],
  transform: CameraTransform,
): NormalizedLandmark[][] {
  return hands.map((hand) => applyCameraCorrectionToLandmarks(hand, transform));
}

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
//
// `handLandmarks` is HandLandmarker's per-frame result.landmarks (one
// 21-point array per detected hand, up to 2) — a separate model pass from
// the Pose landmarks above. Omit it when the hand model isn't wired up
// (e.g. in tests): handFaceDistance/handShoulderDistance just stay
// undefined, same as any other missing-landmark case.
export function toFrameFeature(
  landmarks: NormalizedLandmark[],
  timestamp: number,
  previous?: FrameFeature | null,
  handLandmarks?: NormalizedLandmark[][],
): FrameFeature | null {
  const nose = landmarks[LANDMARK_INDEX.nose];
  const leftEye = landmarks[LANDMARK_INDEX.leftEye];
  const rightEye = landmarks[LANDMARK_INDEX.rightEye];
  const leftEar = landmarks[LANDMARK_INDEX.leftEar];
  const rightEar = landmarks[LANDMARK_INDEX.rightEar];
  const mouthLeft = landmarks[LANDMARK_INDEX.mouthLeft];
  const mouthRight = landmarks[LANDMARK_INDEX.mouthRight];
  const leftShoulder = landmarks[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks[LANDMARK_INDEX.rightShoulder];
  if (!nose || !leftShoulder || !rightShoulder) return null;

  // Shadows oneEuroSmooth for every `smooth(...)` call below so each one
  // doesn't need its own dt argument threaded through.
  const dt = previous ? (timestamp - previous.timestamp) / 1000 : 0;
  const smooth = (current: number, previousValue: number | undefined): number =>
    oneEuroSmooth(current, previousValue, dt);

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
  const mouthReliable =
    isVisible(mouthLeft, RELIABILITY_THRESHOLDS.mouthMinConfidence) &&
    isVisible(mouthRight, RELIABILITY_THRESHOLDS.mouthMinConfidence);

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

  // Mouth center: closest available proxy to the chin (see LANDMARK_INDEX),
  // used only for handFaceDistance below — the eye/ear-based headCenter
  // above already backs several other, separately-tuned features and
  // shifting its definition would move all of them at once.
  const mouthCenterX =
    mouthReliable && mouthLeft && mouthRight ? (mouthLeft.x + mouthRight.x) / 2 : undefined;
  const mouthCenterY =
    mouthReliable && mouthLeft && mouthRight ? (mouthLeft.y + mouthRight.y) / 2 : undefined;

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
  // whichever detected hand's palm-center point (HandLandmarker's
  // MIDDLE_FINGER_MCP, index 9 — steadier than any single fingertip) sits
  // closer to the mouth, since only one hand is ever actually near the
  // face/chin at a time — the other arm may be resting on a desk or out of
  // frame entirely. Distance to the mouth (falling back to the eye/ear-based
  // headCenter when the mouth isn't reliable) rather than the wrist, since
  // the wrist is well below the actual point of contact for a real chin
  // rest — confirmed live that wrist-based distance couldn't tell a
  // resting hand from one merely held up near the face.
  const chinReferenceX = mouthCenterX ?? headCenterX;
  const chinReferenceY = mouthCenterY ?? headCenterY;
  let rawHandFaceDistance: number | undefined;
  let rawHandShoulderDistance: number | undefined;
  if (handLandmarks && handLandmarks.length > 0 && shoulderWidth > 0) {
    const candidates = handLandmarks
      .map((hand) => hand[HAND_LANDMARK_INDEX.middleFingerMcp])
      .filter((point): point is NormalizedLandmark => point !== undefined);
    if (candidates.length > 0) {
      const chosenHand = candidates.reduce((closest, candidate) =>
        Math.hypot(candidate.x - chinReferenceX, candidate.y - chinReferenceY) <
        Math.hypot(closest.x - chinReferenceX, closest.y - chinReferenceY)
          ? candidate
          : closest,
      );
      rawHandFaceDistance =
        Math.hypot(chosenHand.x - chinReferenceX, chosenHand.y - chinReferenceY) / shoulderWidth;
      rawHandShoulderDistance =
        Math.hypot(chosenHand.x - shoulderCenterX, chosenHand.y - shoulderCenterY) /
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

  // correctedYaw/forwardLeanProxy/shoulderWidthRatio: posture-rule-detector
  // normalizes every CALIBRATION-reference feature generically as
  // (current - profile.originalCenters[feature]) / MAD, so these are just
  // the raw per-frame ingredients — the "correction"/"delta" happens once,
  // uniformly, in that shared normalization rather than being baked in
  // here (baking it in here would double-subtract). See need_discussion.
  //
  // correctedYaw: same raw signal as yawProxy — the calibration-time yaw
  // baseline already absorbs a webcam mounted off to one side, so the
  // generic calibration-delta is what actually "corrects" it.
  const rawCorrectedYaw = rawYawProxy;
  // forwardLeanProxy: faceToShoulderRatio + pitchProxy, undelta'd. Once the
  // engine subtracts each one's calibration center, this becomes
  // faceToShoulderRatioDelta + pitchProxyDelta — feature_discussion's
  // definition (weight λ folded into "just add them"; not yet tuned).
  const rawForwardLeanProxy =
    rawFaceToShoulderRatio !== undefined && rawPitchProxy !== undefined
      ? rawFaceToShoulderRatio + rawPitchProxy
      : undefined;
  // shoulderWidthRatio: same raw value as bodyScale, exposed under the name
  // posture-rules.ts's ROUNDED_SHOULDERS/TORSO_TWIST/SHOULDERS_ONLY_TWIST
  // expect; the generic calibration-delta turns it into "how much has
  // shoulder width shrunk/grown from calibration," matching the "현재/
  // calibration 비율" intent closely enough for a MAD-normalized rule.
  const rawShoulderWidthRatio = rawBodyScale;

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
  // Raw (not shoulderWidth-divided) screen position — deliberately NOT
  // translation-invariant, unlike shoulderXOffset/YOffset above. Needed for
  // ARMREST_LEAN: telling a real armrest lean (diagonal screen movement,
  // bodyScale unchanged) apart from the chair being pushed back diagonally
  // (same diagonal screen movement, but bodyScale shrinks) requires the raw
  // direction of on-screen movement, not a scale-normalized ratio.
  const shoulderCenterXFeature = smooth(shoulderCenterX, previous?.shoulderCenterX);
  const shoulderCenterYFeature = smooth(shoulderCenterY, previous?.shoulderCenterY);
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
  const correctedYaw =
    rawCorrectedYaw !== undefined ? smooth(rawCorrectedYaw, previous?.correctedYaw) : undefined;
  const forwardLeanProxy =
    rawForwardLeanProxy !== undefined
      ? smooth(rawForwardLeanProxy, previous?.forwardLeanProxy)
      : undefined;
  const shoulderWidthRatio = smooth(rawShoulderWidthRatio, previous?.shoulderWidthRatio);

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
    shoulderCenterX: shoulderCenterXFeature,
    shoulderCenterY: shoulderCenterYFeature,
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
    ...(correctedYaw !== undefined ? { correctedYaw } : {}),
    ...(forwardLeanProxy !== undefined ? { forwardLeanProxy } : {}),
    shoulderWidthRatio,
  };
}

// One Euro Filter, simplified to a single stored state (the previous
// *smoothed* value) to fit this module's existing "previous FrameFeature"
// pattern — the derivative is estimated from that smoothed value rather
// than a separately-smoothed raw signal the canonical filter tracks. `dt`
// is seconds since the previous frame; `previous` is undefined on the first
// frame (or right after a reliability gap, since main.ts resets its
// previousFeature to null then), so there's nothing to smooth against yet —
// just return the raw reading.
function oneEuroSmooth(current: number, previous: number | undefined, dt: number): number {
  if (previous === undefined || dt <= 0) return current;
  const derivative = (current - previous) / dt;
  const cutoff = ONE_EURO_MIN_CUTOFF + ONE_EURO_BETA * Math.abs(derivative);
  const alpha = dt / (dt + 1 / (2 * Math.PI * cutoff));
  return previous + alpha * (current - previous);
}

function isVisible(point: NormalizedLandmark | undefined, minConfidence: number): boolean {
  return point !== undefined && point.visibility >= minConfidence;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
