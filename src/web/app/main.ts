import { startWebcam } from "../camera-adapter/webcam";
import { createPoseLandmarker, detectPoseForVideoFrame } from "../camera-adapter/pose-landmarker";
import { drawSkeleton, drawVideoFrame } from "../canvas-overlay/skeleton-overlay";
import { toFrameFeature } from "../../core/feature-normalizer";
import {
  buildCameraProfile,
  toCameraRawFeature,
} from "../../core/camera-profile";
import { assessLandmarkQuality, describeUnreliableState } from "../../core/landmark-reliability";
import { buildUserProfile } from "../../core/profile-builder";
import { FixedThresholdDetector } from "../../core/fixed-threshold-detector";
import {
  PersonalizedDriftDetector,
  type PersonalizedDetectionResult,
} from "../../core/personalized-detector";
import {
  SessionRecorder,
  toJSONL,
} from "../../evaluation/recorder";
import { ScenarioLabeler } from "../../evaluation/scenario-labeler";
import {
  getNextDevelopmentStep,
  STANDARD_DEVELOPMENT_SESSION,
  type DevelopmentSessionStep,
} from "../../evaluation/development-session";
import { loadProfiles, saveProfiles } from "../indexeddb-storage";
import type {
  CameraProfile,
  CameraRawFeature,
  DetectionEvent,
  FrameFeature,
  ScenarioLabel,
  UserProfile,
} from "../../core/types";

// How long a Calibration/기준 자세 업데이트 click collects frames before
// buildUserProfile() runs. No camera-state validator exists yet (that's
// B's Day3 CameraProfile work), so cameraState is logged as "UNKNOWN"
// rather than a real assessment.
const CALIBRATION_DURATION_MS = 3000;
const MIN_CALIBRATION_FRAMES = 10;
const AUTOMATED_SESSION_COUNTDOWN_SECONDS = 3;

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

  const alertBanner = document.createElement("div");
  alertBanner.className = "alert-banner alert-banner--idle";
  alertBanner.textContent = "캘리브레이션 후 측정을 시작하세요";

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
  const automatedSessionButton = document.createElement("button");
  automatedSessionButton.textContent = "자동 Development Session";
  automatedSessionButton.disabled = true;
  const downloadButton = document.createElement("button");
  downloadButton.textContent = "로그 다운로드";
  downloadButton.disabled = true;
  const scenarioSelect = document.createElement("select");
  scenarioSelect.className = "scenario-select";
  const scenarios: Array<{ value: ScenarioLabel["label"]; text: string }> = [
    { value: "NORMAL_WORK", text: "Normal work" },
    { value: "TRANSIENT_ACTION", text: "Transient action" },
    { value: "FORWARD_LEAN", text: "Forward lean" },
    { value: "FORWARD_HEAD", text: "Forward head / turtle neck" },
    { value: "LEFT_LEAN", text: "Left lean" },
    { value: "RIGHT_LEAN", text: "Right lean" },
    { value: "SIDE_SHIFT", text: "Side shift" },
    { value: "HEAD_TURN", text: "Head turn" },
    { value: "CLOSE_TO_CAMERA", text: "Close to camera" },
    { value: "CAMERA_CHANGE", text: "Camera change" },
  ];
  for (const scenario of scenarios) {
    const option = document.createElement("option");
    option.value = scenario.value;
    option.textContent = scenario.text;
    scenarioSelect.append(option);
  }

  const scenarioStartedButton = createMarkerButton("Scenario started", true);
  const driftOnsetButton = createMarkerButton("Drift onset", true);
  const scenarioEndedButton = createMarkerButton("Scenario ended", true);
  controls.append(
    calibrateButton,
    updateBaselineButton,
    recordButton,
    automatedSessionButton,
    downloadButton,
    scenarioSelect,
    scenarioStartedButton,
    driftOnsetButton,
    scenarioEndedButton,
  );

  const status = document.createElement("pre");
  status.className = "status";
  const sessionInstruction = document.createElement("div");
  sessionInstruction.className = "session-instruction";
  sessionInstruction.textContent = "자동 Development Session을 시작하면 안내가 표시됩니다.";

  sidePanel.append(controls, sessionInstruction, status);
  layout.append(canvas, sidePanel);
  app.append(video, layout, alertBanner);
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
  let profileCreatedAt: number | null = null;
  let detector: FixedThresholdDetector | null = null;
  let v1Detector: PersonalizedDriftDetector | null = null;
  let calibrationFrames: FrameFeature[] | null = null;
  let calibrationCameraFrames: CameraRawFeature[] | null = null;
  let calibrationDeadline = 0;
  let calibrationMessage = "";
  let lastSessionLog = "";
  let selectedScenario: ScenarioLabel["label"] = "NORMAL_WORK";
  let scenarioActive = false;
  let automatedSession: {
    startedAt: number;
    stepIndex: number;
    steps: readonly DevelopmentSessionStep[];
  } | null = null;

  const recorder = new SessionRecorder();
  const scenarioLabeler = new ScenarioLabeler();

  try {
    const storedProfiles = await loadProfiles();
    if (storedProfiles) {
      activateProfile(storedProfiles.userProfile, storedProfiles.cameraProfile);
      profileCreatedAt = storedProfiles.lastCalibrationAt;
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
      const createdAt = Date.now();
      await saveProfiles({
        userProfile: nextProfile,
        cameraProfile: nextCameraProfile,
        lastCalibrationAt: createdAt,
      });
      profileCreatedAt = createdAt;
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
    automatedSessionButton.disabled = false;
  }

  calibrateButton.onclick = startCalibration;
  updateBaselineButton.onclick = startCalibration;

  recordButton.onclick = () => {
    if (!recorder.isRecording()) {
      beginRecording();
    } else {
      finishRecording();
    }
  };

  scenarioSelect.onchange = () => {
    selectedScenario = scenarioSelect.value as ScenarioLabel["label"];
    driftOnsetButton.disabled =
      !recorder.isRecording() || !isDriftScenario(selectedScenario);
  };

  scenarioStartedButton.onclick = () => {
    if (!recorder.isRecording() || scenarioActive) return;
    startScenario(selectedScenario);
  };

  driftOnsetButton.onclick = () => {
    if (
      !recorder.isRecording() ||
      !scenarioActive ||
      !isDriftScenario(selectedScenario)
    ) {
      return;
    }

    markDriftOnset(selectedScenario);
  };

  scenarioEndedButton.onclick = endScenario;

  automatedSessionButton.onclick = () => {
    if (automatedSession) {
      finishRecording();
      return;
    }
    if (recorder.isRecording()) return;

    beginRecording();
    automatedSession = {
      startedAt:
        performance.now() + AUTOMATED_SESSION_COUNTDOWN_SECONDS * 1000,
      stepIndex: -1,
      steps: STANDARD_DEVELOPMENT_SESSION,
    };
    setManualControlsDisabled(true);
  };

  function beginRecording(): void {
    if (recorder.isRecording()) return;

    recorder.start(
      profile && cameraProfile && profileCreatedAt !== null
        ? { userProfile: profile, cameraProfile, profileCreatedAt }
        : undefined,
    );
    scenarioLabeler.reset(performance.now());
    scenarioActive = false;
    recordButton.textContent = "측정 종료";
    automatedSessionButton.textContent = "자동 세션 중지";
    downloadButton.disabled = true;
    scenarioStartedButton.disabled = false;
    scenarioEndedButton.disabled = false;
  }

  function finishRecording(): void {
    if (!recorder.isRecording()) return;

    endScenario();
    const entries = recorder.stop();
    automatedSession = null;
    recordButton.textContent = "측정 시작";
    automatedSessionButton.textContent = "자동 Development Session";
    lastSessionLog = toJSONL(entries);
    downloadButton.disabled = entries.length === 0;
    scenarioStartedButton.disabled = true;
    driftOnsetButton.disabled = true;
    scenarioEndedButton.disabled = true;
    setManualControlsDisabled(false);
    sessionInstruction.textContent =
      "세션이 종료되었습니다. 로그를 다운로드해 replay 평가에 사용할 수 있습니다.";
  }

  function startScenario(label: ScenarioLabel["label"]): void {
    if (!recorder.isRecording() || scenarioActive) return;

    selectedScenario = label;
    scenarioSelect.value = label;
    const timestamp = performance.now();
    scenarioLabeler.setLabel(
      timestamp,
      isDriftScenario(label) ? "SETTLING" : label,
    );
    recorder.mark({ timestamp, type: "SCENARIO_STARTED", label });
    scenarioActive = true;
    driftOnsetButton.disabled = !isDriftScenario(label);
  }

  function markDriftOnset(label: ScenarioLabel["label"]): void {
    if (!recorder.isRecording() || !scenarioActive || !isDriftScenario(label)) {
      return;
    }

    const timestamp = performance.now();
    scenarioLabeler.setLabel(timestamp, label);
    recorder.mark({ timestamp, type: "DRIFT_ONSET", label });
    driftOnsetButton.disabled = true;
  }

  function endScenario(): void {
    if (!recorder.isRecording() || !scenarioActive) return;

    const timestamp = performance.now();
    scenarioLabeler.setLabel(timestamp, "NORMAL_WORK");
    recorder.mark({
      timestamp,
      type: "SCENARIO_ENDED",
      label: selectedScenario,
    });
    scenarioActive = false;
    driftOnsetButton.disabled = true;
  }

  function setManualControlsDisabled(disabled: boolean): void {
    scenarioSelect.disabled = disabled;
    scenarioStartedButton.disabled = disabled || !recorder.isRecording();
    driftOnsetButton.disabled = true;
    scenarioEndedButton.disabled = disabled || !recorder.isRecording();
  }

  function processAutomatedSession(timestamp: number): void {
    if (!automatedSession) return;

    const elapsedSeconds = (timestamp - automatedSession.startedAt) / 1000;
    while (automatedSession) {
      const next = getNextDevelopmentStep(
        automatedSession.steps,
        automatedSession.stepIndex,
        elapsedSeconds,
      );
      if (!next) break;

      automatedSession.stepIndex = next.index;
      const { action, label } = next.step;
      if (action === "SCENARIO_STARTED" && label) {
        if (scenarioActive) endScenario();
        startScenario(label);
      }
      if (action === "DRIFT_ONSET" && label) markDriftOnset(label);
      if (action === "SCENARIO_ENDED") endScenario();
      if (action === "SESSION_ENDED") finishRecording();
    }
  }

  function updateSessionInstruction(timestamp: number): void {
    if (!automatedSession) return;

    if (timestamp < automatedSession.startedAt) {
      sessionInstruction.textContent =
        `잠시 후 자동 측정을 시작합니다. 준비하세요 (${Math.ceil((automatedSession.startedAt - timestamp) / 1000)}초)`;
      return;
    }

    const currentStep = automatedSession.steps[automatedSession.stepIndex];
    if (!currentStep) {
      sessionInstruction.textContent = "자동 측정을 준비하는 중입니다.";
      return;
    }

    if (currentStep.action === "SCENARIO_STARTED" && currentStep.label) {
      sessionInstruction.textContent = isDriftScenario(currentStep.label)
        ? `${scenarioName(currentStep.label)} 자세로 천천히 이동하세요. 잠시 후 자세를 유지합니다.`
        : currentStep.label === "TRANSIENT_ACTION"
          ? "짧은 자연 행동을 한 뒤 정상 자세로 돌아오세요."
          : "정상 자세로 편하게 작업하세요.";
      return;
    }

    if (currentStep.action === "DRIFT_ONSET" && currentStep.label) {
      sessionInstruction.textContent =
        `${scenarioName(currentStep.label)} 자세를 완성했습니다. 지금 자세를 유지하세요.`;
      return;
    }

    sessionInstruction.textContent = "자세를 풀고 정상 자세로 돌아와 편하게 작업하세요.";
  }

  downloadButton.onclick = () => {
    const blob = new Blob([lastSessionLog], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `session-${Date.now()}.jsonl`;
    link.click();
    URL.revokeObjectURL(url);
  };

  function setAlertBanner(kind: "idle" | "unknown" | "good" | "bad", message: string): void {
    alertBanner.className = `alert-banner alert-banner--${kind}`;
    alertBanner.textContent = message;
  }

  const loop = () => {
    const timestamp = performance.now();
    processAutomatedSession(timestamp);
    updateSessionInstruction(timestamp);
    const result = detectPoseForVideoFrame(landmarker, video, timestamp);
    const landmarks = result.landmarks[0];

    drawVideoFrame(ctx, video, canvas.width, canvas.height);

    const quality = assessLandmarkQuality(landmarks, timestamp);

    if (!quality.reliable || !landmarks) {
      previousFeature = null;
      status.textContent = `state: ${describeUnreliableState(quality)}\n${JSON.stringify(quality, null, 2)}`;
      setAlertBanner("unknown", describeUnreliableState(quality));
      requestAnimationFrame(loop);
      return;
    }

    drawSkeleton(ctx, landmarks, canvas.width, canvas.height);

    const feature = toFrameFeature(landmarks, timestamp, previousFeature);
    previousFeature = feature;

    if (!feature) {
      setAlertBanner("unknown", "UNKNOWN");
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
        recorder.record(feature, scenarioLabeler.getCurrentLabel(), "UNKNOWN");
      }
    }

    if (!detector) {
      setAlertBanner("idle", "캘리브레이션 후 측정을 시작하세요");
    } else {
      const v0Alert = event?.alert ?? false;
      const v1Alert = v1Result?.event.alert ?? false;
      if (v0Alert || v1Alert) {
        const sources = [v0Alert ? "V0" : null, v1Alert ? "V2" : null]
          .filter((source): source is string => source !== null)
          .join(", ");
        const reason =
          v1Result && v1Result.observation.dominantFeatures.length > 0
            ? v1Result.observation.dominantFeatures.join(", ")
            : (event?.reason.join(", ") ?? "");
        setAlertBanner("bad", `자세 이탈 감지 (${sources})${reason ? ` — ${reason}` : ""}`);
      } else {
        setAlertBanner("good", "정상 자세입니다");
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
      feature.headXRatio !== undefined ? `head X ratio: ${feature.headXRatio.toFixed(3)}` : "",
      feature.headYRatio !== undefined ? `head Y ratio: ${feature.headYRatio.toFixed(3)}` : "",
      feature.headShoulderDistanceRatio !== undefined
        ? `head-shoulder distance ratio: ${feature.headShoulderDistanceRatio.toFixed(3)}`
        : "",
      feature.shoulderAsymmetry !== undefined
        ? `shoulder asymmetry: ${feature.shoulderAsymmetry.toFixed(3)}`
        : "",
      feature.headRoll !== undefined ? `head roll: ${feature.headRoll.toFixed(1)}` : "",
      feature.handFaceDistance !== undefined
        ? `hand-face distance: ${feature.handFaceDistance.toFixed(3)}`
        : "",
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
      `scenario: ${scenarioLabeler.getCurrentLabel()}`,
      scenarioActive ? "scenario marker: active" : "",
      automatedSession
        ? timestamp < automatedSession.startedAt
          ? `automated session starts in ${Math.ceil((automatedSession.startedAt - timestamp) / 1000)}s`
          : `automated session: ${((timestamp - automatedSession.startedAt) / 1000).toFixed(0)}s`
        : "",
      event ? `state: ${event.state}` : "state: (calibrate first)",
      event ? `alert: ${event.alert}` : "",
      event && event.reason.length > 0 ? `reason: ${event.reason.join(", ")}` : "",
      v1Result ? `v1 drift score: ${v1Result.observation.driftScore.toFixed(2)}` : "",
      v1Result ? `v1 state: ${v1Result.event.state}` : "",
      v1Result ? `v1 alert: ${v1Result.event.alert}` : "",
      v1Result && v1Result.event.state === "BAD" && v1Result.observation.dominantFeatures.length > 0
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
      padding-bottom: 96px;
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

    .scenario-select {
      grid-column: 1 / -1;
      min-height: 36px;
      padding: 0 8px;
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

    .session-instruction {
      box-sizing: border-box;
      width: 100%;
      min-height: 64px;
      margin-bottom: 12px;
      padding: 12px;
      border-left: 4px solid #2563eb;
      background: #eff6ff;
      color: #1e3a8a;
      font-weight: 600;
      line-height: 1.5;
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

    .alert-banner {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1000;
      box-sizing: border-box;
      width: 100%;
      padding: 18px 24px;
      text-align: center;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: #ffffff;
      box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.15);
      transition: background-color 150ms ease;
    }

    .alert-banner--idle {
      background: #6b7280;
    }

    .alert-banner--unknown {
      background: #b45309;
    }

    .alert-banner--good {
      background: #16a34a;
    }

    .alert-banner--bad {
      background: #dc2626;
    }
  `;
  document.head.append(style);
}

function createMarkerButton(label: string, disabled: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  button.disabled = disabled;
  return button;
}

function isDriftScenario(label: ScenarioLabel["label"]): boolean {
  return label === "FORWARD_LEAN" ||
    label === "FORWARD_HEAD" ||
    label === "LEFT_LEAN" ||
    label === "RIGHT_LEAN" ||
    label === "SIDE_SHIFT" ||
    label === "HEAD_TURN" ||
    label === "CLOSE_TO_CAMERA";
}

function scenarioName(label: ScenarioLabel["label"]): string {
  const names: Partial<Record<ScenarioLabel["label"], string>> = {
    FORWARD_LEAN: "앞으로 숙이는",
    FORWARD_HEAD: "거북목",
    LEFT_LEAN: "왼쪽으로 기울이는",
    RIGHT_LEAN: "오른쪽으로 기울이는",
    SIDE_SHIFT: "좌우로 이동하는",
    HEAD_TURN: "고개를 돌리는",
    CLOSE_TO_CAMERA: "카메라에 가까이 가는",
  };
  return names[label] ?? label;
}

main().catch((error) => {
  console.error("PostureCore failed to start", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app) app.textContent = `Failed to start: ${String(error)}`;
});
