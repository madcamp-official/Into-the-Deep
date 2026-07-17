import { startWebcam } from "../camera-adapter/webcam";
import { createPoseLandmarker, detectPoseForVideoFrame } from "../camera-adapter/pose-landmarker";
import { drawSkeleton, drawVideoFrame } from "../canvas-overlay/skeleton-overlay";
import { toFrameFeature } from "../../core/feature-normalizer";
import { toCameraRawFeature } from "../../core/camera-profile";
import { assessLandmarkQuality } from "../../core/landmark-reliability";
import type { FrameFeature } from "../../core/types";

async function main() {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.style.display = "none";

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;

  const status = document.createElement("pre");
  status.style.font = "12px monospace";

  app.append(video, canvas, status);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  status.textContent = "requesting camera permission...";
  await startWebcam(video);

  status.textContent = "loading MediaPipe pose landmarker...";
  const landmarker = await createPoseLandmarker();

  status.textContent = "running";

  let previousFeature: FrameFeature | null = null;

  const loop = () => {
    const timestamp = performance.now();
    const result = detectPoseForVideoFrame(landmarker, video, timestamp);
    const landmarks = result.landmarks[0];

    drawVideoFrame(ctx, video, canvas.width, canvas.height);

    const quality = assessLandmarkQuality(landmarks, timestamp);

    if (!quality.reliable) {
      previousFeature = null;
      status.textContent = `UNKNOWN\n${JSON.stringify(quality, null, 2)}`;
      requestAnimationFrame(loop);
      return;
    }

    drawSkeleton(ctx, landmarks, canvas.width, canvas.height);

    const feature = toFrameFeature(landmarks, timestamp, previousFeature);
    const cameraRawFeature = toCameraRawFeature(landmarks, timestamp);
    previousFeature = feature;

    status.textContent = JSON.stringify({ quality, feature, cameraRawFeature }, null, 2);

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

main().catch((error) => {
  console.error("PostureCore failed to start", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app) app.textContent = `Failed to start: ${String(error)}`;
});
