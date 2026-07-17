import { PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LANDMARK_INDEX } from "../camera-adapter/pose-landmarker";

// Upper-body landmarks only: full face outline (indices 0-10: nose, eyes,
// ears, mouth corners) plus both shoulders. Arms/hips/legs are excluded —
// the MVP's supported framing (plan.md section 4) only guarantees face +
// shoulders are visible, so drawing the rest is just noise.
const VISIBLE_LANDMARK_INDICES = new Set<number>([
  ...Array.from({ length: 11 }, (_, i) => i),
  LANDMARK_INDEX.leftShoulder,
  LANDMARK_INDEX.rightShoulder,
]);

export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(video, 0, 0, width, height);
}

// Day1 draft: draws the reliability-scoped skeleton over the video frame.
// Calibration-guideline overlay (diffing against a reference skeleton)
// is a later feature — see plan.md section 14.
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): void {
  ctx.fillStyle = "#00e5ff";
  for (const index of VISIBLE_LANDMARK_INDICES) {
    const point = landmarks[index];
    if (!point) continue;
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 2;
  for (const connection of PoseLandmarker.POSE_CONNECTIONS) {
    if (
      !VISIBLE_LANDMARK_INDICES.has(connection.start) ||
      !VISIBLE_LANDMARK_INDICES.has(connection.end)
    ) {
      continue;
    }
    const start = landmarks[connection.start];
    const end = landmarks[connection.end];
    if (!start || !end) continue;
    ctx.beginPath();
    ctx.moveTo(start.x * width, start.y * height);
    ctx.lineTo(end.x * width, end.y * height);
    ctx.stroke();
  }
}
