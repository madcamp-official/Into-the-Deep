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
import { toFrameFeature } from "../../core/feature-normalizer";
import { assessLandmarkQuality, describeUnreliableState } from "../../core/landmark-reliability";
import { createInitialMADProfile } from "../../core/mad-profile";
import { PostureRuleDetector } from "../../core/posture-rule-detector";
import { V2MadUpdater } from "../../core/v2-mad-updater";
import { generateFeedback } from "../../core/feedback-generator";
import { loadProfiles } from "../indexeddb-storage";
import {
  describePersonRecoveredDetail,
  describePersonRecoveredLabel,
  describePostureDetail,
  describePostureLabel,
  describePresenceDetail,
  describePresenceLabel,
  RECALIBRATION_PROMPT_BUTTON_LABEL,
  RECALIBRATION_PROMPT_NOTE,
  shouldPromptRecalibration,
} from "../ui/posture-copy";
import type { FrameFeature, MADProfile } from "../../core/types";

// Headless counterpart to product-main.ts, run in a hidden Electron
// BrowserWindow (backgroundThrottling: false) instead of a browser tab —
// see electron/main.cjs. No DOM UI, no calibration flow: it only ever runs
// the detection loop against a profile that was already calibrated via the
// tray menu's "캘리브레이션 시작" (which opens the normal product.html), and
// reports alerts to the fairy overlay window over IPC instead of touching
// the page directly.

// Bad-posture alerts have no trigger delay of their own here — event.alert
// already means the V2 detector (PostureRuleDetector / temporal-state-machine,
// owned by another teammate) judged the posture sustained long enough to
// count as bad, so the fairy just reflects that verdict as-is instead of
// re-gating on a second, redundant wait. It then persists (no auto-hide) for
// as long as the bad posture does (see loop()'s event.alert branch) instead
// of retriggering on a cooldown. Mirrors product-main.ts so the web and
// Electron builds behave the same.
//
// "No person in frame" / "posture unreadable" alerts are a separate,
// UI-owned judgment (not something V2 evaluates), so they keep their own
// trigger delay and retrigger cooldown below.
const PRESENCE_ALERT_TRIGGER_DELAY_MS = 2500;
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
  // electronAPI is only optional on the plain web build (see
  // electron-api.d.ts); this window is Electron-only, so it's always
  // injected here.
  const electronAPI = window.electronAPI!;

  // A saved profile on disk isn't enough on its own to skip calibration —
  // it may be left over from a run before the last power-off/power-on.
  // Only trust it if this same app run already calibrated once (e.g. this
  // window is being recreated after the calibration window closed).
  // Otherwise treat it like a first run and send the user through
  // calibration again, same as having no profile at all.
  const runCalibrated = await electronAPI.getRunCalibrated();

  // Check for a profile *before* touching the camera at all: Windows
  // webcams are typically single-consumer, so this window must not hold
  // the stream open while there's no profile to detect against — that's
  // exactly the case where the tray's "캘리브레이션 시작" is about to open
  // product.html and needs the camera for itself.
  let stored;
  try {
    stored = runCalibrated ? await loadProfiles() : null;
  } catch (error) {
    console.error("failed to load saved profile", error);
    stored = null;
  }

  if (!stored) {
    console.warn(
      runCalibrated
        ? "no saved posture profile yet — asking main to open calibration"
        : "saved profile predates this run — forcing recalibration",
    );
    // First run (or a cleared profile, or a fresh app launch since the
    // saved profile was made): jump straight to calibration instead of
    // waiting for someone to find the tray icon.
    electronAPI.notifyNoProfile();
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
  let fairyShowing = false;
  // Which postureType the currently-persisted bad-posture fairy is showing —
  // lets the loop refresh the bubble's text if the dominant issue changes
  // mid-alert without re-sending the alert every single frame.
  let fairyMessageKey: string | null = null;
  // Where the calibrated user's shoulders were last seen — seeded from the
  // camera profile's calibration median so tracking is correct from the
  // first frame, even if someone else is already in frame when this
  // window starts up. See selectPrimaryLandmarks in pose-landmarker.ts.
  let trackedAnchor: PersonAnchor | null = {
    x: stored.cameraProfile.shoulderCenterX,
    y: stored.cameraProfile.shoulderCenterY,
  };
  // Separate from the posture-alert cooldown above: fires the fairy for
  // "no person in frame at all" instead of a bad-posture nudge. The two
  // never overlap (this only runs while landmarks aren't reliable), so
  // they can't fight over the same overlay.
  let noPersonSince: number | null = null;
  let noPersonFairyShowing = false;
  let noPersonFairyLastShownAt = 0;
  // Mirrors the noPerson* trio above but for "a person is in frame but
  // landmarks aren't reliable enough to read posture" (describeUnreliableState
  // returning "UNKNOWN") — the other half of the !quality.reliable branch,
  // so it needs its own trigger-delay/cooldown state to not fight noPerson's.
  let unknownSince: number | null = null;
  let unknownFairyShowing = false;
  let unknownFairyLastShownAt = 0;

  function loop(): void {
    const timestamp = performance.now();
    const result = detectPoseForVideoFrame(landmarker, video, timestamp);
    const landmarks = selectPrimaryLandmarks(result, trackedAnchor);
    const quality = assessLandmarkQuality(landmarks, timestamp);

    if (!quality.reliable || !landmarks) {
      const wasTracking = previousFeature !== null;
      previousFeature = null;
      // trackedAnchor deliberately kept as-is through a brief dropout —
      // see the matching note in product-main.ts's loop().
      const presenceState = describeUnreliableState(quality);

      if (presenceState === "NO_PERSON") {
        unknownSince = null;
        unknownFairyShowing = false;
        if (noPersonSince === null) noPersonSince = timestamp;
        const sustainedMs = timestamp - noPersonSince;
        const canRetrigger =
          !noPersonFairyShowing || timestamp - noPersonFairyLastShownAt > FAIRY_RETRIGGER_COOLDOWN_MS;
        if (sustainedMs >= PRESENCE_ALERT_TRIGGER_DELAY_MS && canRetrigger) {
          electronAPI.sendPostureAlert({
            title: describePresenceLabel(presenceState, wasTracking),
            message: describePresenceDetail(presenceState, wasTracking),
          });
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
        if (sustainedMs >= PRESENCE_ALERT_TRIGGER_DELAY_MS && canRetrigger) {
          electronAPI.sendPostureAlert({
            title: describePresenceLabel(presenceState, wasTracking),
            message: describePresenceDetail(presenceState, wasTracking),
          });
          unknownFairyLastShownAt = timestamp;
          unknownFairyShowing = true;
        }
      }

      setTimeout(loop, LOOP_INTERVAL_MS);
      return;
    }

    if (noPersonFairyShowing || unknownFairyShowing) {
      // Only announce recovery if the corresponding "not detected"/"not
      // recognized" alert had actually fired (past its own trigger delay) —
      // otherwise a sub-2.5s flicker would announce a loss that was never
      // actually shown to the user.
      electronAPI.sendPostureAlert({
        title: describePersonRecoveredLabel(),
        message: describePersonRecoveredDetail(),
      });
    }
    noPersonSince = null;
    noPersonFairyShowing = false;
    unknownSince = null;
    unknownFairyShowing = false;
    trackedAnchor = anchorFromLandmarks(landmarks) ?? trackedAnchor;

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
      // event.alert is already V2's verdict that this posture has been
      // sustained long enough to count as bad — send it immediately, no
      // extra wait on top. Persists (no auto-hide) until posture is actually
      // corrected (the `else` branch below); only re-sends on the initial
      // trigger or when the dominant issue changes, not every frame.
      if (!fairyShowing || fairyMessageKey !== event.postureType) {
        const feedback = generateFeedback(event);
        electronAPI.sendPostureAlert({
          title: describePostureLabel(event),
          message: describePostureDetail(event, feedback.message),
          persist: true,
          action: shouldPromptRecalibration(event.postureType)
            ? { note: RECALIBRATION_PROMPT_NOTE, buttonLabel: RECALIBRATION_PROMPT_BUTTON_LABEL }
            : undefined,
        });
        fairyShowing = true;
        fairyMessageKey = event.postureType ?? null;
      }
    } else {
      if (fairyShowing) {
        electronAPI.sendPostureAlertClear();
      }
      fairyShowing = false;
      fairyMessageKey = null;
    }

    setTimeout(loop, LOOP_INTERVAL_MS);
  }

  setTimeout(loop, LOOP_INTERVAL_MS);
}

main().catch((error: unknown) => console.error("electron-detector-main crashed", error));
