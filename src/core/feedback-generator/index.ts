import type { DetectionEvent, PostureFeedback } from "../types";

/**
 * Per-feature guidance phrases (plan.md 14절: LLM 없이 dominant feature에
 * 따라 규칙적으로 문구를 생성). Keyed on FrameFeature/DriftObservation
 * field names as they exist today. Once need_discussion 3번(자세별 rule)
 * lands, `event.reason` will start carrying the new feature_discussion
 * feature names — add entries here rather than replacing the map, and
 * anything not yet listed falls back to GENERIC_FEATURE_MESSAGE instead of
 * throwing.
 */
const FEATURE_MESSAGES: Readonly<Record<string, string>> = {
  shoulderTilt: "어깨가 한쪽으로 기울었습니다.",
  headXOffset: "머리가 기준 위치보다 옆으로 이동했습니다.",
  shoulderXOffset: "상체가 기준 위치보다 옆으로 이동했습니다.",
  shoulderYOffset: "어깨 높이가 기준보다 달라졌습니다.",
  bodyScale: "상체가 기준보다 카메라에 가까워졌습니다.",
  faceToShoulderRatio: "얼굴과 어깨의 상대적인 크기가 기준과 달라졌습니다.",
  pitchProxy: "고개가 위아래로 기울었습니다.",
  yawProxy: "고개가 좌우로 돌아갔습니다.",
};

const GENERIC_FEATURE_MESSAGE = "자세가 기준에서 벗어났습니다.";
const RECOVERED_MESSAGE = "자세가 기준으로 돌아왔습니다.";

function describeFeatures(features: readonly string[]): string {
  if (features.length === 0) return GENERIC_FEATURE_MESSAGE;
  const phrases = features.map((feature) => FEATURE_MESSAGES[feature] ?? GENERIC_FEATURE_MESSAGE);
  return [...new Set(phrases)].join(" ");
}

/**
 * Turns a temporal-state-machine DetectionEvent into user-facing feedback.
 * Guideline visibility follows plan.md 14절: normal states show nothing
 * extra, SUSTAINED_DRIFT/ALERTED show the calibration guideline once a
 * drift has actually persisted (not on every brief DRIFT_SUSPECTED blip).
 */
export function generateFeedback(event: DetectionEvent): PostureFeedback {
  switch (event.state) {
    case "ALERTED":
      return {
        timestamp: event.timestamp,
        state: event.state,
        alert: true,
        guidelineVisible: true,
        message: describeFeatures(event.reason),
        dominantFeatures: event.reason,
      };
    case "SUSTAINED_DRIFT":
      return {
        timestamp: event.timestamp,
        state: event.state,
        alert: false,
        guidelineVisible: true,
        message: describeFeatures(event.reason),
        dominantFeatures: event.reason,
      };
    case "DRIFT_SUSPECTED":
      return {
        timestamp: event.timestamp,
        state: event.state,
        alert: false,
        guidelineVisible: false,
        message: "",
        dominantFeatures: event.reason,
      };
    case "RECOVERED":
      return {
        timestamp: event.timestamp,
        state: event.state,
        alert: false,
        guidelineVisible: false,
        message: RECOVERED_MESSAGE,
        dominantFeatures: [],
      };
    default:
      // STABLE / MOVING / SETTLING / SLOW_DRIFT_WATCH: nothing to say yet.
      return {
        timestamp: event.timestamp,
        state: event.state,
        alert: false,
        guidelineVisible: false,
        message: "",
        dominantFeatures: [],
      };
  }
}
