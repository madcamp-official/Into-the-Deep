import type { DetectionEvent, ScenarioLabel } from "../../core/types";
import { toScenarioEvents, type ScenarioEvent } from "../scenario-labeler";

export interface MetricsReport {
  falseAlertsPerHour: number;
  sustainedDriftDetectionRate: number;
  averageDetectionDelaySeconds: number;
}

// Labels that count as a sustained-drift ground-truth event. CAMERA_CHANGE
// is excluded — that's evaluated separately as camera robustness (plan.md
// section 20), not the posture drift detection rate.
const DRIFT_LABELS: ReadonlySet<ScenarioLabel["label"]> = new Set([
  "FORWARD_LEAN",
  "FORWARD_HEAD",
  "LEFT_LEAN",
  "RIGHT_LEAN",
  "SIDE_SHIFT",
  "HEAD_TURN",
  "CLOSE_TO_CAMERA",
]);

const DETECTION_WINDOW_SECONDS = 10;

// `ScenarioLabel.timestamp` / `DetectionEvent.timestamp` are milliseconds
// (matching `performance.now()` and `FixedThresholdDetector`/
// `PersonalizedDriftDetector`'s sustained-duration math), so every ms
// difference below is divided by 1000 before being compared against or
// reported as a "seconds" quantity.
interface AlertEpisode {
  startTimestamp: number;
}

// Collapses a consecutive run of alert:true events into a single episode,
// per plan.md section 20 ("연속해서 유지되는 하나의 경고는 ... 1회로 계산").
function toAlertEpisodes(events: readonly DetectionEvent[]): AlertEpisode[] {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const episodes: AlertEpisode[] = [];
  let inEpisode = false;

  for (const event of sorted) {
    if (event.alert && !inEpisode) {
      episodes.push({ startTimestamp: event.timestamp });
      inEpisode = true;
    } else if (!event.alert) {
      inEpisode = false;
    }
  }

  return episodes;
}

function computeFalseAlertsPerHour(
  episodes: readonly AlertEpisode[],
  segments: readonly ScenarioEvent[],
): number {
  const normalSegments = segments.filter((segment) => segment.label === "NORMAL_WORK");
  const normalWorkSeconds = normalSegments.reduce(
    (sum, segment) => sum + (segment.endTimestamp - segment.startTimestamp) / 1000,
    0,
  );
  if (normalWorkSeconds <= 0) return 0;

  const falseAlertCount = episodes.filter((episode) =>
    normalSegments.some(
      (segment) =>
        episode.startTimestamp >= segment.startTimestamp &&
        episode.startTimestamp < segment.endTimestamp,
    ),
  ).length;

  return falseAlertCount / (normalWorkSeconds / 3600);
}

function computeDriftDetection(
  episodes: readonly AlertEpisode[],
  segments: readonly ScenarioEvent[],
): { rate: number; averageDelaySeconds: number } {
  const driftSegments = segments.filter((segment) => DRIFT_LABELS.has(segment.label));
  if (driftSegments.length === 0) {
    return { rate: 0, averageDelaySeconds: 0 };
  }

  const delays: number[] = [];
  for (const segment of driftSegments) {
    const detectingEpisode = episodes.find(
      (episode) =>
        episode.startTimestamp >= segment.startTimestamp &&
        (episode.startTimestamp - segment.startTimestamp) / 1000 <= DETECTION_WINDOW_SECONDS,
    );
    if (detectingEpisode) {
      delays.push((detectingEpisode.startTimestamp - segment.startTimestamp) / 1000);
    }
  }

  const averageDelaySeconds =
    delays.length > 0 ? delays.reduce((sum, delay) => sum + delay, 0) / delays.length : 0;

  return { rate: delays.length / driftSegments.length, averageDelaySeconds };
}

// Implements the three official/aux metrics from plan.md section 20:
// - false alerts per hour during NORMAL_WORK
// - sustained drift detection rate (alert within 10s of drift onset)
// - average detection delay
//
// `sessionEndTimestamp` closes out the final ground-truth segment; it
// defaults to the last event/label timestamp when omitted.
export function computeMetrics(
  events: DetectionEvent[],
  groundTruth: ScenarioLabel[],
  sessionEndTimestamp?: number,
): MetricsReport {
  const endTimestamp =
    sessionEndTimestamp ??
    Math.max(events.at(-1)?.timestamp ?? 0, groundTruth.at(-1)?.timestamp ?? 0);

  const segments = toScenarioEvents(groundTruth, endTimestamp);
  const episodes = toAlertEpisodes(events);
  const { rate, averageDelaySeconds } = computeDriftDetection(episodes, segments);

  return {
    falseAlertsPerHour: computeFalseAlertsPerHour(episodes, segments),
    sustainedDriftDetectionRate: rate,
    averageDetectionDelaySeconds: averageDelaySeconds,
  };
}
