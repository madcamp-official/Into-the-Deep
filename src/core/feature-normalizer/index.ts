import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FrameFeature } from "../types";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";

// FrameFeature calculation described in plan.md section 8. Coordinates are
// normalized to shoulder-center origin / shoulder-width scale rather than
// raw pixels. Sudden landmark-jump rejection is a Day3 concern once we have
// a motion-energy baseline to judge jumps against.
//
// `previous` is the last FrameFeature (if any) — passing it lets this
// compute a real motionEnergy value; omit it (or pass null) to get 0, e.g.
// on the first frame or right after a reliability gap.
export function toFrameFeature(
  landmarks: NormalizedLandmark[],
  timestamp: number,
  previous?: FrameFeature | null,
): FrameFeature | null {
  const nose = landmarks[LANDMARK_INDEX.nose];
  const leftEye = landmarks[LANDMARK_INDEX.leftEye];
  const rightEye = landmarks[LANDMARK_INDEX.rightEye];
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
  const shoulderTilt =
    (Math.atan2(leftShoulder.y - rightShoulder.y, leftShoulder.x - rightShoulder.x) *
      180) /
    Math.PI;

  const confidence = Math.min(nose.visibility, leftShoulder.visibility, rightShoulder.visibility);
  const headXOffset = shoulderWidth > 0 ? (nose.x - shoulderCenterX) / shoulderWidth : 0;
  const bodyScale = shoulderWidth;
  const faceCenterY = leftEye && rightEye ? (leftEye.y + rightEye.y) / 2 : undefined;
  const eyeDistance =
    leftEye && rightEye ? Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y) : undefined;
  const faceToShoulderRatio =
    eyeDistance !== undefined && shoulderWidth > 0 ? eyeDistance / shoulderWidth : undefined;
  const pitchProxy =
    faceCenterY !== undefined && shoulderWidth > 0 ? (nose.y - faceCenterY) / shoulderWidth : undefined;

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
  const shoulderXOffset = shoulderWidth > 0 ? shoulderCenterX / shoulderWidth : 0;
  const shoulderYOffset = shoulderWidth > 0 ? shoulderCenterY / shoulderWidth : 0;

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
    motionEnergy,
  };
}
