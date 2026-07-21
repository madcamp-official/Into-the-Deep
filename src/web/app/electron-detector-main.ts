import { startWebcam } from "../camera-adapter/webcam";
import {
  createPoseLandmarker,
  detectPoseForVideoFrame,
} from "../camera-adapter/pose-landmarker";
import {
  createHandLandmarker,
  detectHandsForVideoFrame,
} from "../camera-adapter/hand-landmarker";
import { toFrameFeature } from "../../core/feature-normalizer";
import { assessLandmarkQuality } from "../../core/landmark-reliability";
import { createInitialMADProfile } from "../../core/mad-profile";
import { PostureRuleDetector } from "../../core/posture-rule-detector";
import { V2MadUpdater } from "../../core/v2-mad-updater";
import { generateFeedback } from "../../core/feedback-generator";
import { loadProfiles } from "../indexeddb-storage";
import { describePostureDetail, describePostureLabel } from "../ui/posture-copy";
import type { FrameFeature, MADProfile } from "../../core/types";

// Headless counterpart to product-main.ts, run in a hidden Electron
// BrowserWindow (backgroundThrottling: false) instead of a browser tab —
// see electron/main.cjs. No DOM UI, no calibration flow: it only ever runs
// the detection loop against a profile that was already calibrated via the
// tray menu's "캘리브레이션 시작" (which opens the normal product.html), and
// reports alerts to the fairy overlay window over IPC instead of touching
// the page directly.

// How long a posture must stay "alerted" before the fairy interrupts, and
// how often it's allowed to retrigger — mirrors product-main.ts so the
// web and Electron builds nag at the same rate.
const FAIRY_TRIGGER_DELAY_MS = 2500;
const FAIRY_RETRIGGER_COOLDOWN_MS = 15000;

// requestAnimationFrame is tied to this window's compositor/repaint cycle —
// but this window is created with show:false and never actually painted,
// so rAF callbacks may never fire (or fire unreliably) regardless of the
// backgroundThrottling:false webPreference, which only prevents *throttling*
// of timers, not the separate "no frames are being produced to sync
// against" problem a truly unshown window has. setTimeout has no such
// dependency, so the loop keeps running steadily while some other app (e.g.
// VS Code) has focus — which is the entire point of this window existing.
const LOOP_INTERVAL_MS = 33; // ~30fps

async function main(): Promise<void> {
  // Check for a profile *before* touching the camera at all: Windows
  // webcams are typically single-consumer, so this window must not hold
  // the stream open while there's no profile to detect against — that's
  // exactly the case where the tray's "캘리브레이션 시작" is about to open
  // product.html and needs the camera for itself.
  const stored = await loadProfiles();
  if (!stored) {
    console.warn(
      "no saved posture profile yet — open the tray menu's 캘리브레이션 시작 first, " +
        "then this window will reload and start detecting",
    );
    return;
  }

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  try {
    await startWebcam(video);
  } catch (error) {
    console.error("camera permission failed", error);
    return;
  }

  const landmarker = await createPoseLandmarker();
  const handLandmarker = await createHandLandmarker();

  let madProfile: MADProfile = stored.madProfile ?? createInitialMADProfile({ now: Date.now() });
  const detector = new PostureRuleDetector(stored.userProfile, madProfile);
  const madUpdater = new V2MadUpdater(madProfile);

  let previousFeature: FrameFeature | null = null;
  let alertSince: number | null = null;
  let fairyShowing = false;
  let fairyLastShownAt = 0;

  function loop(): void {
    const timestamp = performance.now();
    const result = detectPoseForVideoFrame(landmarker, video, timestamp);
    const landmarks = result.landmarks[0];
    const quality = assessLandmarkQuality(landmarks, timestamp);

    if (!quality.reliable || !landmarks) {
      previousFeature = null;
      setTimeout(loop, LOOP_INTERVAL_MS);
      return;
    }

    const handResult = detectHandsForVideoFrame(handLandmarker, video, timestamp);
    const feature = toFrameFeature(landmarks, timestamp, previousFeature, handResult.landmarks);
    previousFeature = feature;
    if (!feature) {
      setTimeout(loop, LOOP_INTERVAL_MS);
      return;
    }

    const event = detector.update(feature, quality);
    madProfile = madUpdater.update(feature, {
      landmarkQuality: quality,
      matchedPosture: event.postureType,
    });
    detector.setMADProfile(madProfile);

    if (event.alert) {
      if (alertSince === null) alertSince = timestamp;
      const sustainedMs = timestamp - alertSince;
      const canRetrigger =
        !fairyShowing || timestamp - fairyLastShownAt > FAIRY_RETRIGGER_COOLDOWN_MS;

      if (sustainedMs >= FAIRY_TRIGGER_DELAY_MS && canRetrigger) {
        const feedback = generateFeedback(event);
        window.electronAPI.sendPostureAlert({
          title: describePostureLabel(event),
          message: describePostureDetail(event, feedback.message),
        });
        fairyLastShownAt = timestamp;
        fairyShowing = true;
      }
    } else {
      fairyShowing = false;
      alertSince = null;
    }

    setTimeout(loop, LOOP_INTERVAL_MS);
  }

  setTimeout(loop, LOOP_INTERVAL_MS);
}

void main();
