import { startWebcam } from "../camera-adapter/webcam";
import {
  anchorFromLandmarks,
  createPoseLandmarker,
  detectPoseForVideoFrame,
  selectPrimaryLandmarks,
  type PersonAnchor,
} from "../camera-adapter/pose-landmarker";
import {
  createHandLandmarker,
  detectHandsForVideoFrame,
} from "../camera-adapter/hand-landmarker";
import { drawVideoFrame } from "../canvas-overlay/skeleton-overlay";
import { toFrameFeature } from "../../core/feature-normalizer";
import { buildCameraProfile, toCameraRawFeature } from "../../core/camera-profile";
import { assessLandmarkQuality, describeUnreliableState } from "../../core/landmark-reliability";
import { buildUserProfile } from "../../core/profile-builder";
import { createInitialMADProfile } from "../../core/mad-profile";
import { PostureRuleDetector } from "../../core/posture-rule-detector";
import { V2MadUpdater } from "../../core/v2-mad-updater";
import { generateFeedback } from "../../core/feedback-generator";
import { loadProfiles, saveProfiles } from "../indexeddb-storage";
import { SessionAudioNotifier } from "../session-audio";
import { CalibrationFlow } from "../ui/calibration-flow";
import { FairyWidget } from "../ui/fairy-widget";
import {
  describePersonRecoveredDetail,
  describePersonRecoveredLabel,
  describePostureDetail,
  describePostureLabel,
  describePresenceDetail,
  describePresenceLabel,
} from "../ui/posture-copy";
import type {
  CameraProfile,
  CameraRawFeature,
  DetectionEvent,
  FrameFeature,
  UserProfile,
} from "../../core/types";

// Collect ~5s / 10+ frames of "바른 자세" before treating it as the
// baseline — mirrors CALIBRATION_DURATION_MS / MIN_CALIBRATION_FRAMES in
// the dev harness (src/web/app/main.ts) so both entry points calibrate
// the same way.
const CALIBRATION_DURATION_MS = 5000;
const MIN_CALIBRATION_FRAMES = 10;

// How long a posture must stay "alerted" before the fairy interrupts —
// avoids nagging on a single bad frame or a brief stretch/reach.
const FAIRY_TRIGGER_DELAY_MS = 2500;
// Don't re-show the fairy more often than this even if the person stays
// slouched the whole time.
const FAIRY_RETRIGGER_COOLDOWN_MS = 15000;

// Flip to true once the team decides the fairy should name the specific
// issue (거북목 / 어깨 기울어짐 등) rather than a gentle generic nudge.
// generateFeedback() already produces the specific Korean phrase per
// dominant feature (src/core/feedback-generator) — this only toggles
// whether product-main shows it.
const SHOW_SPECIFIC_POSTURE_LABEL = true;

async function main() {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  // ---- static chrome -----------------------------------------------
  const brand = document.createElement("div");
  brand.className = "brand";
  brand.innerHTML = `<span class="brand__dot"></span> 요정`;

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "settings-btn";
  settingsBtn.textContent = "⟳";
  settingsBtn.title = "다시 캘리브레이션";

  const stage = document.createElement("div");
  stage.className = "camera-stage";

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.style.display = "none";

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;

  const ring = document.createElement("div");
  ring.className = "camera-stage__ring camera-stage__ring--idle";

  const hint = document.createElement("div");
  hint.className = "camera-stage__hint";
  hint.textContent = "카메라를 준비하고 있어요...";

  stage.append(canvas, ring, hint);

  const statusPill = document.createElement("div");
  statusPill.className = "status-pill status-pill--idle";
  const statusDot = document.createElement("span");
  statusDot.className = "status-pill__dot";
  const statusText = document.createElement("span");
  statusText.textContent = "카메라 준비 중";
  statusPill.append(statusDot, statusText);

  const statusSub = document.createElement("div");
  statusSub.className = "status-sub";

  const calibSlot = document.createElement("div");

  app.append(brand, settingsBtn, stage, calibSlot, statusPill, statusSub);

  const ctxOrNull = canvas.getContext("2d");
  if (!ctxOrNull) return;
  const ctx = ctxOrNull;

  const fairy = new FairyWidget(document.body);
  const sessionAudio = new SessionAudioNotifier();
  const calibration = new CalibrationFlow(calibSlot);

  function setStatus(kind: "idle" | "good" | "bad" | "hold", text: string, sub = ""): void {
    statusPill.className = `status-pill status-pill--${kind}`;
    statusText.textContent = text;
    statusSub.textContent = sub;
    ring.className = `camera-stage__ring camera-stage__ring--${
      kind === "bad" ? "bad" : kind === "good" ? "good" : "idle"
    }`;
  }

  function showCalibrationUI(): void {
    statusPill.style.display = "none";
    statusSub.style.display = "none";
  }

  function hideCalibrationUI(): void {
    calibration.unmount();
    statusPill.style.display = "";
    statusSub.style.display = "";
  }

  // ---- camera + model bootstrap -------------------------------------
  try {
    await startWebcam(video);
  } catch (error) {
    hint.textContent = "카메라 권한이 필요해요. 브라우저 설정에서 카메라 접근을 허용해주세요.";
    console.error("camera permission failed", error);
    return;
  }

  hint.textContent = "자세 인식 모델을 불러오고 있어요...";
  const landmarker = await createPoseLandmarker();
  const handLandmarker = await createHandLandmarker();
  hint.remove();

  // Live camera preview: draws every frame independently of calibration /
  // detection state, so the camera is visibly on during the calibration
  // instructions and frame-collection steps too, not just once the main
  // detection loop starts. (Previously the canvas only got drawn to from
  // inside loop() below, so it stayed black through all of calibration.)
  function previewTick(): void {
    drawVideoFrame(ctx, video, canvas.width, canvas.height);
    requestAnimationFrame(previewTick);
  }
  requestAnimationFrame(previewTick);

  let profile: UserProfile | null = null;
  let cameraProfile: CameraProfile | null = null;
  let madProfile = createInitialMADProfile();
  let detector: PostureRuleDetector | null = null;
  let madUpdater = new V2MadUpdater(madProfile);
  // Where the calibrated user's shoulders were last seen — re-seeded from
  // the camera profile's calibration median below, so tracking starts
  // correct from loop()'s very first frame instead of trusting whichever
  // pose happens to rank first that frame.
  let trackedAnchor: PersonAnchor | null = null;

  function activateProfile(
    nextProfile: UserProfile,
    nextCameraProfile: CameraProfile,
  ): void {
    profile = nextProfile;
    cameraProfile = nextCameraProfile;
    madProfile = createInitialMADProfile({ now: Date.now() });
    detector = new PostureRuleDetector(profile, madProfile);
    madUpdater = new V2MadUpdater(madProfile, { centers: nextProfile.originalCenters });
    trackedAnchor = { x: nextCameraProfile.shoulderCenterX, y: nextCameraProfile.shoulderCenterY };
  }

  // ---- calibration ----------------------------------------------------
  function runCalibration(): void {
    showCalibrationUI();
    calibration.runInstructions(() => collectCalibrationFrames());
  }

  function collectCalibrationFrames(): void {
    calibration.showCollecting();
    setStatus("idle", "측정 중이에요", "그대로 자세를 유지해주세요");

    const frames: FrameFeature[] = [];
    const cameraFrames: CameraRawFeature[] = [];
    const deadline = performance.now() + CALIBRATION_DURATION_MS;
    let previousFeature: FrameFeature | null = null;
    // Locks onto one body for the whole calibration window (see
    // selectPrimaryLandmarks) so someone walking through the background
    // mid-calibration can't contaminate the baseline.
    let calibrationAnchor: PersonAnchor | null = null;

    const tick = () => {
      const timestamp = performance.now();
      const result = detectPoseForVideoFrame(landmarker, video, timestamp);
      const landmarks = selectPrimaryLandmarks(result, calibrationAnchor);
      const quality = assessLandmarkQuality(landmarks, timestamp);

      if (quality.reliable && landmarks) {
        calibrationAnchor = anchorFromLandmarks(landmarks) ?? calibrationAnchor;
        const handResult = detectHandsForVideoFrame(handLandmarker, video, timestamp);
        const feature = toFrameFeature(landmarks, timestamp, previousFeature, handResult.landmarks);
        previousFeature = feature;
        if (feature) {
          frames.push(feature);
          const cameraRawFeature = toCameraRawFeature(landmarks, timestamp);
          if (cameraRawFeature) cameraFrames.push(cameraRawFeature);
        }
      }

      calibration.setProgress((timestamp - (deadline - CALIBRATION_DURATION_MS)) / CALIBRATION_DURATION_MS);

      if (timestamp < deadline) {
        requestAnimationFrame(tick);
        return;
      }

      finishCalibration(frames, cameraFrames);
    };

    requestAnimationFrame(tick);
  }

  async function finishCalibration(
    frames: FrameFeature[],
    cameraFrames: CameraRawFeature[],
  ): Promise<void> {
    const nextProfile = buildUserProfile(frames);
    const nextCameraProfile = buildCameraProfile(cameraFrames);

    if (
      nextProfile.validFrameCount < MIN_CALIBRATION_FRAMES ||
      cameraFrames.length < MIN_CALIBRATION_FRAMES ||
      !nextCameraProfile
    ) {
      calibration.showResult(
        false,
        "자세를 충분히 인식하지 못했어요. 카메라에 상체 전체가 잘 보이는지 확인하고 다시 시도해주세요.",
        () => runCalibration(),
      );
      return;
    }

    activateProfile(nextProfile, nextCameraProfile);

    try {
      await saveProfiles({
        userProfile: nextProfile,
        cameraProfile: nextCameraProfile,
        madProfile,
        lastCalibrationAt: Date.now(),
      });
    } catch (error) {
      console.error("failed to persist calibration profile", error);
    }

    // Lets this run's detector window (and any calibration window reopened
    // later in the same run) trust the profile just saved instead of
    // forcing calibration again — see runCalibrated above and
    // calibratedThisRun in electron/main.cjs. No-op on the plain web build.
    window.electronAPI?.markRunCalibrated();

    calibration.showResult(true, "이제부터 바른 자세를 도와드릴게요.", () => {
      hideCalibrationUI();
      startLoop();
    });
  }

  // ---- main detection loop state --------------------------------------
  let previousFeature: FrameFeature | null = null;
  let alertSince: number | null = null;
  let fairyLastShownAt = 0;
  let fairyShowing = false;
  let loopStarted = false;
  // Separate from the posture-alert cooldown above: fires the fairy for
  // "no person in frame at all" instead of a bad-posture nudge. The two
  // are mutually exclusive per frame (this only ever runs while landmarks
  // aren't reliable), so they can't fight over the same fairy instance.
  let noPersonSince: number | null = null;
  let noPersonFairyLastShownAt = 0;
  let noPersonFairyShowing = false;
  // Mirrors the noPerson* trio above but for "a person is in frame but
  // landmarks aren't reliable enough to read posture" (describeUnreliableState
  // returning "UNKNOWN") — the other half of the !quality.reliable branch,
  // so it needs its own trigger-delay/cooldown state to not fight noPerson's.
  let unknownSince: number | null = null;
  let unknownFairyLastShownAt = 0;
  let unknownFairyShowing = false;

  // ---- decide calibration vs. resume on load -------------------------
  try {
    // Inside the Electron shell, a saved profile left over from a run
    // before the last power-off/power-on isn't enough on its own to skip
    // calibration — only trust it if this same app run already calibrated
    // once (electronAPI is absent on the plain web build, which has no such
    // "run" concept and keeps resuming from IndexedDB as before).
    const runCalibrated = (await window.electronAPI?.getRunCalibrated()) ?? true;
    const stored = runCalibrated ? await loadProfiles() : null;
    if (stored) {
      activateProfile(stored.userProfile, stored.cameraProfile);
      setStatus("idle", "저장된 자세 기준을 불러왔어요");
      startLoop();
    } else {
      runCalibration();
    }
  } catch (error) {
    console.error("failed to load saved profile", error);
    runCalibration();
  }

  settingsBtn.onclick = () => {
    detector = null;
    trackedAnchor = null;
    runCalibration();
  };

  function startLoop(): void {
    if (loopStarted) return;
    loopStarted = true;
    requestAnimationFrame(loop);
  }

  function loop(): void {
    const timestamp = performance.now();
    const result = detectPoseForVideoFrame(landmarker, video, timestamp);
    const landmarks = selectPrimaryLandmarks(result, trackedAnchor);

    // Drawing is handled by the independent previewTick() loop above now —
    // it needs to keep running through calibration too, when this loop
    // isn't started yet.
    const quality = assessLandmarkQuality(landmarks, timestamp);

    if (!quality.reliable || !landmarks) {
      const wasTracking = previousFeature !== null;
      previousFeature = null;
      // Person stepped out / unreadable frame — this is a "hold", not a
      // verdict, so we don't flip to the red "bad posture" state here.
      // trackedAnchor is intentionally left as-is (not cleared): a brief
      // dropout shouldn't discard identity, since selectPrimaryLandmarks
      // needs it to reacquire the same person rather than whoever's
      // closest once landmarks come back.
      const presenceState = describeUnreliableState(quality);
      setStatus(
        "hold",
        describePresenceLabel(presenceState, wasTracking),
        describePresenceDetail(presenceState, wasTracking),
      );

      if (presenceState === "NO_PERSON") {
        unknownSince = null;
        unknownFairyShowing = false;
        if (noPersonSince === null) noPersonSince = timestamp;
        const sustainedMs = timestamp - noPersonSince;
        const canRetrigger =
          !noPersonFairyShowing || timestamp - noPersonFairyLastShownAt > FAIRY_RETRIGGER_COOLDOWN_MS;
        if (sustainedMs >= FAIRY_TRIGGER_DELAY_MS && canRetrigger) {
          fairy.show(
            describePresenceDetail(presenceState, wasTracking),
            describePresenceLabel(presenceState, wasTracking),
          );
          noPersonFairyLastShownAt = timestamp;
          noPersonFairyShowing = true;
        }
      } else {
        noPersonSince = null;
        noPersonFairyShowing = false;
        if (unknownSince === null) unknownSince = timestamp;
        const sustainedMs = timestamp - unknownSince;
        const canRetrigger =
          !unknownFairyShowing || timestamp - unknownFairyLastShownAt > FAIRY_RETRIGGER_COOLDOWN_MS;
        if (sustainedMs >= FAIRY_TRIGGER_DELAY_MS && canRetrigger) {
          fairy.show(
            describePresenceDetail(presenceState, wasTracking),
            describePresenceLabel(presenceState, wasTracking),
          );
          unknownFairyLastShownAt = timestamp;
          unknownFairyShowing = true;
        }
      }

      requestAnimationFrame(loop);
      return;
    }

    if (noPersonFairyShowing || unknownFairyShowing) {
      // Only announce recovery if the corresponding "not detected"/"not
      // recognized" alert had actually fired (past its own trigger delay) —
      // otherwise a sub-2.5s flicker would announce a loss that was never
      // actually shown to the user.
      fairy.show(describePersonRecoveredDetail(), describePersonRecoveredLabel());
    }
    noPersonSince = null;
    noPersonFairyShowing = false;
    unknownSince = null;
    unknownFairyShowing = false;
    trackedAnchor = anchorFromLandmarks(landmarks) ?? trackedAnchor;

    const handResult = detectHandsForVideoFrame(handLandmarker, video, timestamp);
    const feature = toFrameFeature(landmarks, timestamp, previousFeature, handResult.landmarks);
    previousFeature = feature;

    if (!feature || !detector) {
      requestAnimationFrame(loop);
      return;
    }

    // NOTE: this is where the camera-relative-position auto-correction /
    // hold-judgment logic (today's item #2, being built alongside this)
    // plugs in — e.g. checking computeCameraDelta(feature landmarks,
    // cameraProfile) and calling setStatus("hold", ...) instead of running
    // the detector while the camera itself is still settling. The
    // DetectionEvent shape already carries cameraState / cameraCheckRequired
    // for exactly this.
    if (cameraProfile) {
      // camera profile is available for that check once it's ready to wire in
    }

    const event: DetectionEvent = detector.update(feature, quality);
    madProfile = madUpdater.update(feature, {
      landmarkQuality: quality,
      matchedPosture: event.postureType,
    });
    detector.setMADProfile(madProfile);

    const feedback = generateFeedback(event);

    if (event.alert) {
      if (alertSince === null) alertSince = timestamp;
      const sustainedMs = timestamp - alertSince;
      const label = SHOW_SPECIFIC_POSTURE_LABEL
        ? describePostureLabel(event)
        : "자세를 바로잡아주세요";
      setStatus("bad", label, feedback.message);

      const canRetrigger =
        !fairyShowing || timestamp - fairyLastShownAt > FAIRY_RETRIGGER_COOLDOWN_MS;
      if (sustainedMs >= FAIRY_TRIGGER_DELAY_MS && canRetrigger) {
        fairy.show(describePostureDetail(event, feedback.message), label);
        fairyLastShownAt = timestamp;
        fairyShowing = true;
      }
    } else {
      if (fairyShowing) {
        // Don't force the fairy away here — it's a toast now and vanishes
        // on its own auto-hide timer regardless of posture. Just stop
        // tracking it as "showing" so the next alert can retrigger it
        // immediately instead of waiting out the retrigger cooldown.
        fairyShowing = false;
        sessionAudio.notifyReturnToNormal();
      }
      alertSince = null;
      setStatus("good", "정상 자세예요", "");
    }

    requestAnimationFrame(loop);
  }
}

void main();
