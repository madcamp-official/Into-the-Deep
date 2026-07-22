import { startWebcam } from "../camera-adapter/webcam";
import {
  countPersons,
  createPoseLandmarker,
  detectPoseForVideoFrame,
} from "../camera-adapter/pose-landmarker";
import {
  createHandLandmarker,
  detectHandsForVideoFrame,
} from "../camera-adapter/hand-landmarker";
import { drawSkeleton, drawVideoFrame } from "../canvas-overlay/skeleton-overlay";
import {
  applyCameraCorrectionToHandLandmarks,
  applyCameraCorrectionToLandmarks,
  toFrameFeature,
} from "../../core/feature-normalizer";
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

// A single-frame motionEnergy threshold alone can't separate landmark
// jitter from real motion — live captures showed a static ARMREST_LEAN
// hold spike to 0.398 while a genuine mouse-reach frame read as low as
// 0.190 (see posture-rule-detector's motionSustainMs comment). Gate stays
// moderate; PostureRuleDetector's sustain-duration check is what actually
// filters out single-frame noise.
const V2_MOTION_ENERGY_GATE = 0.2;
import { MovementClassifier } from "../../core/environment-motion";
import {
  SessionRecorder,
  parseJSONL,
  toJSONL,
} from "../../evaluation/recorder";
import {
  formatPostureThresholdSweep,
  sweepPostureThresholds,
} from "../../evaluation/posture-threshold-sweep";
import { ScenarioLabeler } from "../../evaluation/scenario-labeler";
import { analyzeDevelopmentSession } from "../../evaluation/development-analysis";
import {
  analyzeCameraVerificationSession,
  formatCameraVerificationMetrics,
} from "../../evaluation/camera-verification";
import {
  analyzeCameraBoundarySession,
  formatCameraBoundaryMetrics,
} from "../../evaluation/camera-boundary";
import { assessCameraTransform, CameraAssessmentTracker } from "../../core/camera-assessment";
import {
  getNextDevelopmentStep,
  CAMERA_DEVELOPMENT_SESSION,
  MAD_COMPARISON_SESSION,
  STANDARD_DEVELOPMENT_SESSION,
  type DevelopmentSessionStep,
} from "../../evaluation/development-session";
import type { SessionType } from "../../evaluation/recorder";
import {
  analyzeMADComparisonSession,
  formatMADComparisonReport,
} from "../../evaluation/mad-comparison";
import { loadProfiles, saveProfiles } from "../indexeddb-storage";
import { describeMovementContext } from "../background-motion-tracker";
import { BackgroundFeatureTracker, type BackgroundReference } from "../background-feature-tracker";
import { SessionAudioNotifier } from "../session-audio";
import type {
  CameraProfile,
  CameraRawFeature,
  CameraAssessment,
  CameraTransform,
  DetectionEvent,
  FrameFeature,
  MADProfile,
  PostureFeatureName,
  ScenarioLabel,
  UserProfile,
} from "../../core/types";

// Shows the matched posture type alongside which raw feature(s) tripped
// the rule (e.g. "FORWARD_HEAD (faceToShoulderRatio)") — both reflect only
// the first matched rule (PostureRuleDetector.update), since that's the
// one driving state/alert.
function describeMatchedFeatures(event: DetectionEvent | null): string {
  const postureType = event?.postureType ?? "?";
  const features =
    event?.matchedFeatures && event.matchedFeatures.length > 0
      ? event.matchedFeatures.join(", ")
      : "?";
  return `${postureType} (${features})`;
}

// How long a Calibration/기준 자세 업데이트 click collects frames before
// buildUserProfile() runs. No camera-state validator exists yet (that's
// B's Day3 CameraProfile work), so cameraState is logged as "UNKNOWN"
// rather than a real assessment.
const CALIBRATION_DURATION_MS = 5000;
const MIN_CALIBRATION_FRAMES = 10;
const AUTOMATED_SESSION_COUNTDOWN_SECONDS = 3;
const CAMERA_BOUNDARY_SETTLE_MS = 2000;
const CAMERA_BOUNDARY_PRECISION = 0.015;
const CAMERA_BOUNDARY_MAX_ATTEMPTS = 8;
// Temporarily disable camera environment detection/correction while the
// posture flow uses recalibration guidance based on posture alerts. Keeping a
// single switch makes the camera pipeline easy to restore later.
const CAMERA_ENVIRONMENT_PIPELINE_ENABLED = false;

interface CameraBoundaryScenario {
  label: ScenarioLabel["label"];
  name: string;
  instruction: string;
}

interface CameraBoundarySession {
  scenarioIndex: number;
  attempts: number;
  phase: "MOVE" | "WAIT_STABLE" | "RETURN";
  stableSince: number | null;
  measured: boolean;
  lower: number | null;
  upper: number | null;
  changeMarked: boolean;
}

const CAMERA_BOUNDARY_SCENARIOS: readonly CameraBoundaryScenario[] = [
  { label: "CAMERA_TRANSLATION_X", name: "카메라 좌우 이동", instruction: "노트북 높이와 화면 각도는 유지한 채, 노트북을 좌우로 조금씩 이동하세요." },
  { label: "CAMERA_TRANSLATION_Y", name: "카메라 상하 이동", instruction: "화면 각도는 유지한 채, 노트북을 위나 아래로 조금씩 이동하세요." },
  { label: "CAMERA_ROLL", name: "화면 좌우 회전", instruction: "노트북 위치는 유지하고 화면만 좌우로 조금씩 회전하세요." },
  { label: "CAMERA_YAW_LEFT", name: "카메라 왼쪽 회전", instruction: "노트북 위치는 유지하고 카메라가 사용자의 왼쪽을 보도록 조금씩 돌리세요." },
  { label: "CAMERA_YAW_RIGHT", name: "카메라 오른쪽 회전", instruction: "노트북 위치는 유지하고 카메라가 사용자의 오른쪽을 보도록 조금씩 돌리세요." },
  { label: "CAMERA_PITCH_UP", name: "카메라 위쪽 회전", instruction: "노트북 위치는 유지하고 화면 위쪽이 조금 들리도록 기울이세요." },
  { label: "CAMERA_PITCH_DOWN", name: "카메라 아래쪽 회전", instruction: "노트북 위치는 유지하고 화면 위쪽이 조금 내려가도록 기울이세요." },
  { label: "CAMERA_SCALE", name: "카메라 거리 변화", instruction: "노트북을 사용자에게 가까이 또는 멀리 조금씩 이동하세요." },
];

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
  const captureButton = document.createElement("button");
  captureButton.textContent = "Feature 캡처";
  const automatedSessionButton = document.createElement("button");
  automatedSessionButton.textContent = "자동 Development Session";
  automatedSessionButton.disabled = true;
  automatedSessionButton.textContent = "Development_Posture_Session";
  const madComparisonSessionButton = document.createElement("button");
  madComparisonSessionButton.textContent = "V0·V2 MAD 비교 세션";
  madComparisonSessionButton.disabled = true;
  const cameraSessionButton = document.createElement("button");
  cameraSessionButton.textContent = "Development_Camera_Session";
  cameraSessionButton.disabled = true;
  const cameraBoundarySessionButton = document.createElement("button");
  cameraBoundarySessionButton.textContent = "카메라 경계 탐색 세션";
  cameraBoundarySessionButton.disabled = true;
  const downloadButton = document.createElement("button");
  const thresholdSweepButton = document.createElement("button");
  thresholdSweepButton.textContent = "Threshold sweep (JSONL)";
  const thresholdFileInput = document.createElement("input");
  thresholdFileInput.type = "file";
  thresholdFileInput.accept = ".jsonl,.ndjson,.txt,application/jsonl";
  thresholdFileInput.hidden = true;
  const thresholdSweepOutput = document.createElement("pre");
  thresholdSweepOutput.className = "threshold-sweep-output";
  const captureOutput = document.createElement("pre");
  captureOutput.className = "capture-output";
  captureOutput.textContent = "자세를 취한 채로 \"Feature 캡처\"를 누르면 그 순간의 feature 값이 여기 쌓입니다.";
  downloadButton.textContent = "로그 다운로드";
  downloadButton.disabled = true;
  const modeButton = document.createElement("button");
  modeButton.textContent = "Camera Verification Mode";
  const cameraFileInput = document.createElement("input");
  cameraFileInput.type = "file";
  cameraFileInput.accept = ".jsonl,.ndjson,.txt,application/jsonl";
  cameraFileInput.hidden = true;
  const cameraUploadButton = document.createElement("button");
  cameraUploadButton.textContent = "Analyze Camera JSONL";
  const cameraVerificationOutput = document.createElement("pre");
  cameraVerificationOutput.className = "threshold-sweep-output";
  const scenarioSelect = document.createElement("select");
  scenarioSelect.className = "scenario-select";
  const scenarios: Array<{ value: ScenarioLabel["label"]; text: string }> = [
    { value: "NORMAL_WORK", text: "Normal work" },
    { value: "TRANSIENT_ACTION", text: "Transient action" },
    { value: "FORWARD_LEAN", text: "Forward lean" },
    { value: "FORWARD_HEAD", text: "Forward head / turtle neck" },
    { value: "HEAD_DOWN", text: "Head down" },
    { value: "LEFT_LEAN", text: "Left lean" },
    { value: "RIGHT_LEAN", text: "Right lean" },
    { value: "SIDE_SHIFT", text: "Side shift" },
    { value: "HEAD_TURN", text: "Head turn" },
    { value: "CLOSE_TO_CAMERA", text: "Close to camera" },
    { value: "CAMERA_CHANGE", text: "Camera change" },
    { value: "CAMERA_TRANSLATION_X", text: "Camera: left/right" },
    { value: "CAMERA_TRANSLATION_Y", text: "Camera: up/down" },
    { value: "CAMERA_ROLL", text: "Camera: rotate screen angle" },
    { value: "CAMERA_YAW_LEFT", text: "Camera: turn left" },
    { value: "CAMERA_YAW_RIGHT", text: "Camera: turn right" },
    { value: "CAMERA_SCALE", text: "Camera: closer/farther" },
    { value: "CAMERA_RETURN", text: "Camera: return to baseline" },
    { value: "HEAD_TILT", text: "Head tilt" },
    { value: "CHIN_REST", text: "Chin rest" },
    { value: "HEAD_BACK", text: "Head back" },
    { value: "SHOULDER_ASYMMETRY", text: "Shoulder asymmetry" },
    { value: "ROUNDED_SHOULDERS", text: "Rounded shoulders" },
    { value: "BACKWARD_LEAN", text: "Backward lean" },
    { value: "CHIN_TUCK", text: "Chin tuck" },
    { value: "TORSO_TWIST", text: "Torso twist" },
    { value: "SHOULDERS_ONLY_TWIST", text: "Shoulders only twist" },
    { value: "ARMREST_LEAN", text: "Armrest lean" },
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
    captureButton,
    automatedSessionButton,
    madComparisonSessionButton,
    cameraSessionButton,
    cameraBoundarySessionButton,
    downloadButton,
    thresholdSweepButton,
    thresholdFileInput,
    modeButton,
    cameraUploadButton,
    cameraFileInput,
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

  sidePanel.append(
    controls,
    sessionInstruction,
    status,
    captureOutput,
    thresholdSweepOutput,
    cameraVerificationOutput,
  );
  layout.append(canvas, sidePanel);
  app.append(video, layout, alertBannerRow);
  addLayoutStyles();

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const backgroundFeatureTracker = new BackgroundFeatureTracker();
  const cameraAssessmentTracker = new CameraAssessmentTracker();
  const movementClassifier = new MovementClassifier();
  const sessionAudio = new SessionAudioNotifier();

  status.textContent = "requesting camera permission...";
  await startWebcam(video);

  status.textContent = "loading MediaPipe pose landmarker...";
  const landmarker = await createPoseLandmarker();

  status.textContent = "loading MediaPipe hand landmarker...";
  const handLandmarker = await createHandLandmarker();

  status.textContent = "running";

  let previousFeature: FrameFeature | null = null;
  let profile: UserProfile | null = null;
  let cameraProfile: CameraProfile | null = null;
  let profileCreatedAt: number | null = null;
  let postureDetector: PostureRuleDetector | null = null;
  let v2PostureDetector: PostureRuleDetector | null = null;
  let madProfile = createInitialMADProfile();
  // v0 never gets setMADProfile calls (it's the frozen, zero-latency
  // baseline), but `madProfile` above is continuously reassigned by
  // v2MadUpdater during stable windows. Kept as a separate reference,
  // frozen at calibration, so the capture panel can show the score v0
  // actually used instead of silently showing v2's drifted one for both.
  let v0MadProfile = createInitialMADProfile();
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
  let cameraBoundarySession: CameraBoundarySession | null = null;
  let currentSessionType: SessionType = "POSTURE";
  let developmentAnalysisSummary = "";
  let cameraVerificationMode = false;
  let backgroundReference: BackgroundReference | undefined;
  let baselineVerificationUntil = 0;
  let baselineVerificationKind: "STARTUP" | "POST_MOTION" | null = null;
  let baselineVerificationTransforms: CameraTransform[] = [];
  let baselineAssessment: CameraAssessment | null = null;
  let baselineVerificationFinalized = false;
  let postMotionVerificationBlockedUntil = 0;
  let previousCameraMotionPhase: "STABLE" | "MOVING" | "SETTLING" = "STABLE";
  let latestEvent: DetectionEvent | null = null;
  let latestV2Event: DetectionEvent | null = null;
  let captureCount = 0;
  let scenarioEndNoticeUntil = 0;
  let scenarioEndNoticeText = "";

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
      backgroundReference = storedProfiles.backgroundReference;
      backgroundFeatureTracker.setReference(backgroundReference);
      startBaselineVerification(performance.now(), "STARTUP");
      calibrationMessage = "saved profile restored";
    }
  } catch (error) {
    calibrationMessage = `profile restore failed: ${String(error)}`;
  }

  function startCalibration() {
    calibrationFrames = [];
    calibrationCameraFrames = [];
    movementClassifier.reset();
    backgroundFeatureTracker.reset();
    cameraAssessmentTracker.reset();
    baselineVerificationUntil = 0;
    baselineVerificationKind = null;
    baselineVerificationTransforms = [];
    baselineAssessment = null;
    baselineVerificationFinalized = false;
    postMotionVerificationBlockedUntil = 0;
    previousCameraMotionPhase = "STABLE";
    calibrationDeadline = performance.now() + CALIBRATION_DURATION_MS;
    calibrationMessage = "";
    calibrateButton.disabled = true;
    updateBaselineButton.disabled = true;
  }

  function startBaselineVerification(
    timestamp: number,
    kind: "STARTUP" | "POST_MOTION",
  ): void {
    if (!backgroundReference) return;
    baselineVerificationUntil = timestamp + 3000;
    baselineVerificationKind = kind;
    baselineVerificationTransforms = [];
    baselineAssessment = null;
    baselineVerificationFinalized = false;
  }

  function createCalibrationBaselineAssessment(timestamp: number): CameraAssessment {
    return {
      timestamp,
      state: "VALID",
      scaleCorrection: 0,
      offsetX: 0,
      offsetY: 0,
      reliability: 1,
      reason: ["calibration baseline established"],
      motionPhase: "STABLE",
      episodeFrameCount: 0,
      episodeUnknownFrameCount: 0,
    };
  }

  async function finishCalibration(
    frames: FrameFeature[],
    cameraFrames: CameraRawFeature[],
  ): Promise<void> {
    const nextProfile = buildUserProfile(frames);
    const nextCameraProfile = buildCameraProfile(cameraFrames);
    const nextBackgroundReference = backgroundFeatureTracker.captureReference();

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
      backgroundFeatureTracker.reset();
      cameraAssessmentTracker.reset();
      const createdAt = Date.now();
      await saveProfiles({
        userProfile: nextProfile,
        cameraProfile: nextCameraProfile,
        madProfile: nextMadProfile,
        lastCalibrationAt: createdAt,
        backgroundReference: nextBackgroundReference ?? undefined,
      });
      backgroundReference = nextBackgroundReference ?? undefined;
      backgroundFeatureTracker.setReference(backgroundReference);
      profileCreatedAt = createdAt;
      baselineVerificationUntil = 0;
      baselineVerificationKind = null;
      baselineVerificationTransforms = [];
      baselineAssessment = backgroundReference
        ? createCalibrationBaselineAssessment(createdAt)
        : null;
      baselineVerificationFinalized = Boolean(backgroundReference);
      // Give the tracker time to initialize its previous frame. The first
      // frame-to-frame jump after calibration is not a user camera movement.
      postMotionVerificationBlockedUntil = performance.now() + 2000;
      previousCameraMotionPhase = "STABLE";
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
    v0MadProfile = nextMadProfile;
    // v0 is the zero-latency baseline: alert fires the instant a rule
    // matches, no sustained-dwell delay and no motion-energy hold.
    postureDetector = new PostureRuleDetector(profile, madProfile, { sustainedSeconds: 0 });
    v2PostureDetector = new PostureRuleDetector(profile, madProfile, {
      motionEnergyGate: V2_MOTION_ENERGY_GATE,
      sustainedSeconds: 5,
    });
    v2MadUpdater = new V2MadUpdater(madProfile, { centers: nextProfile.originalCenters });
    recordButton.disabled = false;
    automatedSessionButton.disabled = false;
    madComparisonSessionButton.disabled = false;
    cameraSessionButton.disabled = false;
    cameraBoundarySessionButton.disabled = false;
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

  captureButton.onclick = () => {
    if (!previousFeature) {
      captureOutput.textContent = [
        `[capture failed: no reliable frame] (${new Date().toLocaleTimeString()})`,
        "",
        captureOutput.textContent,
      ].join("\n");
      return;
    }

    captureCount += 1;
    const header =
      `--- capture #${captureCount} (${new Date().toLocaleTimeString()}) ` +
      `v0=${latestEvent?.postureType ?? "?"} v2=${latestV2Event?.postureType ?? "?"} ---`;
    const body = formatFeatureSnapshot(previousFeature, profile, v0MadProfile, madProfile);
    captureOutput.textContent = [header, body, "", captureOutput.textContent].join("\n");
  };

  scenarioSelect.onchange = () => {
    selectedScenario = scenarioSelect.value as ScenarioLabel["label"];
    driftOnsetButton.textContent = isCameraScenario(selectedScenario)
      ? "Change onset"
      : "Drift onset";
    driftOnsetButton.disabled =
      !recorder.isRecording() || (!isDriftScenario(selectedScenario) && !isCameraScenario(selectedScenario));
  };

  scenarioStartedButton.onclick = () => {
    if (!recorder.isRecording() || scenarioActive) return;
    startScenario(selectedScenario);
  };

  driftOnsetButton.onclick = () => {
    if (
      !recorder.isRecording() ||
      !scenarioActive ||
      (!isDriftScenario(selectedScenario) && !isCameraScenario(selectedScenario))
    ) {
      return;
    }

    if (isCameraScenario(selectedScenario)) {
      markChangeOnset(selectedScenario);
    } else {
      markDriftOnset(selectedScenario);
    }
  };

  scenarioEndedButton.onclick = endScenario;

  automatedSessionButton.onclick = () =>
    toggleAutomatedSession("POSTURE", STANDARD_DEVELOPMENT_SESSION, automatedSessionButton);
  madComparisonSessionButton.onclick = () =>
    toggleAutomatedSession("MAD_COMPARISON", MAD_COMPARISON_SESSION, madComparisonSessionButton);
  cameraSessionButton.onclick = () =>
    toggleAutomatedSession("CAMERA", CAMERA_DEVELOPMENT_SESSION, cameraSessionButton);
  cameraBoundarySessionButton.onclick = startCameraBoundarySession;

  modeButton.onclick = () => {
    cameraVerificationMode = !cameraVerificationMode;
    // Camera tracking is intentionally opt-in for the normal posture view.
    // Reset its temporal state when the mode changes so a stale motion episode
    // cannot pause posture judgment after the user returns to that view.
    backgroundFeatureTracker.reset();
    cameraAssessmentTracker.reset();
    if (CAMERA_ENVIRONMENT_PIPELINE_ENABLED && cameraVerificationMode && backgroundReference) {
      startBaselineVerification(performance.now(), "STARTUP");
    } else if (!cameraVerificationMode) {
      baselineVerificationUntil = 0;
      baselineVerificationKind = null;
      baselineVerificationTransforms = [];
      baselineAssessment = null;
      baselineVerificationFinalized = false;
    }
    sidePanel.classList.toggle("camera-verification-mode", cameraVerificationMode);
    alertBannerRow.hidden = false;
    modeButton.textContent = cameraVerificationMode
      ? "Posture Mode"
      : "Camera Verification Mode";
    cameraVerificationOutput.hidden = !cameraVerificationMode;
  };

  cameraVerificationOutput.hidden = true;

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
    button.textContent = `${sessionType === "POSTURE"
      ? "Development_Posture_Session"
      : sessionType === "MAD_COMPARISON"
        ? "V0·V2 MAD 비교 세션"
        : "Development_Camera_Session"} (진행 중)`;
    if (sessionType === "MAD_COMPARISON") {
      sessionInstruction.textContent =
        "V0와 V2를 같은 프레임으로 비교합니다. 안내에 따라 각 자세를 천천히 취하고 유지해주세요.";
    }
    setManualControlsDisabled(true);
  }

  function beginRecording(sessionType: SessionType = "POSTURE"): void {
    if (recorder.isRecording()) return;

    void sessionAudio.unlock();
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
    madComparisonSessionButton.textContent = "V0·V2 MAD 비교 세션";
    cameraSessionButton.textContent = "Development_Camera_Session";
    cameraBoundarySessionButton.textContent = "카메라 경계 탐색 세션";
    scenarioStartedButton.disabled = false;
    scenarioEndedButton.disabled = false;
    driftOnsetButton.textContent = sessionType === "CAMERA" ? "Change onset" : "Drift onset";
  }

  function finishRecording(): void {
    if (!recorder.isRecording()) return;

    const wasAutomated = automatedSession !== null;
    endScenario();
    const entries = recorder.stop();
    automatedSession = null;
    cameraBoundarySession = null;
    recordButton.textContent = "측정 시작";
    automatedSessionButton.textContent = "자동 Development Session";
    lastSessionLog = toJSONL(entries);
    automatedSessionButton.textContent = "Development_Posture_Session";
    madComparisonSessionButton.textContent = "V0·V2 MAD 비교 세션";
    cameraSessionButton.textContent = "Development_Camera_Session";
    cameraBoundarySessionButton.textContent = "카메라 경계 탐색 세션";
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
    if (wasAutomated && currentSessionType === "MAD_COMPARISON") {
      const report = analyzeMADComparisonSession(entries);
      console.info("MAD comparison session analysis", report);
      developmentAnalysisSummary = formatMADComparisonReport(report);
    }
    downloadButton.disabled = entries.length === 0;
    scenarioStartedButton.disabled = true;
    driftOnsetButton.disabled = true;
    scenarioEndedButton.disabled = true;
    setManualControlsDisabled(false);
    currentSessionType = "POSTURE";
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
    driftOnsetButton.disabled = !isDriftScenario(label) && !isCameraScenario(label);
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

  function markChangeOnset(label: ScenarioLabel["label"]): void {
    if (!recorder.isRecording() || !scenarioActive || !isCameraScenario(label)) return;
    const timestamp = performance.now();
    scenarioLabeler.setLabel(timestamp, label);
    recorder.mark({ timestamp, type: "CHANGE_ONSET", label });
    driftOnsetButton.disabled = true;
  }

  function endScenario(): void {
    if (!recorder.isRecording() || !scenarioActive) return;

    const completedScenario = selectedScenario;
    const timestamp = performance.now();
    scenarioLabeler.setLabel(timestamp, "NORMAL_WORK");
    recorder.mark({
      timestamp,
      type: "SCENARIO_ENDED",
      label: selectedScenario,
    });
    scenarioActive = false;
    driftOnsetButton.disabled = true;
    scenarioEndNoticeText = `${postureScenarioNameKorean(completedScenario)} 시나리오가 끝났습니다. 정상 자세로 돌아와 주세요.`;
    scenarioEndNoticeUntil = timestamp + 1500;
    // Update the instruction in the same call that writes SCENARIO_ENDED so
    // the visible notice does not wait for the next animation-frame tick.
    sessionInstruction.textContent = scenarioEndNoticeText;
    if (isDriftScenario(completedScenario) || completedScenario === "TRANSIENT_ACTION") {
      sessionAudio.notifyReturnToNormal();
    }
  }

  function startCameraBoundarySession(): void {
    if (recorder.isRecording() || automatedSession || !profile) return;
    beginRecording("CAMERA_BOUNDARY");
    cameraBoundarySession = {
      scenarioIndex: 0,
      attempts: 0,
      phase: "MOVE",
      stableSince: null,
      measured: false,
      lower: null,
      upper: null,
      changeMarked: false,
    };
    startCameraBoundaryScenario(0);
    cameraBoundarySessionButton.textContent = "카메라 경계 탐색 세션 (진행 중)";
    setManualControlsDisabled(true);
  }

  function startCameraBoundaryScenario(index: number): void {
    const scenario = CAMERA_BOUNDARY_SCENARIOS[index];
    if (!scenario || !cameraBoundarySession) return;
    selectedScenario = scenario.label;
    scenarioSelect.value = scenario.label;
    scenarioActive = true;
    cameraBoundarySession.scenarioIndex = index;
    cameraBoundarySession.attempts = 0;
    cameraBoundarySession.phase = "MOVE";
    cameraBoundarySession.stableSince = null;
    cameraBoundarySession.measured = false;
    cameraBoundarySession.lower = null;
    cameraBoundarySession.upper = null;
    cameraBoundarySession.changeMarked = false;
    const timestamp = performance.now();
    scenarioLabeler.setLabel(timestamp, "SETTLING");
    recorder.mark({ timestamp, type: "SCENARIO_STARTED", label: scenario.label });
    sessionInstruction.textContent = [
      `카메라 경계 탐색 ${index + 1}/${CAMERA_BOUNDARY_SCENARIOS.length}: ${scenario.name}`,
      "정상 자세를 유지하세요.",
      scenario.instruction,
      "조금 움직인 뒤 움직임을 멈추고 기다리세요.",
    ].join("\n");
  }

  function processCameraBoundarySession(
    timestamp: number,
    motionPhase: NonNullable<CameraAssessment["motionPhase"]>,
    assessment: CameraAssessment,
    verificationActive: boolean,
    event: DetectionEvent | null,
  ): void {
    const session = cameraBoundarySession;
    const scenario = session ? CAMERA_BOUNDARY_SCENARIOS[session.scenarioIndex] : undefined;
    if (!session || !scenario || !recorder.isRecording()) return;

    if (motionPhase !== "STABLE") {
      if (!session.changeMarked) {
        scenarioLabeler.setLabel(timestamp, scenario.label);
        recorder.mark({ timestamp, type: "CHANGE_ONSET", label: scenario.label });
        session.changeMarked = true;
      }
      session.phase = "WAIT_STABLE";
      session.stableSince = null;
      session.measured = false;
      sessionInstruction.textContent =
        "카메라 이동 중입니다. 이동 중에는 자세 판정을 보류합니다. 움직임을 멈추고 기다리세요.";
      return;
    }

    if (session.phase === "WAIT_STABLE") {
      session.phase = "MOVE";
      session.stableSince = timestamp;
      sessionInstruction.textContent =
        "카메라가 멈췄습니다. 보정 후 자세를 확인하는 중입니다. 2초 동안 기다리세요.";
      return;
    }

    const magnitude = cameraScenarioMagnitude(scenario.label, assessment.transform);
    if (session.phase === "RETURN") {
      if (!verificationActive && assessment.state === "VALID" && magnitude < 0.025) {
        if (scenarioActive) {
          session.phase = "MOVE";
          session.measured = false;
          session.changeMarked = false;
          session.stableSince = null;
          sessionInstruction.textContent =
            "기준 위치를 확인했습니다. 안내에 따라 방금보다 조금 덜 이동하세요.";
        } else if (session.scenarioIndex + 1 >= CAMERA_BOUNDARY_SCENARIOS.length) {
          sessionInstruction.textContent = "모든 카메라 변화 시나리오를 완료했습니다. 세션을 종료합니다.";
          finishRecording();
        } else {
          startCameraBoundaryScenario(session.scenarioIndex + 1);
        }
      } else {
        sessionInstruction.textContent =
          "Calibration 당시의 기준 위치로 돌아간 뒤, 움직임을 멈춰주세요.";
      }
      return;
    }

    if (session.phase !== "MOVE" || session.measured || verificationActive) return;
    if (!session.changeMarked) {
      session.stableSince = null;
      sessionInstruction.textContent = [
        `${scenario.name} 시나리오입니다.`,
        scenario.instruction,
        "조금 움직이세요. 실제 움직임이 감지되면 측정을 시작합니다.",
      ].join("\n");
      return;
    }
    if (session.stableSince === null) {
      session.stableSince = timestamp;
      sessionInstruction.textContent =
        "이제 안내된 방향으로 카메라를 조금 움직인 뒤, 움직임을 멈추세요.";
      return;
    }
    if (timestamp - session.stableSince < CAMERA_BOUNDARY_SETTLE_MS) {
      sessionInstruction.textContent = "움직임이 끝났습니다. 카메라를 그대로 두고 2초 동안 기다리세요.";
      return;
    }
    if (assessment.state === "UNKNOWN" || !assessment.transform) {
      sessionInstruction.textContent =
        "배경 특징점을 충분히 추적하지 못했습니다. 카메라를 가리지 말고 잠시 기다리세요.";
      return;
    }

    session.measured = true;
    session.attempts += 1;
    const postureAlert = event?.alert ?? false;
    const correctionSucceeded =
      (assessment.state === "VALID" || assessment.state === "ADJUSTED") && !postureAlert;
    if (correctionSucceeded) session.lower = magnitude;
    else session.upper = magnitude;

    const hasBracket = session.lower !== null && session.upper !== null;
    const bracketWidth = hasBracket ? Math.abs(session.upper! - session.lower!) : Infinity;
    const finishScenario = assessment.state === "RECALIBRATION_REQUIRED" ||
      (hasBracket && bracketWidth <= CAMERA_BOUNDARY_PRECISION) ||
      session.attempts >= CAMERA_BOUNDARY_MAX_ATTEMPTS;
    if (finishScenario) {
      recorder.mark({ timestamp, type: "SCENARIO_ENDED", label: scenario.label });
      scenarioActive = false;
      session.phase = "RETURN";
      session.measured = false;
      sessionInstruction.textContent = assessment.state === "RECALIBRATION_REQUIRED"
        ? "재측정 필요 범위에 도달했습니다. 기준 위치로 돌아가세요."
        : "이 시나리오의 경계 측정을 마쳤습니다. 기준 위치로 돌아가세요.";
      if (session.scenarioIndex + 1 >= CAMERA_BOUNDARY_SCENARIOS.length) {
        sessionInstruction.textContent += " 모든 시나리오가 끝나면 세션을 종료하세요.";
      }
      return;
    }

    session.phase = postureAlert ? "RETURN" : "MOVE";
    session.measured = false;
    session.stableSince = null;
    if (!postureAlert) session.changeMarked = false;
    sessionInstruction.textContent = postureAlert
      ? "보정 후에도 잘못된 자세로 판정되었습니다. 기준 위치로 돌아간 뒤 방금보다 조금 덜 이동하세요."
      : "보정 후 정상 자세로 돌아왔습니다. 같은 방향으로 조금 더 이동하세요.";
  }

  function cameraScenarioMagnitude(
    label: ScenarioLabel["label"],
    transform: CameraTransform | undefined,
  ): number {
    if (!transform) return 0;
    switch (label) {
      case "CAMERA_TRANSLATION_X": return Math.abs(transform.translationX);
      case "CAMERA_TRANSLATION_Y": return Math.abs(transform.translationY);
      case "CAMERA_ROLL": return Math.abs(transform.roll);
      case "CAMERA_YAW_LEFT":
      case "CAMERA_YAW_RIGHT": return Math.abs(transform.yawProxy ?? 0);
      case "CAMERA_PITCH_UP":
      case "CAMERA_PITCH_DOWN": return Math.abs(transform.pitchProxy ?? 0);
      case "CAMERA_SCALE": return Math.abs(transform.scale);
      default: return Math.max(
        Math.abs(transform.translationX),
        Math.abs(transform.translationY),
        Math.abs(transform.scale),
        Math.abs(transform.roll),
      );
    }
  }

  function setManualControlsDisabled(disabled: boolean): void {
    scenarioSelect.disabled = disabled;
    scenarioStartedButton.disabled = disabled || !recorder.isRecording();
    driftOnsetButton.disabled = true;
    scenarioEndedButton.disabled = disabled || !recorder.isRecording();
    automatedSessionButton.disabled = disabled || !profile;
    madComparisonSessionButton.disabled = disabled || !profile;
    cameraSessionButton.disabled = disabled || !profile;
    cameraBoundarySessionButton.disabled = disabled || !profile;
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
      if (action === "CHANGE_ONSET" && label) markChangeOnset(label);
      if (action === "SCENARIO_ENDED") endScenario();
      if (action === "SESSION_ENDED") finishRecording();
    }
  }

  function updateSessionInstruction(timestamp: number): void {
    if (!automatedSession) return;

    if (timestamp < scenarioEndNoticeUntil) {
      sessionInstruction.textContent = scenarioEndNoticeText;
      return;
    }

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
      if (isCameraScenario(currentStep.label)) {
        sessionInstruction.textContent =
          cameraInstruction(currentStep.label);
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

    if (currentStep.action === "CHANGE_ONSET" && currentStep.label) {
      sessionInstruction.textContent =
        `NOW: ${cameraInstruction(currentStep.label)} Start the camera movement now and keep it steady when finished.`;
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

  thresholdSweepButton.onclick = () => thresholdFileInput.click();
  thresholdFileInput.onchange = async () => {
    const file = thresholdFileInput.files?.[0];
    if (!file) return;

    thresholdSweepOutput.textContent = "threshold sweep running...";
    try {
      const entries = parseJSONL(await file.text());
      const report = sweepPostureThresholds(entries);
      thresholdSweepOutput.textContent = [
        `file: ${file.name}`,
        `candidates: ${report.candidates.length}`,
        formatPostureThresholdSweep(report),
        "",
        ...report.notes,
      ].join("\n");
      console.info("Posture threshold sweep", report);
    } catch (error) {
      thresholdSweepOutput.textContent = `threshold sweep failed: ${String(error)}`;
    } finally {
      thresholdFileInput.value = "";
    }
  };

  cameraUploadButton.onclick = () => cameraFileInput.click();
  cameraFileInput.onchange = async () => {
    const file = cameraFileInput.files?.[0];
    if (!file) return;
    cameraVerificationOutput.textContent = "camera verification running...";
    try {
      const entries = parseJSONL(await file.text());
      const sessionType = entries.find((entry) => entry.metadata)?.metadata?.sessionType;
      if (sessionType === "CAMERA_BOUNDARY") {
        const report = analyzeCameraBoundarySession(entries);
        cameraVerificationOutput.textContent = [
          `파일: ${file.name}`,
          formatCameraBoundaryMetrics(report),
        ].join("\n");
        console.info("Camera boundary verification", report);
      } else {
        const report = analyzeCameraVerificationSession(entries);
        cameraVerificationOutput.textContent = [
          `파일: ${file.name}`,
          formatCameraVerificationMetrics(report),
        ].join("\n");
        console.info("Camera verification", report);
      }
    } catch (error) {
      cameraVerificationOutput.textContent = `camera verification failed: ${String(error)}`;
    } finally {
      cameraFileInput.value = "";
    }
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
      backgroundFeatureTracker.reset();
      cameraAssessmentTracker.reset();
      status.textContent = `state: ${describeUnreliableState(quality)}\n${JSON.stringify(quality, null, 2)}`;
      setAlertBanner(v0AlertBanner, "unknown", `V0: ${describeUnreliableState(quality)}`);
      setAlertBanner(v2AlertBanner, "unknown", `V2: ${describeUnreliableState(quality)}`);
      requestAnimationFrame(loop);
      return;
    }

    drawSkeleton(ctx, landmarks, canvas.width, canvas.height);
    const handResult = detectHandsForVideoFrame(handLandmarker, video, timestamp);

    const cameraTrackingEnabled = CAMERA_ENVIRONMENT_PIPELINE_ENABLED &&
      (cameraVerificationMode || currentSessionType !== "POSTURE");
    const cameraTransform = cameraTrackingEnabled
      ? backgroundFeatureTracker.update(video, timestamp)
      : null;
    const liveCameraAssessment = cameraTrackingEnabled
      ? cameraAssessmentTracker.update(cameraTransform, timestamp)
      : createPostureModeCameraAssessment(timestamp);
    const currentMotionPhase = liveCameraAssessment.motionPhase ?? "STABLE";
    if (
      previousCameraMotionPhase !== "STABLE" &&
      currentMotionPhase === "STABLE" &&
      baselineVerificationFinalized &&
      timestamp >= postMotionVerificationBlockedUntil &&
      liveCameraAssessment.state !== "UNKNOWN"
    ) {
      startBaselineVerification(timestamp, "POST_MOTION");
    }
    previousCameraMotionPhase = currentMotionPhase;

    const verificationActive = cameraTrackingEnabled &&
      baselineVerificationUntil > 0 &&
      timestamp <= baselineVerificationUntil;
    const referenceTransform = verificationActive
      ? backgroundFeatureTracker.compareReference(video, timestamp)
      : null;
    if (referenceTransform) baselineVerificationTransforms.push(referenceTransform);
    if (
      baselineVerificationUntil > 0 &&
      !baselineVerificationFinalized &&
      timestamp > baselineVerificationUntil
    ) {
      baselineAssessment = assessCameraTransform(
        baselineVerificationTransforms.length > 0
          ? aggregateCameraTransforms(baselineVerificationTransforms)
          : null,
      );
      if (
        baselineVerificationKind === "POST_MOTION" &&
        baselineVerificationTransforms.length === 0 &&
        (liveCameraAssessment.episodeFrameCount ?? 0) > 0
      ) {
        baselineAssessment = {
          ...baselineAssessment,
          state: "RECALIBRATION_REQUIRED",
          reason: ["calibration background no longer matches the current view"],
          motionPhase: "STABLE",
          episodeFrameCount: liveCameraAssessment.episodeFrameCount,
          episodeUnknownFrameCount: liveCameraAssessment.episodeUnknownFrameCount,
        };
      }
      baselineVerificationFinalized = true;
      baselineVerificationUntil = 0;
    }

    const referenceAssessment = referenceTransform
      ? assessCameraTransform(referenceTransform)
      : null;
    const selectedAssessment = baselineAssessment ?? referenceAssessment ?? liveCameraAssessment;
    const cameraAssessment: CameraAssessment = {
      ...selectedAssessment,
      motionPhase: currentMotionPhase,
      episodeFrameCount: liveCameraAssessment.episodeFrameCount,
      episodeUnknownFrameCount: liveCameraAssessment.episodeUnknownFrameCount,
      qualityStatus: liveCameraAssessment.qualityStatus,
      qualityRecoveryFrames: liveCameraAssessment.qualityRecoveryFrames,
      // The calibration baseline assessment intentionally has no transform.
      // Keep the current live transform available for the boundary session
      // and status panel while retaining the baseline state judgment.
      transform: selectedAssessment.transform ?? cameraTransform ?? undefined,
    };

    // Only an explicitly classified ADJUSTED camera state is safe to correct.
    // UNKNOWN and RECALIBRATION_REQUIRED must not feed distorted landmarks
    // into posture rules; the banners below pause those judgments instead.
    const correctionTransform =
      CAMERA_ENVIRONMENT_PIPELINE_ENABLED &&
      !calibrationFrames &&
      cameraAssessment.state === "ADJUSTED" &&
      cameraAssessment.qualityStatus === "OK"
        ? cameraAssessment.transform
        : undefined;
    const correctedLandmarks = correctionTransform
      ? applyCameraCorrectionToLandmarks(landmarks, correctionTransform)
      : landmarks;
    const correctedHands = correctionTransform
      ? applyCameraCorrectionToHandLandmarks(handResult.landmarks, correctionTransform)
      : handResult.landmarks;
    const feature = toFrameFeature(
      correctedLandmarks,
      timestamp,
      previousFeature,
      correctedHands,
    );
    previousFeature = feature;

    if (!feature) {
      movementClassifier.reset();
      setAlertBanner(v0AlertBanner, "unknown", "V0: UNKNOWN");
      setAlertBanner(v2AlertBanner, "unknown", "V2: UNKNOWN");
      requestAnimationFrame(loop);
      return;
    }

    const backgroundMotion = cameraTransform
      ? Math.hypot(cameraTransform.translationX, cameraTransform.translationY) +
        Math.abs(cameraTransform.scale) + Math.abs(cameraTransform.roll)
      : 0;
    feature.backgroundMotion = backgroundMotion;
    feature.backgroundTransformConfidence = cameraTransform?.confidence ?? 0;
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
      if (currentSessionType === "POSTURE" || currentSessionType === "MAD_COMPARISON") {
        madProfile = v2MadUpdater.update(feature, {
          landmarkQuality: quality,
          matchedPosture: v2Event?.postureType,
        });
      }
      v2PostureDetector?.setMADProfile(madProfile);
      if (recorder.isRecording()) {
        const comparison = currentSessionType === "MAD_COMPARISON" && event && v2Event
          ? {
            v0PostureEvent: event,
            v2PostureEvent: v2Event,
            madUpdateCount: madProfile.updateCount,
          }
          : null;
        recorder.record(
          feature,
          scenarioLabeler.getCurrentLabel(),
          cameraAssessment.state,
          cameraAssessment.transform ?? cameraTransform,
          cameraAssessment,
          event,
          comparison,
        );
      }
    }
    if (CAMERA_ENVIRONMENT_PIPELINE_ENABLED) {
      processCameraBoundarySession(
        timestamp,
        currentMotionPhase,
        cameraAssessment,
        verificationActive,
        event,
      );
    }
    latestEvent = event;
    latestV2Event = v2Event;
    const cameraStateKind = cameraAssessment.state === "RECALIBRATION_REQUIRED"
      ? "bad"
      : cameraAssessment.state === "UNKNOWN"
        ? "unknown"
        : "good";

    if (!postureDetector) {
      setAlertBanner(v0AlertBanner, "idle", "V0: 캘리브레이션 후 측정을 시작하세요");
      setAlertBanner(v2AlertBanner, "idle", "V2: 캘리브레이션 후 측정을 시작하세요");
    } else if (cameraAssessment.state === "RECALIBRATION_REQUIRED") {
      setAlertBanner(v0AlertBanner, "bad", "Camera recalibration required");
      setAlertBanner(v2AlertBanner, "bad", "Camera recalibration required");
    } else if (
      verificationActive ||
      currentMotionPhase !== "STABLE" ||
      cameraAssessment.state === "UNKNOWN" ||
      cameraAssessment.qualityStatus !== "OK"
    ) {
      setAlertBanner(v0AlertBanner, "idle", "Camera movement: posture judgment paused");
      setAlertBanner(v2AlertBanner, "idle", "Camera movement: posture judgment paused");
    } else if (!cameraVerificationMode) {
      // V0/V2 are judged and shown independently — they can (and are
      // expected to) disagree, that's the whole point of comparing them.
      if (event?.alert) {
        setAlertBanner(v0AlertBanner, "bad", `V0: ${describeMatchedFeatures(event)}`);
      } else {
        setAlertBanner(v0AlertBanner, "good", "V0: 정상 자세입니다");
      }

      if (v2Event?.alert) {
        setAlertBanner(v2AlertBanner, "bad", `V2: ${describeMatchedFeatures(v2Event)}`);
      } else if (v2Event?.state === "MOVING") {
        // Motion-energy hold: v2's judgment is deliberately paused while
        // sustained movement is detected (see posture-rule-detector's
        // motionEnergyGate), not a "you're fine" result — showing it as
        // "정상" here would misreport a held-but-unevaluated frame as a
        // confirmed normal posture.
        setAlertBanner(v2AlertBanner, "unknown", "V2: 판단 보류 중 (움직임 감지)");
      } else {
        setAlertBanner(v2AlertBanner, "good", "V2: 정상 자세입니다");
      }
    } else {
      const baselineReferenceStatus = verificationActive
        ? `${baselineVerificationKind === "POST_MOTION" ? "post-motion" : "startup"} active`
        : baselineAssessment
          ? baselineVerificationKind
            ? `${baselineVerificationKind === "POST_MOTION" ? "post-motion" : "startup"} complete`
            : "calibration ready"
          : backgroundReference
            ? "not started"
            : "unavailable";
      setAlertBanner(
        v0AlertBanner,
        "idle",
        `Camera baseline verification: ${baselineReferenceStatus}`,
      );
      setAlertBanner(
        v2AlertBanner,
        cameraStateKind,
        `Camera state: ${cameraAssessment.state} (${cameraAssessment.motionPhase ?? "STABLE"})`,
      );
    }

    const displayedCameraTransform = baselineAssessment?.transform ?? referenceTransform ?? cameraTransform;
    const cameraStatus = [
      `camera verification: ${cameraVerificationMode ? "ON" : "off"}`,
      cameraProfile ? "camera profile: saved" : "camera profile: not calibrated",
      `camera state: ${cameraAssessment.state}`,
      `camera adjustment range: ${describeCameraAdjustmentRange(cameraAssessment.state)}`,
      `camera correction: ${correctionTransform ? "active" : "inactive"}`,
      `camera motion phase: ${cameraAssessment.motionPhase ?? "STABLE"}`,
      (cameraAssessment.motionPhase ?? "STABLE") !== "STABLE"
        ? "camera judgment: PAUSED until movement settles"
        : "camera judgment: active",
      cameraAssessment.episodeFrameCount !== undefined
        ? `episode frames: ${cameraAssessment.episodeFrameCount} (unknown ${cameraAssessment.episodeUnknownFrameCount ?? 0})`
        : "",
      `camera reliability: ${cameraAssessment.reliability.toFixed(2)}`,
      `tracking quality: ${cameraAssessment.qualityStatus ?? "OK"}`,
      cameraAssessment.qualityRecoveryFrames !== undefined && cameraAssessment.qualityStatus === "RECOVERING"
        ? `quality recovery: ${cameraAssessment.qualityRecoveryFrames}/5`
        : "",
      displayedCameraTransform ? `background points: ${displayedCameraTransform.trackedPointCount}` : "background points: waiting",
      displayedCameraTransform ? `inlier ratio: ${displayedCameraTransform.inlierRatio.toFixed(2)}` : "",
      displayedCameraTransform ? `reprojection error: ${displayedCameraTransform.reprojectionError.toFixed(2)}px` : "",
      displayedCameraTransform ? `translation: x=${displayedCameraTransform.translationX.toFixed(3)}, y=${displayedCameraTransform.translationY.toFixed(3)}` : "",
      displayedCameraTransform ? `scale delta: ${(displayedCameraTransform.scale * 100).toFixed(1)}%` : "",
      displayedCameraTransform ? `roll: ${(displayedCameraTransform.roll * 180 / Math.PI).toFixed(1)}deg` : "",
      displayedCameraTransform?.yawProxy !== undefined ? `yaw proxy: ${displayedCameraTransform.yawProxy.toFixed(4)}` : "",
      displayedCameraTransform?.pitchProxy !== undefined ? `pitch proxy: ${displayedCameraTransform.pitchProxy.toFixed(4)}` : "",
      `keyframe tracking: ${cameraTransform?.keyframeTransform ? "active" : "waiting"}`,
      cameraTransform?.keyframeTransform
        ? `keyframe delta: x=${cameraTransform.keyframeTransform.translationX.toFixed(3)}, y=${cameraTransform.keyframeTransform.translationY.toFixed(3)}, scale=${(cameraTransform.keyframeTransform.scale * 100).toFixed(1)}%`
        : "",
      verificationActive
        ? `baseline comparison: ${baselineVerificationKind?.toLowerCase() ?? "active"}`
        : baselineAssessment
          ? baselineVerificationKind
            ? `baseline comparison: ${baselineVerificationKind.toLowerCase()} complete`
            : "baseline comparison: calibration ready"
          : "",
      cameraAssessment.reason?.length ? `reason: ${cameraAssessment.reason.join(", ")}` : "",
    ].filter((line) => line.length > 0).join("\n");
    const postureStatus = [
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
      `background motion: ${backgroundMotion.toFixed(3)}`,
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
    status.textContent = cameraVerificationMode ? cameraStatus : postureStatus;

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

function createPostureModeCameraAssessment(timestamp: number): CameraAssessment {
  return {
    timestamp,
    state: "VALID",
    scaleCorrection: 0,
    offsetX: 0,
    offsetY: 0,
    reliability: 1,
    reason: ["camera movement detection disabled in posture mode"],
    motionPhase: "STABLE",
    qualityStatus: "OK",
    qualityRecoveryFrames: 0,
  };
}

function formatScore(score: number | undefined): string {
  return score === undefined ? "?" : score.toFixed(2);
}

function describeCameraAdjustmentRange(state: CameraAssessment["state"]): string {
  if (state === "VALID") return "no adjustment needed";
  if (state === "ADJUSTED") return "correction available";
  return "remeasurement required";
}

function aggregateCameraTransforms(transforms: readonly CameraTransform[]): CameraTransform {
  const latest = transforms[transforms.length - 1];
  return {
    timestamp: latest.timestamp,
    translationX: medianNumber(transforms.map((transform) => transform.translationX)),
    translationY: medianNumber(transforms.map((transform) => transform.translationY)),
    scale: medianNumber(transforms.map((transform) => transform.scale)),
    roll: medianNumber(transforms.map((transform) => transform.roll)),
    yawProxy: medianNumber(transforms.map((transform) => transform.yawProxy ?? 0)),
    pitchProxy: medianNumber(transforms.map((transform) => transform.pitchProxy ?? 0)),
    affine: latest.affine
      ? {
          a: medianNumber(transforms.map((transform) => transform.affine?.a ?? latest.affine!.a)),
          b: medianNumber(transforms.map((transform) => transform.affine?.b ?? latest.affine!.b)),
          c: medianNumber(transforms.map((transform) => transform.affine?.c ?? latest.affine!.c)),
          d: medianNumber(transforms.map((transform) => transform.affine?.d ?? latest.affine!.d)),
          e: medianNumber(transforms.map((transform) => transform.affine?.e ?? latest.affine!.e)),
          f: medianNumber(transforms.map((transform) => transform.affine?.f ?? latest.affine!.f)),
        }
      : undefined,
    inlierRatio: medianNumber(transforms.map((transform) => transform.inlierRatio)),
    reprojectionError: medianNumber(transforms.map((transform) => transform.reprojectionError)),
    trackedPointCount: Math.round(medianNumber(transforms.map((transform) => transform.trackedPointCount))),
    confidence: medianNumber(transforms.map((transform) => transform.confidence)),
    source: "BACKGROUND_FEATURES",
  };
}

function medianNumber(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

// Lists every numeric FrameFeature value at capture time, alongside the
// calibration-relative MAD score ((value - center) / MAD) the rule engine
// actually checks — so a captured posture can be read off directly against
// posture-rules/index.ts's thresholds instead of re-deriving it by hand.
//
// v0 and v2 can score the *same* feature differently: v0 never gets
// setMADProfile calls (frozen at calibration), while v2's MAD profile keeps
// adapting during stable windows. Take both and show only one score when
// they agree, or both labeled when they've diverged — otherwise this panel
// silently shows v2's basis for both, which can make v0's actual match/no-
// match decision look inexplicable (confirmed live: a captured
// faceToShoulderRatio score of 0.64 looked like it should fail FORWARD_HEAD's
// 0.8 threshold, yet v0 had matched — v0's real, frozen-MAD score was above
// 0.8, this panel was just showing v2's drifted one).
function formatFeatureSnapshot(
  feature: FrameFeature,
  profile: UserProfile | null,
  v0MadProfile: MADProfile,
  v2MadProfile: MADProfile,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(feature)) {
    if (typeof value !== "number" || key === "timestamp") continue;
    const featureName = key as PostureFeatureName;
    const center = profile?.originalCenters[featureName];
    const v0Score = normalizeFeature(value, center, v0MadProfile.values[featureName]);
    const v2Score = normalizeFeature(value, center, v2MadProfile.values[featureName]);
    // Some rule conditions (e.g. CHIN_REST's handFaceDistance) use
    // reference: "ABSOLUTE" (center 0) instead of CALIBRATION, which the
    // scores above don't reflect. Show it whenever the calibration center
    // isn't set, so what's on screen matches what that condition actually
    // sees. v0/v2 use the same MAD basis for this so one value is enough.
    const absoluteScore =
      v0Score === undefined ? normalizeFeature(value, 0, v0MadProfile.values[featureName]) : undefined;
    const scoresDiffer =
      v0Score !== undefined && v2Score !== undefined && Math.abs(v0Score - v2Score) > 0.01;
    lines.push(
      `${key}: ${value.toFixed(3)}` +
        (scoresDiffer
          ? `  (v0 score=${v0Score.toFixed(2)}, v2 score=${(v2Score as number).toFixed(2)})`
          : v0Score !== undefined
            ? `  (score=${v0Score.toFixed(2)})`
            : "") +
        (absoluteScore !== undefined ? `  (abs=${absoluteScore.toFixed(2)})` : ""),
    );
  }
  return lines.join("\n");
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

    .threshold-sweep-output {
      box-sizing: border-box;
      width: 100%;
      max-height: 360px;
      margin: 12px 0 0;
      padding: 12px;
      overflow: auto;
      white-space: pre;
      font: 11px/1.45 monospace;
      background: #111827;
      color: #e5e7eb;
    }

    .capture-output {
      box-sizing: border-box;
      width: 100%;
      max-height: 320px;
      margin: 12px 0 0;
      padding: 12px;
      overflow: auto;
      white-space: pre-wrap;
      font: 11px/1.45 monospace;
      background: #0f172a;
      color: #e2e8f0;
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
    label === "HEAD_DOWN" ||
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
    label === "SHOULDERS_ONLY_TWIST" ||
    label === "ARMREST_LEAN";
}

function isCameraScenario(label: ScenarioLabel["label"]): boolean {
  return label === "CAMERA_CHANGE" ||
    label === "CAMERA_TRANSLATION_X" ||
    label === "CAMERA_TRANSLATION_Y" ||
    label === "CAMERA_ROLL" ||
    label === "CAMERA_YAW_LEFT" ||
    label === "CAMERA_YAW_RIGHT" ||
    label === "CAMERA_PITCH_UP" ||
    label === "CAMERA_PITCH_DOWN" ||
    label === "CAMERA_SCALE" ||
    label === "CAMERA_RETURN";
}

function cameraInstruction(label: ScenarioLabel["label"]): string {
  const instructions: Partial<Record<ScenarioLabel["label"], string>> = {
    CAMERA_TRANSLATION_X: "Keep laptop height and screen angle fixed, then move the laptop left or right.",
    CAMERA_TRANSLATION_Y: "Keep screen angle fixed, then move the laptop camera vertically while keeping posture stable.",
    CAMERA_ROLL: "Keep laptop height fixed, then rotate the screen left/right around its center. Keep your posture stable.",
    CAMERA_YAW_LEFT: "Keep the laptop in the same place and rotate it so the camera points to the user's left. Keep your posture stable.",
    CAMERA_YAW_RIGHT: "Keep the laptop in the same place and rotate it so the camera points to the user's right. Keep your posture stable.",
    CAMERA_PITCH_UP: "Keep laptop position fixed, then tilt the screen upward. Keep your posture stable.",
    CAMERA_PITCH_DOWN: "Keep laptop position fixed, then tilt the screen downward. Keep your posture stable.",
    CAMERA_SCALE: "Move the laptop closer or farther without changing your posture.",
    CAMERA_RETURN: "Return the laptop to the original calibrated position.",
    CAMERA_CHANGE: "Change the camera environment while keeping your posture stable.",
  };
  return instructions[label] ?? "Keep your posture stable and follow the camera instruction.";
}

function scenarioName(label: ScenarioLabel["label"]): string {
  const names: Partial<Record<ScenarioLabel["label"], string>> = {
    FORWARD_LEAN: "앞으로 숙이는",
    FORWARD_HEAD: "거북목",
    HEAD_DOWN: "고개를 숙이는",
    LEFT_LEAN: "왼쪽으로 기울이는",
    RIGHT_LEAN: "오른쪽으로 기울이는",
    SIDE_SHIFT: "좌우로 이동하는",
    HEAD_TURN: "고개를 돌리는",
    CLOSE_TO_CAMERA: "카메라에 가까이 가는",
  };
  return names[label] ?? label;
}

function postureScenarioNameKorean(label: ScenarioLabel["label"]): string {
  const names: Partial<Record<ScenarioLabel["label"], string>> = {
    FORWARD_HEAD: "거북목",
    HEAD_DOWN: "고개 숙이기",
    FORWARD_LEAN: "상체 앞으로 숙이기",
    BACKWARD_LEAN: "상체 뒤로 기대기",
    HEAD_TILT: "고개 갸우뚱하기",
    CHIN_REST: "턱 괴기",
    HEAD_BACK: "고개 뒤로 젖히기",
    SHOULDER_ASYMMETRY: "어깨 비대칭",
    TORSO_TWIST: "상체 비틀기",
    ARMREST_LEAN: "팔걸이에 기대기",
    HEAD_TURN: "고개 돌리기",
    TRANSIENT_ACTION: "자연 행동",
    NORMAL_WORK: "정상 작업",
  };
  return names[label] ?? label;
}

main().catch((error) => {
  console.error("PostureCore failed to start", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app) app.textContent = `Failed to start: ${String(error)}`;
});
