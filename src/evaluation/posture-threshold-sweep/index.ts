import type { DetectionEvent, PostureRule, PostureType } from "../../core/types";
import { createInitialMADProfile } from "../../core/mad-profile";
import { PostureRuleDetector } from "../../core/posture-rule-detector";
import { DEFAULT_POSTURE_RULES } from "../../core/posture-rules";
import { getSessionMetadata, labelsFromEntries, type SessionLogEntry } from "../recorder";
import { toScenarioEvents, type ScenarioEvent } from "../scenario-labeler";

export interface PostureThresholdSweepMetrics {
  scenarioCount: number;
  detectedScenarioCount: number;
  detectionRate: number;
  falseAlertsPerHour: number;
  averageDetectionDelaySeconds: number;
  precision: number;
  f1: number;
}

export interface PostureThresholdCandidate {
  postureType: PostureType;
  multiplier: number;
  thresholds: number[];
  metrics: PostureThresholdSweepMetrics;
  score: number;
}

export interface PostureThresholdRecommendation {
  postureType: PostureType;
  multiplier: number;
  thresholds: number[];
  metrics: PostureThresholdSweepMetrics;
  score: number;
}

export interface PostureThresholdSweepReport {
  candidates: PostureThresholdCandidate[];
  recommendations: PostureThresholdRecommendation[];
  multipliers: number[];
  notes: string[];
}

export interface PostureThresholdSweepOptions {
  multipliers?: readonly number[];
  sustainedSeconds?: number;
}

const DEFAULT_MULTIPLIERS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5];

/**
 * Finds a threshold multiplier independently for every posture rule.
 * Independent sweeps avoid an exponential search across all posture rules,
 * while the returned recommendations can still be applied together.
 */
export function sweepPostureThresholds(
  entries: readonly SessionLogEntry[],
  options: PostureThresholdSweepOptions = {},
): PostureThresholdSweepReport {
  const metadata = getSessionMetadata(entries);
  if (!metadata) {
    throw new Error("Session metadata is required for posture threshold sweep");
  }

  const multipliers = [...(options.multipliers ?? DEFAULT_MULTIPLIERS)].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  if (multipliers.length === 0) {
    throw new Error("At least one positive threshold multiplier is required");
  }

  const labels = labelsFromEntries(entries);
  const sessionEndTimestamp = entries.at(-1)?.timestamp ?? 0;
  const segments = toScenarioEvents(labels, sessionEndTimestamp);
  const candidates: PostureThresholdCandidate[] = [];

  for (const rule of DEFAULT_POSTURE_RULES) {
    for (const multiplier of multipliers) {
      const candidateRule = scaleRuleThresholds(rule, multiplier);
      const detector = new PostureRuleDetector(
        metadata.userProfile,
        metadata.madProfile ?? createInitialMADProfile(),
        { rules: [candidateRule], sustainedSeconds: options.sustainedSeconds },
      );
      const events = entries.map((entry) => detector.update(toFrameFeature(entry)));
      const metrics = evaluateCandidate(events, segments, rule.postureType);
      candidates.push({
        postureType: rule.postureType,
        multiplier,
        thresholds: getRuleThresholds(candidateRule),
        metrics,
        score: scoreCandidate(metrics),
      });
    }
  }

  const recommendations = DEFAULT_POSTURE_RULES.flatMap((rule) => {
    const ruleCandidates = candidates
      .filter((candidate) => candidate.postureType === rule.postureType)
      .sort(compareCandidates);
    return ruleCandidates[0]?.metrics.scenarioCount > 0 ? [ruleCandidates[0]] : [];
  });

  const notes = [
    "Each posture rule is swept independently; the recommendations can be applied together.",
    "A candidate is evaluated against the scenario's sustained alert, not individual frames.",
    "Use multiple users' posture sessions before fixing common production thresholds.",
  ];
  for (const rule of DEFAULT_POSTURE_RULES) {
    const recommendation = recommendations.find((item) => item.postureType === rule.postureType);
    if (recommendation?.metrics.scenarioCount === 0) {
      notes.push(`${rule.postureType}: no matching ground-truth scenario was found in this log`);
    }
  }

  return { candidates, recommendations, multipliers, notes };
}

export function formatPostureThresholdSweep(
  report: PostureThresholdSweepReport,
): string {
  const header = ["posture", "multiplier", "thresholds", "recall", "precision", "false/h", "delay", "score"];
  const rows = report.recommendations.map((recommendation) => [
    recommendation.postureType,
    recommendation.multiplier.toFixed(2),
    recommendation.thresholds.map((value) => value.toFixed(2)).join(","),
    `${(recommendation.metrics.detectionRate * 100).toFixed(0)}%`,
    `${(recommendation.metrics.precision * 100).toFixed(0)}%`,
    recommendation.metrics.falseAlertsPerHour.toFixed(2),
    recommendation.metrics.averageDetectionDelaySeconds.toFixed(2),
    recommendation.score.toFixed(3),
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const formatRow = (row: string[]) =>
    `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return [formatRow(header), separator, ...rows.map(formatRow)].join("\n");
}

function scaleRuleThresholds(rule: PostureRule, multiplier: number): PostureRule {
  return {
    ...rule,
    required: rule.required.map((condition) => ({
      ...condition,
      threshold: condition.threshold * multiplier,
    })),
    anyOf: rule.anyOf?.map((condition) => ({
      ...condition,
      threshold: condition.threshold * multiplier,
    })),
  };
}

function getRuleThresholds(rule: PostureRule): number[] {
  return [...rule.required, ...(rule.anyOf ?? [])].map((condition) => condition.threshold);
}

function toFrameFeature(entry: SessionLogEntry) {
  return {
    ...entry.features,
    timestamp: entry.timestamp,
    confidence: entry.confidence,
  };
}

function evaluateCandidate(
  events: readonly DetectionEvent[],
  segments: readonly ScenarioEvent[],
  postureType: PostureType,
): PostureThresholdSweepMetrics {
  const targetSegments = segments.filter((segment) => segment.label === postureType);
  const normalSegments = segments.filter((segment) => segment.label === "NORMAL_WORK");
  const alertEpisodes = toAlertEpisodeStarts(events);
  const detectedSegments = targetSegments.filter((segment) =>
    alertEpisodes.some(
      (timestamp) =>
        timestamp >= segment.startTimestamp &&
        timestamp < segment.endTimestamp,
    ),
  );
  const delays = detectedSegments.flatMap((segment) => {
    const timestamp = alertEpisodes.find(
      (candidate) => candidate >= segment.startTimestamp && candidate < segment.endTimestamp,
    );
    return timestamp === undefined ? [] : [(timestamp - segment.startTimestamp) / 1000];
  });
  const falseAlertCount = alertEpisodes.filter((timestamp) =>
    normalSegments.some(
      (segment) => timestamp >= segment.startTimestamp && timestamp < segment.endTimestamp,
    ),
  ).length;
  const normalSeconds = normalSegments.reduce(
    (sum, segment) => sum + (segment.endTimestamp - segment.startTimestamp) / 1000,
    0,
  );
  const falseAlertsPerHour = normalSeconds > 0 ? falseAlertCount / (normalSeconds / 3600) : 0;
  const detectionRate = targetSegments.length > 0 ? detectedSegments.length / targetSegments.length : 0;
  const precisionDenominator = detectedSegments.length + falseAlertCount;
  const precision = precisionDenominator > 0 ? detectedSegments.length / precisionDenominator : 0;
  const f1 = precision + detectionRate > 0
    ? (2 * precision * detectionRate) / (precision + detectionRate)
    : 0;

  return {
    scenarioCount: targetSegments.length,
    detectedScenarioCount: detectedSegments.length,
    detectionRate,
    falseAlertsPerHour,
    averageDetectionDelaySeconds: delays.length > 0
      ? delays.reduce((sum, delay) => sum + delay, 0) / delays.length
      : 0,
    precision,
    f1,
  };
}

function toAlertEpisodeStarts(events: readonly DetectionEvent[]): number[] {
  const starts: number[] = [];
  let active = false;
  for (const event of events) {
    if (event.alert && !active) starts.push(event.timestamp);
    active = event.alert;
  }
  return starts;
}

function scoreCandidate(metrics: PostureThresholdSweepMetrics): number {
  const falseAlertPenalty = Math.min(metrics.falseAlertsPerHour / 10, 1) * 0.25;
  const delayPenalty = Math.min(metrics.averageDetectionDelaySeconds / 10, 1) * 0.1;
  return metrics.f1 - falseAlertPenalty - delayPenalty;
}

function compareCandidates(left: PostureThresholdCandidate, right: PostureThresholdCandidate): number {
  return right.score - left.score ||
    left.metrics.falseAlertsPerHour - right.metrics.falseAlertsPerHour ||
    left.metrics.averageDetectionDelaySeconds - right.metrics.averageDetectionDelaySeconds;
}
