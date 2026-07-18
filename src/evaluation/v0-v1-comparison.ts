import type { DetectionEvent, ScenarioLabel, UserProfile } from "../core/types";
import type { FixedThresholds } from "../core/fixed-threshold-detector";
import type { PersonalizedThresholds } from "../core/personalized-detector";
import { buildUserProfile } from "../core/profile-builder";
import type { FrameFeature } from "../core/types";
import { createV0Detector, createV1Detector, replay } from "./replay-evaluator";
import { computeMetrics, type MetricsReport } from "./metrics";
import type { SessionLogEntry } from "./recorder";

export interface V0V1ComparisonResult {
  v0: { events: DetectionEvent[]; metrics: MetricsReport };
  v1: { events: DetectionEvent[]; metrics: MetricsReport };
}

// Replays the same session log through V0 and V1 so their metrics line up
// side by side (plan.md section 23, Day3 완료 기준: "저장된 로그에서 V0/V1
// 비교 가능"). `profile` should come from a calibration done before the
// session, not from the session itself — self-calibrating from the same
// log would fold any drift/false-positive segments into the reference
// centers and MAD, masking exactly the problems this comparison is meant
// to surface.
export function compareV0AndV1(
  entries: readonly SessionLogEntry[],
  profile: UserProfile,
  groundTruth: ScenarioLabel[],
  options?: { v0Thresholds?: FixedThresholds; v1Thresholds?: PersonalizedThresholds },
): V0V1ComparisonResult {
  const v0Events = replay(
    entries,
    createV0Detector(profile.originalCenters, options?.v0Thresholds),
  );
  const v1Events = replay(entries, createV1Detector(profile, options?.v1Thresholds));

  return {
    v0: { events: v0Events, metrics: computeMetrics(v0Events, groundTruth) },
    v1: { events: v1Events, metrics: computeMetrics(v1Events, groundTruth) },
  };
}

// Fallback for replaying a real downloaded session log that wasn't saved
// alongside its calibration profile (the live app doesn't export one yet —
// see main.ts). Builds a profile from the log's own NORMAL_WORK-labeled
// frames. Only use this when no separate calibration profile is
// available — see the caveat on compareV0AndV1 about why this is weaker
// than calibrating up front.
export function buildProfileFromNormalWork(
  entries: readonly SessionLogEntry[],
): UserProfile {
  const calibrationFrames: FrameFeature[] = entries
    .filter((entry) => entry.groundTruth === "NORMAL_WORK")
    .map((entry) => ({
      timestamp: entry.timestamp,
      confidence: entry.confidence,
      shoulderTilt: entry.features.shoulderTilt,
      headXOffset: entry.features.headXOffset,
      shoulderXOffset: entry.features.shoulderXOffset,
      shoulderYOffset: entry.features.shoulderYOffset,
      bodyScale: entry.features.bodyScale,
      faceToShoulderRatio: entry.features.faceToShoulderRatio,
      pitchProxy: entry.features.pitchProxy,
      yawProxy: entry.features.yawProxy,
      motionEnergy: entry.features.motionEnergy,
    }));

  return buildUserProfile(calibrationFrames);
}

const METRIC_ROWS: ReadonlyArray<{
  label: string;
  read: (metrics: MetricsReport) => string;
}> = [
  {
    label: "false alerts / hour",
    read: (metrics) => metrics.falseAlertsPerHour.toFixed(2),
  },
  {
    label: "sustained drift detection rate",
    read: (metrics) => `${(metrics.sustainedDriftDetectionRate * 100).toFixed(0)}%`,
  },
  {
    label: "avg detection delay (s)",
    read: (metrics) => metrics.averageDetectionDelaySeconds.toFixed(2),
  },
];

// Renders a plain-text results table (plan.md section 23: "결과 테이블
// 출력").
export function formatComparisonTable(result: V0V1ComparisonResult): string {
  const header = ["metric", "V0", "V1"];
  const rows = METRIC_ROWS.map(({ label, read }) => [
    label,
    read(result.v0.metrics),
    read(result.v1.metrics),
  ]);

  const widths = header.map((title, col) =>
    Math.max(title.length, ...rows.map((row) => row[col].length)),
  );
  const formatRow = (row: string[]) =>
    `| ${row.map((cell, col) => cell.padEnd(widths[col])).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;

  return [formatRow(header), separator, ...rows.map(formatRow)].join("\n");
}
