import { startWebcam } from "../camera-adapter/webcam";
import { createPoseLandmarker, detectPoseForVideoFrame } from "../camera-adapter/pose-landmarker";
import { drawSkeleton } from "../canvas-overlay/skeleton-overlay";
import { toFrameFeature } from "../../core/feature-normalizer";

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

  const loop = () => {
    const result = detectPoseForVideoFrame(landmarker, video, performance.now());
    const landmarks = result.landmarks[0];

    if (landmarks) {
      drawSkeleton(ctx, landmarks, canvas.width, canvas.height);
      const feature = toFrameFeature(landmarks, performance.now());
      if (feature) {
        status.textContent = JSON.stringify(feature, null, 2);
      }
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      status.textContent = "no person detected";
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

main().catch((error) => {
  console.error("PostureCore failed to start", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app) app.textContent = `Failed to start: ${String(error)}`;
});
