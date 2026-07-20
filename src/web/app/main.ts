import { startWebcam } from "../camera-adapter/webcam";
import {
  countPersons,
  createPoseLandmarker,
  detectPoseForVideoFrame,
} from "../camera-adapter/pose-landmarker";
import { drawSkeleton, drawVideoFrame } from "../canvas-overlay/skeleton-overlay";
import { toFrameFeature } from "../../core/feature-normalizer";
import {
  buildCameraProfile,
  computeCameraDelta,
  toCameraRawFeature,
} from "../../core/camera-profile";
import { assessLandmarkQuality, describeUnreliableState } from "../../core/landmark-reliability";
import { buildUserProfile } from "../../core/profile-builder";
import { createInitialMADProfile, normalizeFeature } from "../../core/mad-profile";
import { PostureRuleDetector } from "../../core/posture-rule-detector";
import { V2MadUpdater } from "../../core/v2-mad-updater";
import { MovementClassifier } from "../../core/environment-motion";
import {
  SessionRecorder,
  toJSONL,
} from "../../evaluation/recorder";
import { ScenarioLabeler } from "../../evaluation/scenario-labeler";
import { analyzeDevelopmentSession } from "../../evaluation/development-analysis";
import {
  getNextDevelopmentStep,
  CAMERA_DEVELOPMENT_SESSION,
  STANDARD_DEVELOPMENT_SESSION,
  type DevelopmentSessionStep,
} from "../../evaluation/development-session";
import type { SessionType } from "../../evaluation/recorder";
import { loadProfiles, saveProfiles } from "../indexeddb-storage";
import {
  BackgroundMotionTracker,
  describeMovementContext,
} from "../background-motion-tracker";
import type {
  CameraProfile,
  CameraRawFeature,
  DetectionEvent,
  FrameFeature,
  ScenarioLabel,
  UserProfile,
} from "../../core/types";

// Shows which raw feature(s) tripped the alerting rule (e.g.
// "faceToShoulderRatio, headShoulderDistanceRatio") rather than the posture
// scenario name — matchedFeatures reflects only the first matched rule
// (PostureRuleDetector.update), since that's the one driving state/alert.
function describeMatchedFeatures(event: DetectionEvent | null): string {
  if (!event?.matchedFeatures || event.matchedFeatures.length === 0) return "?";
  return event.matchedFeatures.join(", ");
}

// How long a Calibration/기준 자세 업데이트 click collects frames before
// buildUserProfile() runs. No camera-state validator exists yet (that's
// B's Day3 CameraProfile work), so cameraState is logged as "UNKNOWN"
// rather than a real assessment.
const CALIBRATION_DURATION_MS = 5000;
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

  const alertBannerRow = document.createElement("div");
  alertBannerRow.className = "alert-banner-row";

  const v0AlertBanner = document.createElement("div");
  v0AlertBanner.className = "alert-banner alert-banner--idle";
  v0AlertBanner.textContent = "V0: 캘리브레이션 후 측정을 시작하세요";

  const v2AlertBanner = document.createElement("div");
  v2AlertBanner.className = "alert-banner alert-banner--idle";
  v2AlertBanner.textContent = "V2: 캘리브레이션 후 측정을 시작하세요";

  alertBannerRow.append(v0AlertBanner, v2AlertBanner);

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
  automatedSessionButton.textContent = "Development_Posture_Session";
  const cameraSessionButton = document.createElement("button");
  cameraSessionButton.textContent = "Development_Camera_Session";
  cameraSessionButton.disabled = true;
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
    { value: "HEAD_TILT", text: "Head tilt" },
    { value: "CHIN_REST", text: "Chin rest" },
    { value: "HEAD_BACK", text: "Head back" },
    { value: "SHOULDER_ASYMMETRY", text: "Shoulder asymmetry" },
    { value: "ROUNDED_SHOULDERS", text: "Rounded shoulders" },
    { value: "BACKWARD_LEAN", text: "Backward lean" },
    { value: "CHIN_TUCK", text: "Chin tuck" },
    { value: "TORSO_TWIST", text: "Torso twist" },
    { value: "SHOULDERS_ONLY_TWIST", text: "Shoulders only twist" },
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
    cameraSessionButton,
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
  app.append(video, layout, alertBannerRow);
  addLayoutStyles();

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const backgroundMotionTracker = new BackgroundMotionTracker();
  const movementClassifier = new MovementClassifier();

  status.textContent = "requesting camera permission...";
  await startWebcam(video);

  status.textContent = "loading MediaPipe pose landmarker...";
  const landmarker = await createPoseLandmarker();

  status.textContent = "running";

  let previousFeature: FrameFeature | null = null;
  let profile: UserProfile | null = null;
  let cameraProfile: CameraProfile | null = null;
  let profileCreatedAt: number | null = null;
  let postureDetector: PostureRuleDetector | null = null;
  let v2PostureDetector: PostureRuleDetector | null = null;
  let madProfile = createInitialMADProfile();
  let v2MadUpdater = new V2MadUpdater(madProfile);
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
  let currentSessionType: SessionType = "POSTURE";
  let developmentAnalysisSummary = "";

  const recorder = new SessionRecorder();
  const scenarioLabeler = new ScenarioLabeler();

  try {
    const storedProfiles = await loadProfiles();
    if (storedProfiles) {
      activateProfile(
        storedProfiles.userProfile,
        storedProfiles.cameraProfile,
        storedProfiles.madProfile ?? createInitialMADProfile(),
      );
      profileCreatedAt = storedProfiles.lastCalibrationAt;
      calibrationMessage = "saved profile restored";
    }
  } catch (error) {
    calibrationMessage = `profile restore failed: ${String(error)}`;
  }

  function startCalibration() {
    calibrationFrames = [];
    calibrationCameraFrames = [];
    movementClassifier.reset();
    backgroundMotionTracker.reset();
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

      const nextMadProfile = createInitialMADProfile({ now: Date.now() });
      activateProfile(nextProfile, nextCameraProfile, nextMadProfile);
      movementClassifier.reset();
      backgroundMotionTracker.reset();
      const createdAt = Date.now();
      await saveProfiles({
        userProfile: nextProfile,
        cameraProfile: nextCameraProfile,
        madProfile: nextMadProfile,
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
    nextMadProfile: ReturnType<typeof createInitialMADProfile>,
  ): void {
    profile = nextProfile;
    cameraProfile = nextCameraProfile;
    madProfile = nextMadProfile;
    postureDetector = new PostureRuleDetector(profile, madProfile);
    v2PostureDetector = new PostureRuleDetector(profile, madProfile);
    v2MadUpdater = new V2MadUpdater(madProfile);
    recordButton.disabled = false;
    automatedSessionButton.disabled = false;
    cameraSessionButton.disabled = false;
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

  automatedSessionButton.onclick = () =>
    toggleAutomatedSession("POSTURE", STANDARD_DEVELOPMENT_SESSION, automatedSessionButton);
  cameraSessionButton.onclick = () =>
    toggleAutomatedSession("CAMERA", CAMERA_DEVELOPMENT_SESSION, cameraSessionButton);

  function toggleAutomatedSession(
    sessionType: SessionType,
    steps: readonly DevelopmentSessionStep[],
    button: HTMLButtonElement,
  ): void {
    if (automatedSession) {
      finishRecording();
      return;
    }
    if (recorder.isRecording()) return;

    beginRecording(sessionType);
    currentSessionType = sessionType;
    developmentAnalysisSummary = "";
    automatedSession = {
      startedAt: performance.now() + AUTOMATED_SESSION_COUNTDOWN_SECONDS * 1000,
      stepIndex: -1,
      steps,
    };
    button.textContent = `${sessionType === "POSTURE" ? "Development_Posture_Session" : "Development_Camera_Session"} (running)`;
    setManualControlsDisabled(true);
  }

  function beginRecording(sessionType: SessionType = "POSTURE"): void {
    if (recorder.isRecording()) return;

    currentSessionType = sessionType;
    recorder.start(
      profile && cameraProfile && profileCreatedAt !== null
        ? { userProfile: profile, cameraProfile, madProfile, profileCreatedAt, sessionType }
        : undefined,
    );
    scenarioLabeler.reset(performance.now());
    scenarioActive = false;
    recordButton.textContent = "측정 종료";
    automatedSessionButton.textContent = "자동 세션 중지";
    downloadButton.disabled = true;
    automatedSessionButton.textContent = "Development_Posture_Session";
    cameraSessionButton.textContent = "Development_Camera_Session";
    scenarioStartedButton.disabled = false;
    scenarioEndedButton.disabled = false;
  }

  function finishRecording(): void {
    if (!recorder.isRecording()) return;

    const wasAutomated = automatedSession !== null;
    endScenario();
    const entries = recorder.stop();
    automatedSession = null;
    recordButton.textContent = "측정 시작";
    automatedSessionButton.textContent = "자동 Development Session";
    lastSessionLog = toJSONL(entries);
    automatedSessionButton.textContent = "Development_Posture_Session";
    cameraSessionButton.textContent = "Development_Camera_Session";
    if (wasAutomated && currentSessionType === "POSTURE") {
      const analysis = analyzeDevelopmentSession(entries);
      console.info("Development Posture Session analysis", analysis);
      const thresholdPreview = Object.entries(analysis.recommendedRuleThresholds)
        .slice(0, 4)
        .map(([rule, threshold]) => `${rule}=${threshold.toFixed(2)}`)
        .join(", ");
      developmentAnalysisSummary =
        `development analysis: ${analysis.normalFrameCount} normal frames, ` +
        `${Object.keys(analysis.initialMAD).length} MAD features, ` +
        `rule threshold candidates: ${thresholdPreview}`;
    }
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
    automatedSessionButton.disabled = disabled || !profile;
    cameraSessionButton.disabled = disabled || !profile;
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
      if (currentStep.label === "CAMERA_CHANGE") {
        sessionInstruction.textContent =
          "Camera change scenario: move the camera as instructed while keeping your posture stable.";
        return;
      }
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

  function setAlertBanner(
    banner: HTMLDivElement,
    kind: "idle" | "unknown" | "good" | "bad",
    message: string,
  ): void {
    banner.className = `alert-banner alert-banner--${kind}`;
    banner.textContent = message;
  }

  const loop = () => {
    const timestamp = performance.now();
    processAutomatedSession(timestamp);
    updateSessionInstruction(timestamp);
    const result = detectPoseForVideoFrame(landmarker, video, timestamp);
    const landmarks = result.landmarks[0];
    const personCount = countPersons(result);

    drawVideoFrame(ctx, video, canvas.width, canvas.height);

    const quality = assessLandmarkQuality(landmarks, timestamp);

    if (!quality.reliable || !landmarks) {
      previousFeature = null;
      movementClassifier.reset();
      backgroundMotionTracker.reset();
      status.textContent = `state: ${describeUnreliableState(quality)}\n${JSON.stringify(quality, null, 2)}`;
      setAlertBanner(v0AlertBanner, "unknown", `V0: ${describeUnreliableState(quality)}`);
      setAlertBanner(v2AlertBanner, "unknown", `V2: ${describeUnreliableState(quality)}`);
      requestAnimationFrame(loop);
      return;
    }

    drawSkeleton(ctx, landmarks, canvas.width, canvas.height);

    const feature = toFrameFeature(landmarks, timestamp, previousFeature);
    previousFeature = feature;

    if (!feature) {
      movementClassifier.reset();
      setAlertBanner(v0AlertBanner, "unknown", "V0: UNKNOWN");
      setAlertBanner(v2AlertBanner, "unknown", "V2: UNKNOWN");
      requestAnimationFrame(loop);
      return;
    }

    const backgroundMotion = backgroundMotionTracker.update(video);
    feature.backgroundMotion = backgroundMotion.magnitude;
    feature.backgroundTransformConfidence = backgroundMotion.confidence;
    const movement = movementClassifier.update(feature);
    feature.movementContext = movement.context;

    const cameraRawFeature = toCameraRawFeature(landmarks, timestamp);
    const cameraDelta =
      cameraRawFeature && cameraProfile
        ? computeCameraDelta(cameraRawFeature, cameraProfile)
        : null;

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
    let v2Event: DetectionEvent | null = null;
    if (postureDetector) {
      event = postureDetector.update(feature, quality);
      v2Event = v2PostureDetector?.update(feature, quality) ?? null;
      if (currentSessionType === "POSTURE") {
        madProfile = v2MadUpdater.update(feature, {
          landmarkQuality: quality,
          matchedPosture: v2Event?.postureType,
        });
      }
      v2PostureDetector?.setMADProfile(madProfile);
      if (recorder.isRecording()) {
        recorder.record(feature, scenarioLabeler.getCurrentLabel(), "UNKNOWN");
      }
    }

    if (!postureDetector) {
      setAlertBanner(v0AlertBanner, "idle", "V0: 캘리브레이션 후 측정을 시작하세요");
      setAlertBanner(v2AlertBanner, "idle", "V2: 캘리브레이션 후 측정을 시작하세요");
    } else {
      // V0/V2 are judged and shown independently — they can (and are
      // expected to) disagree, that's the whole point of comparing them.
      if (event?.alert) {
        setAlertBanner(v0AlertBanner, "bad", `V0: ${describeMatchedFeatures(event)}`);
      } else {
        setAlertBanner(v0AlertBanner, "good", "V0: 정상 자세입니다");
      }

      if (v2Event?.alert) {
        setAlertBanner(v2AlertBanner, "bad", `V2: ${describeMatchedFeatures(v2Event)}`);
      } else {
        setAlertBanner(v2AlertBanner, "good", "V2: 정상 자세입니다");
      }
    }

    status.textContent = [
      cameraProfile
        ? "camera profile: saved (assessment pending)"
        : "camera profile: not calibrated",
      cameraDelta
        ? `camera scale delta: ${(cameraDelta.globalScaleDelta * 100).toFixed(1)}%`
        : "",
      cameraDelta ? `camera translation X: ${cameraDelta.globalTranslationX.toFixed(3)}` : "",
      cameraDelta ? `camera translation Y: ${cameraDelta.globalTranslationY.toFixed(3)}` : "",
      cameraDelta ? `corrected yaw: ${cameraDelta.correctedYaw.toFixed(3)}` : "",
      `movement context: ${describeMovementContext(movement.context)}`,
      `background motion: ${backgroundMotion.magnitude.toFixed(3)}`,
      `movement onset: ${movement.onset.toLowerCase()}`,
      `landmark confidence: ${feature.confidence.toFixed(2)}`,
      `landmark coverage: ${(quality.landmarkCoverage * 100).toFixed(0)}%`,
      quality.occlusionRate > 0
        ? `occlusion rate: ${(quality.occlusionRate * 100).toFixed(0)}%`
        : "",
      personCount > 1 ? `⚠ person count: ${personCount}` : "",
      feature.headXRatio !== undefined ? `head X ratio: ${feature.headXRatio.toFixed(3)}` : "",
      feature.headYRatio !== undefined ? `head Y ratio: ${feature.headYRatio.toFixed(3)}` : "",
      feature.headShoulderDistanceRatio !== undefined
        ? `head-shoulder distance ratio: ${feature.headShoulderDistanceRatio.toFixed(3)}`
        : "",
      feature.shoulderAsymmetry !== undefined
        ? `shoulder asymmetry: ${feature.shoulderAsymmetry.toFixed(3)}`
        : "",
      feature.headRoll !== undefined ? `head roll: ${feature.headRoll.toFixed(1)}` : "",
      feature.shoulderDepthAsymmetry !== undefined
        ? `shoulder depth asymmetry: ${feature.shoulderDepthAsymmetry.toFixed(3)}`
        : "",
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
      // FORWARD_HEAD (posture-rules.ts) needs faceToShoulderRatio score > 2
      // AND (headShoulderDistanceRatio score > 2 OR pitchProxy score > 1.5).
      // Showing the actual MAD-normalized scores here so it's visible
      // exactly which condition is/isn't clearing its threshold live,
      // rather than guessing at why a real turtle-neck isn't triggering.
      profile
        ? `forwardHead scores (need face>2 AND (dist>2 OR pitch>1.5)): face=${formatScore(
            normalizeFeature(
              feature.faceToShoulderRatio,
              profile.originalCenters.faceToShoulderRatio,
              madProfile.values.faceToShoulderRatio,
            ),
          )} dist=${formatScore(
            normalizeFeature(
              feature.headShoulderDistanceRatio,
              profile.originalCenters.headShoulderDistanceRatio,
              madProfile.values.headShoulderDistanceRatio,
            ),
          )} pitch=${formatScore(
            normalizeFeature(
              feature.pitchProxy,
              profile.originalCenters.pitchProxy,
              madProfile.values.pitchProxy,
            ),
          )}`
        : "",
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
      event?.postureType ? `v0 posture: ${event.postureType}` : "",
      event && event.reason.length > 0 ? `reason: ${event.reason.join(", ")}` : "",
      v2Event ? `v2 state: ${v2Event.state}` : "",
      v2Event?.postureType ? `v2 posture: ${v2Event.postureType}` : "",
      `v2 MAD updates: ${madProfile.updateCount}`,
      developmentAnalysisSummary,
    ]
      .filter((line) => line.length > 0)
      .join("\n");

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

function formatScore(score: number | undefined): string {
  return score === undefined ? "?" : score.toFixed(2);
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

    .alert-banner-row {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1000;
      display: flex;
      box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.15);
    }

    .alert-banner {
      box-sizing: border-box;
      flex: 1 1 50%;
      padding: 18px 24px;
      text-align: center;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: #ffffff;
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
    label === "CLOSE_TO_CAMERA" ||
    label === "HEAD_TILT" ||
    label === "CHIN_REST" ||
    label === "HEAD_BACK" ||
    label === "SHOULDER_ASYMMETRY" ||
    label === "ROUNDED_SHOULDERS" ||
    label === "BACKWARD_LEAN" ||
    label === "CHIN_TUCK" ||
    label === "TORSO_TWIST" ||
    label === "SHOULDERS_ONLY_TWIST";
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
