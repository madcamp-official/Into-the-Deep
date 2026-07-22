import type { DetectionEvent, FrameFeature, UserProfile } from "../../core/types";
import { createInitialMADProfile } from "../../core/mad-profile";
import { PostureRuleDetector } from "../../core/posture-rule-detector";
import { V2MadUpdater } from "../../core/v2-mad-updater";
import { getSessionMetadata, type SessionLogEntry } from "../recorder";
import {
  DEFAULT_THRESHOLDS,
  FixedThresholdDetector,
  type FixedThresholds,
} from "../../core/fixed-threshold-detector";
import {
  DEFAULT_PERSONALIZED_THRESHOLDS,
  PersonalizedDriftDetector,
  type PersonalizedThresholds,
} from "../../core/personalized-detector";

export type Detector = (entry: SessionLogEntry) => DetectionEvent;

// Replays a parsed JSONL session through a given detector (V0/V1/V2) and
// collects the resulting DetectionEvent stream (plan.md section 19).
export function replay(
  entries: readonly SessionLogEntry[],
  detector: Detector,
): DetectionEvent[] {
  return entries.map(detector);
}

function toFrameFeature(entry: SessionLogEntry): FrameFeature {
  return {
    ...entry.features,
    timestamp: entry.timestamp,
    confidence: entry.confidence,
  };
}

export function createRuleV0DetectorFromSession(entries: readonly SessionLogEntry[]): Detector {
  const metadata = getSessionMetadata(entries);
  if (!metadata) throw new Error("Session metadata is required to replay rule-based V0");
  const detector = new PostureRuleDetector(
    metadata.userProfile,
    metadata.madProfile ?? createInitialMADProfile(),
  );
  return (entry) => detector.update(toFrameFeature(entry));
}

export function createV2DetectorFromSession(entries: readonly SessionLogEntry[]): Detector {
  const metadata = getSessionMetadata(entries);
  if (!metadata) throw new Error("Session metadata is required to replay V2");
  let madProfile = metadata.madProfile ?? createInitialMADProfile();
  const detector = new PostureRuleDetector(metadata.userProfile, madProfile, { sustainedSeconds: 5 });
  const updater = new V2MadUpdater(madProfile, { centers: metadata.userProfile.originalCenters });
  return (entry) => {
    const feature = toFrameFeature(entry);
    const event = detector.update(feature);
    if (metadata.sessionType !== "CAMERA") {
      madProfile = updater.update(feature, { matchedPosture: event.postureType });
      detector.setMADProfile(madProfile);
    }
    return event;
  };
}

// Wires B's sustained V0 fixed-threshold detector into replay so stored
// JSONL logs follow the same alert timing as the live app.
export function createV0Detector(
  referenceCenters: Record<string, number>,
  thresholds: FixedThresholds = DEFAULT_THRESHOLDS,
): Detector {
  const detector = new FixedThresholdDetector(referenceCenters, thresholds);

  return (entry) => detector.update(toFrameFeature(entry));
}

// Wires B's personalized V1 drift detector into replay, so a stored JSONL
// session can be compared against V0 on the exact same frames (Day3 target,
// plan.md section 23: "저장된 로그에서 V0/V1 비교 가능").
export function createV1Detector(
  profile: UserProfile,
  thresholds: PersonalizedThresholds = DEFAULT_PERSONALIZED_THRESHOLDS,
): Detector {
  const detector = new PersonalizedDriftDetector(profile, thresholds);

  return (entry) => detector.update(toFrameFeature(entry)).event;
}

export function createV0DetectorFromSession(
  entries: readonly SessionLogEntry[],
  thresholds: FixedThresholds = DEFAULT_THRESHOLDS,
): Detector {
  const metadata = getSessionMetadata(entries);
  if (!metadata) {
    throw new Error("Session metadata is required to replay V0");
  }

  return createV0Detector(metadata.userProfile.originalCenters, thresholds);
}

export function createV1DetectorFromSession(
  entries: readonly SessionLogEntry[],
  thresholds: PersonalizedThresholds = DEFAULT_PERSONALIZED_THRESHOLDS,
): Detector {
  const metadata = getSessionMetadata(entries);
  if (!metadata) {
    throw new Error("Session metadata is required to replay V1");
  }

  return createV1Detector(metadata.userProfile, thresholds);
}
