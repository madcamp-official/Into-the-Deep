import { PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

// Day1 draft: draws the raw MediaPipe skeleton over the video feed.
// Calibration-guideline overlay (diffing against a reference skeleton)
// is a later feature — see plan.md section 14.
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#00e5ff";
  for (const point of landmarks) {
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 2;
  for (const connection of PoseLandmarker.POSE_CONNECTIONS) {
    const start = landmarks[connection.start];
    const end = landmarks[connection.end];
    if (!start || !end) continue;
    ctx.beginPath();
    ctx.moveTo(start.x * width, start.y * height);
    ctx.lineTo(end.x * width, end.y * height);
    ctx.stroke();
  }
}
