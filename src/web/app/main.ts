import { startWebcam } from "../camera-adapter/webcam";
import { createPoseLandmarker, detectPoseForVideoFrame } from "../camera-adapter/pose-landmarker";
import { drawSkeleton, drawVideoFrame } from "../canvas-overlay/skeleton-overlay";
import { toFrameFeature } from "../../core/feature-normalizer";
import {
  buildCameraProfile,
  toCameraRawFeature,
} from "../../core/camera-profile";
import { assessLandmarkQuality } from "../../core/landmark-reliability";
import { buildUserProfile } from "../../core/profile-builder";
import { FixedThresholdDetector } from "../../core/fixed-threshold-detector";
import {
  PersonalizedDriftDetector,
  type PersonalizedDetectionResult,
} from "../../core/personalized-detector";
import { SessionRecorder, toJSONL } from "../../evaluation/recorder";
import { loadProfiles, saveProfiles } from "../indexeddb-storage";
import type {
  CameraProfile,
  CameraRawFeature,
  DetectionEvent,
  FrameFeature,
  UserProfile,
} from "../../core/types";

// How long a Calibration/기준 자세 업데이트 click collects frames before
// buildUserProfile() runs. No camera-state validator exists yet (that's
// B's Day3 CameraProfile work), so cameraState is logged as "UNKNOWN"
// rather than a real assessment.
const CALIBRATION_DURATION_MS = 3000;
const MIN_CALIBRATION_FRAMES = 10;

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
  canvas.className = "camera-canvas";

  const layout = document.createElement("main");
  layout.className = "app-layout";

  const sidePanel = document.createElement("aside");
  sidePanel.className = "side-panel";

  const controls = document.createElement("div");
  controls.className = "controls";
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
  status.className = "status";

  sidePanel.append(controls, status);
  layout.append(canvas, sidePanel);
  app.append(video, layout);
  addLayoutStyles();

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  status.textContent = "requesting camera permission...";
  await startWebcam(video);

  status.textContent = "loading MediaPipe pose landmarker...";
  const landmarker = await createPoseLandmarker();

  status.textContent = "running";

  let previousFeature: FrameFeature | null = null;
  let profile: UserProfile | null = null;
  let cameraProfile: CameraProfile | null = null;
  let detector: FixedThresholdDetector | null = null;
  let v1Detector: PersonalizedDriftDetector | null = null;
  let calibrationFrames: FrameFeature[] | null = null;
  let calibrationCameraFrames: CameraRawFeature[] | null = null;
  let calibrationDeadline = 0;
  let calibrationMessage = "";
  let lastSessionLog = "";

  const recorder = new SessionRecorder();

  try {
    const storedProfiles = await loadProfiles();
    if (storedProfiles) {
      activateProfile(storedProfiles.userProfile, storedProfiles.cameraProfile);
      calibrationMessage = "saved profile restored";
    }
  } catch (error) {
    calibrationMessage = `profile restore failed: ${String(error)}`;
  }

  function startCalibration() {
    calibrationFrames = [];
    calibrationCameraFrames = [];
    calibrationDeadline = performance.now() + CALIBRATION_DURATION_MS;
    calibrationMessage = "";
    calibrateButton.disabled = true;
    updateBaselineButton.disabled = true;
  }

  async function finishCalibration(
    frames: FrameFeature[],
    cameraFrames: CameraRawFeature[],
  ): Promise<void> {
    const nextProfile = buildUserProfile(frames);
    const nextCameraProfile = buildCameraProfile(cameraFrames);

    try {
      if (
        nextProfile.validFrameCount < MIN_CALIBRATION_FRAMES ||
        cameraFrames.length < MIN_CALIBRATION_FRAMES ||
        !nextCameraProfile
      ) {
        calibrationMessage = "calibration failed: not enough reliable frames";
        return;
      }

      activateProfile(nextProfile, nextCameraProfile);
      await saveProfiles({
        userProfile: nextProfile,
        cameraProfile: nextCameraProfile,
        lastCalibrationAt: Date.now(),
      });
      calibrationMessage = "profile saved";
    } catch (error) {
      calibrationMessage = `profile save failed: ${String(error)}`;
    } finally {
      calibrateButton.disabled = false;
      updateBaselineButton.disabled = false;
    }
  }

  function activateProfile(
    nextProfile: UserProfile,
    nextCameraProfile: CameraProfile,
  ): void {
    profile = nextProfile;
    cameraProfile = nextCameraProfile;
    detector = new FixedThresholdDetector(profile.originalCenters);
    v1Detector = new PersonalizedDriftDetector(profile);
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

    const cameraRawFeature = toCameraRawFeature(landmarks, timestamp);

    if (calibrationFrames && calibrationCameraFrames) {
      calibrationFrames.push(feature);
      if (cameraRawFeature) {
        calibrationCameraFrames.push(cameraRawFeature);
      }
      if (timestamp >= calibrationDeadline) {
        const frames = calibrationFrames;
        const cameraFrames = calibrationCameraFrames;
        calibrationFrames = null;
        calibrationCameraFrames = null;
        void finishCalibration(frames, cameraFrames);
      }
    }

    let event: DetectionEvent | null = null;
    let v1Result: PersonalizedDetectionResult | null = null;
    if (detector) {
      event = detector.update(feature);
      v1Result = v1Detector?.update(feature) ?? null;
      if (recorder.isRecording()) {
        recorder.record(feature, "NORMAL_WORK", "UNKNOWN");
      }
    }

    status.textContent = [
      cameraProfile
        ? "camera profile: saved (assessment pending)"
        : "camera profile: not calibrated",
      getRatioDeltaLine(
        "camera shoulder-width delta",
        cameraRawFeature?.shoulderWidth,
        cameraProfile?.shoulderWidth,
      ),
      getDeltaLine(
        "camera face-center-x delta",
        cameraRawFeature?.faceCenterX,
        cameraProfile?.faceCenterX,
      ),
      `landmark confidence: ${feature.confidence.toFixed(2)}`,
      feature.faceToShoulderRatio !== undefined
        ? `face/shoulder ratio: ${feature.faceToShoulderRatio.toFixed(3)}`
        : "",
      getDeltaLine("face/shoulder delta", feature.faceToShoulderRatio, profile?.originalCenters.faceToShoulderRatio),
      feature.pitchProxy !== undefined ? `pitch proxy: ${feature.pitchProxy.toFixed(3)}` : "",
      getDeltaLine("pitch delta", feature.pitchProxy, profile?.originalCenters.pitchProxy),
      getRatioDeltaLine("bodyScale delta", feature.bodyScale, profile?.originalCenters.bodyScale),
      `calibrated: ${profile ? "yes" : "no"}`,
      calibrationFrames ? "calibrating..." : "",
      calibrationMessage,
      `recording: ${recorder.isRecording() ? "yes" : "no"}`,
      event ? `state: ${event.state}` : "state: (calibrate first)",
      event ? `alert: ${event.alert}` : "",
      event && event.reason.length > 0 ? `reason: ${event.reason.join(", ")}` : "",
      v1Result ? `v1 drift score: ${v1Result.observation.driftScore.toFixed(2)}` : "",
      v1Result ? `v1 state: ${v1Result.event.state}` : "",
      v1Result ? `v1 alert: ${v1Result.event.alert}` : "",
      v1Result && v1Result.observation.dominantFeatures.length > 0
        ? `v1 dominant: ${v1Result.observation.dominantFeatures.join(", ")}`
        : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

function getDeltaLine(
  label: string,
  currentValue: number | undefined,
  referenceValue: number | undefined,
): string {
  if (currentValue === undefined || referenceValue === undefined) {
    return "";
  }

  return `${label}: ${(currentValue - referenceValue).toFixed(3)}`;
}

function getRatioDeltaLine(
  label: string,
  currentValue: number | undefined,
  referenceValue: number | undefined,
): string {
  if (
    currentValue === undefined ||
    referenceValue === undefined ||
    referenceValue <= 0
  ) {
    return "";
  }

  const deltaRatio = (currentValue - referenceValue) / referenceValue;
  return `${label}: ${(deltaRatio * 100).toFixed(1)}%`;
}

function addLayoutStyles(): void {
  const style = document.createElement("style");
  style.textContent = `
    #app {
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px;
    }

    .app-layout {
      display: flex;
      align-items: flex-start;
      gap: 20px;
    }

    .camera-canvas {
      display: block;
      flex: 1 1 640px;
      width: min(100%, 1000px);
      height: auto;
      aspect-ratio: 16 / 9;
      background: #111827;
    }

    .side-panel {
      flex: 0 1 340px;
      min-width: 280px;
    }

    .controls {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }

    .controls button {
      min-height: 36px;
    }

    .status {
      box-sizing: border-box;
      width: 100%;
      min-height: 280px;
      margin: 0;
      padding: 12px;
      overflow: auto;
      white-space: pre-wrap;
      font: 12px/1.5 monospace;
      background: #f3f4f6;
    }

    @media (max-width: 900px) {
      #app {
        padding: 16px;
      }

      .app-layout {
        flex-direction: column;
      }

      .camera-canvas,
      .side-panel {
        width: 100%;
        min-width: 0;
      }
    }
  `;
  document.head.append(style);
}

main().catch((error) => {
  console.error("PostureCore failed to start", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app) app.textContent = `Failed to start: ${String(error)}`;
});
