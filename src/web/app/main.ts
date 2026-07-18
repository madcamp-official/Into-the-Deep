import { startWebcam } from "../camera-adapter/webcam";
import { createPoseLandmarker, detectPoseForVideoFrame } from "../camera-adapter/pose-landmarker";
import { drawSkeleton, drawVideoFrame } from "../canvas-overlay/skeleton-overlay";
import { toFrameFeature } from "../../core/feature-normalizer";
import { assessLandmarkQuality } from "../../core/landmark-reliability";
import { buildUserProfile } from "../../core/profile-builder";
import { FixedThresholdDetector } from "../../core/fixed-threshold-detector";
import { SessionRecorder, toJSONL } from "../../evaluation/recorder";
import type { DetectionEvent, FrameFeature, UserProfile } from "../../core/types";

// How long a Calibration/기준 자세 업데이트 click collects frames before
// buildUserProfile() runs. No camera-state validator exists yet (that's
// B's Day3 CameraProfile work), so cameraState is logged as "UNKNOWN"
// rather than a real assessment.
const CALIBRATION_DURATION_MS = 3000;

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

  const controls = document.createElement("div");
  const calibrateButton = document.createElement("button");
  calibrateButton.textContent = "Calibration";
  const updateBaselineButton = document.createElement("button");
  updateBaselineButton.textContent = "기준 자세 업데이트";
  const recordButton = document.createElement("button");
  recordButton.textContent = "측정 시작";
  recordButton.disabled = true;
  const downloadButton = document.createElement("button");
  downloadButton.textContent = "로그 다운로드";
  downloadButton.disabled = true;
  controls.append(calibrateButton, updateBaselineButton, recordButton, downloadButton);

  const status = document.createElement("pre");
  status.style.font = "12px monospace";

  app.append(video, canvas, controls, status);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  status.textContent = "requesting camera permission...";
  await startWebcam(video);

  status.textContent = "loading MediaPipe pose landmarker...";
  const landmarker = await createPoseLandmarker();

  status.textContent = "running";

  let previousFeature: FrameFeature | null = null;
  let profile: UserProfile | null = null;
  let detector: FixedThresholdDetector | null = null;
  let calibrationFrames: FrameFeature[] | null = null;
  let calibrationDeadline = 0;
  let lastSessionLog = "";

  const recorder = new SessionRecorder();

  function startCalibration() {
    calibrationFrames = [];
    calibrationDeadline = performance.now() + CALIBRATION_DURATION_MS;
    calibrateButton.disabled = true;
    updateBaselineButton.disabled = true;
  }

  function finishCalibration(frames: FrameFeature[]) {
    profile = buildUserProfile(frames);
    detector = new FixedThresholdDetector(profile.originalCenters);
    calibrateButton.disabled = false;
    updateBaselineButton.disabled = false;
    recordButton.disabled = false;
  }

  calibrateButton.onclick = startCalibration;
  updateBaselineButton.onclick = startCalibration;

  recordButton.onclick = () => {
    if (!recorder.isRecording()) {
      recorder.start();
      recordButton.textContent = "측정 종료";
      downloadButton.disabled = true;
    } else {
      const entries = recorder.stop();
      recordButton.textContent = "측정 시작";
      lastSessionLog = toJSONL(entries);
      downloadButton.disabled = entries.length === 0;
    }
  };

  downloadButton.onclick = () => {
    const blob = new Blob([lastSessionLog], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `session-${Date.now()}.jsonl`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const loop = () => {
    const timestamp = performance.now();
    const result = detectPoseForVideoFrame(landmarker, video, timestamp);
    const landmarks = result.landmarks[0];

    drawVideoFrame(ctx, video, canvas.width, canvas.height);

    const quality = assessLandmarkQuality(landmarks, timestamp);

    if (!quality.reliable || !landmarks) {
      previousFeature = null;
      status.textContent = `state: UNKNOWN\n${JSON.stringify(quality, null, 2)}`;
      requestAnimationFrame(loop);
      return;
    }

    drawSkeleton(ctx, landmarks, canvas.width, canvas.height);

    const feature = toFrameFeature(landmarks, timestamp, previousFeature);
    previousFeature = feature;

    if (!feature) {
      requestAnimationFrame(loop);
      return;
    }

    if (calibrationFrames) {
      calibrationFrames.push(feature);
      if (timestamp >= calibrationDeadline) {
        const frames = calibrationFrames;
        calibrationFrames = null;
        finishCalibration(frames);
      }
    }

    let event: DetectionEvent | null = null;
    if (detector) {
      event = detector.update(feature);
      if (recorder.isRecording()) {
        recorder.record(feature, "NORMAL_WORK", "UNKNOWN");
      }
    }

    status.textContent = [
      "camera: not assessed yet (Day3 CameraProfile)",
      `landmark confidence: ${feature.confidence.toFixed(2)}`,
      `calibrated: ${profile ? "yes" : "no"}`,
      calibrationFrames ? "calibrating..." : "",
      `recording: ${recorder.isRecording() ? "yes" : "no"}`,
      event ? `state: ${event.state}` : "state: (calibrate first)",
      event ? `alert: ${event.alert}` : "",
      event && event.reason.length > 0 ? `reason: ${event.reason.join(", ")}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

main().catch((error) => {
  console.error("PostureCore failed to start", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app) app.textContent = `Failed to start: ${String(error)}`;
});
