import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FrameFeature } from "../types";
import { LANDMARK_INDEX } from "../../web/camera-adapter/pose-landmarker";

// Day1 draft of the FrameFeature calculation described in plan.md section 8.
// Coordinates are normalized to shoulder-center origin / shoulder-width
// scale rather than raw pixels. `motionEnergy` and jump/confidence
// filtering land on Day2 once B/C have something to consume.
export function toFrameFeature(
  landmarks: NormalizedLandmark[],
  timestamp: number,
): FrameFeature | null {
  const nose = landmarks[LANDMARK_INDEX.nose];
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

  const confidence = Math.min(
    nose.visibility ?? 1,
    leftShoulder.visibility ?? 1,
    rightShoulder.visibility ?? 1,
  );

  return {
    timestamp,
    confidence,
    shoulderTilt,
    headXOffset: shoulderWidth > 0 ? (nose.x - shoulderCenterX) / shoulderWidth : 0,
    headYOffset: shoulderWidth > 0 ? (nose.y - shoulderCenterY) / shoulderWidth : 0,
    bodyScale: shoulderWidth,
    motionEnergy: 0,
  };
}
