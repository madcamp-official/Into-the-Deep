import type { FeatureVector, PostureType, ScenarioLabel } from "../../core/types";
import { MAD_FEATURES } from "../../core/mad-profile";
import { getSessionMetadata, type SessionLogEntry } from "../recorder";

const NORMAL_LABELS = new Set<ScenarioLabel["label"]>([
  "NORMAL_WORK",
  "TRANSIENT_ACTION",
  "SETTLING",
]);

type EventKey = "v0PostureEvent" | "v2PostureEvent";
type ConfusionMatrix = Record<string, Record<string, number>>;

export interface MADComparisonDetectorMetrics {
  detectedScenarios: number;
  totalScenarios: number;
  detectionRate: number;
  /** Number of false-alert episodes in NORMAL_WORK, TRANSIENT_ACTION and SETTLING. */
  falseAlertCount: number;
  /** Number of normal-user frames whose detector alert is true. */
  normalFalseAlertFrameCount: number;
  normalFalseAlertRate: number;
  /** Alerts during a labeled bad-posture scenario with the wrong posture type. */
  postureFalseAlertCount: number;
  postureFalseAlertsByLabel: Record<string, number>;
  /** Per predicted rule: alerts raised outside that rule's ground-truth posture. */
  falseAlertsByPredictedPosture: Record<string, number>;
  /** Actual scenario label -> predicted posture candidate. */
  candidateConfusion: ConfusionMatrix;
  /** Alert frames divided by all labeled bad-posture frames. */
  alertPersistenceRate: number;
  /** Extra alert starts after the first alert in the same posture scenario. */
  alertFragmentationCount: number;
  /** Mean duration of one contiguous alert run during normal-user intervals. */
  normalAlertAverageDurationMs: number | null;
}

export interface MADFeatureComparison {
  feature: string;
  initial: number | null;
  final: number | null;
  delta: number | null;
  changeRate: number | null;
}

export interface MADComparisonSegmentMetrics {
  detectionRate: number;
  normalFalseAlertCount: number;
  normalFalseAlertFrameCount: number;
  normalFalseAlertRate: number;
}

export interface MADComparisonReport {
  v0: MADComparisonDetectorMetrics;
  v2: MADComparisonDetectorMetrics;
  normalFrameCount: number;
  transientFrameCount: number;
  naturalAction: {
    frameCount: number;
    v0AlertFrameCount: number;
    v2AlertFrameCount: number;
    v0AlertRate: number;
    v2AlertRate: number;
    v0FalseAlertCount: number;
    v2FalseAlertCount: number;
  };
  madUpdateCount: number;
  initialMAD: FeatureVector;
  finalMAD: FeatureVector;
  madByFeature: MADFeatureComparison[];
  updateBeforeAfter: {
    beforeFirstUpdate: { v0: MADComparisonSegmentMetrics; v2: MADComparisonSegmentMetrics };
    afterFirstUpdate: { v0: MADComparisonSegmentMetrics; v2: MADComparisonSegmentMetrics } | null;
  };
  scenarioResults: Array<{
    label: PostureType;
    v0Detected: boolean;
    v2Detected: boolean;
  }>;
  notes: string[];
}

export function analyzeMADComparisonSession(
  entries: readonly SessionLogEntry[],
): MADComparisonReport {
  const comparisonEntries = entries.filter((entry) => entry.comparison !== undefined);
  const scenarios = buildPostureScenarios(comparisonEntries);
  const v0 = summarizeDetector(comparisonEntries, scenarios, "v0PostureEvent");
  const v2 = summarizeDetector(comparisonEntries, scenarios, "v2PostureEvent");
  const updateCounts = comparisonEntries.map((entry) => entry.comparison?.madUpdateCount ?? 0);
  const madUpdateCount = updateCounts.length > 0 ? Math.max(...updateCounts) : 0;
  const initialMAD = getSessionMetadata(comparisonEntries)?.madProfile?.values ?? {};
  const finalMAD = lastMADValues(comparisonEntries) ?? {};
  const firstUpdateIndex = comparisonEntries.findIndex(
    (entry) => (entry.comparison?.madUpdateCount ?? 0) > 0,
  );
  const beforeEntries = firstUpdateIndex < 0
    ? comparisonEntries
    : comparisonEntries.slice(0, firstUpdateIndex);
  const afterEntries = firstUpdateIndex < 0
    ? null
    : comparisonEntries.slice(firstUpdateIndex);

  return {
    v0,
    v2,
    normalFrameCount: comparisonEntries.filter(isNormalEntry).length,
    transientFrameCount: comparisonEntries.filter(
      (entry) => entry.groundTruth === "TRANSIENT_ACTION",
    ).length,
    naturalAction: summarizeNaturalAction(comparisonEntries),
    madUpdateCount,
    initialMAD,
    finalMAD,
    madByFeature: buildMADComparison(initialMAD, finalMAD),
    updateBeforeAfter: {
      beforeFirstUpdate: summarizeUpdateSegment(beforeEntries),
      afterFirstUpdate: afterEntries === null
        ? null
        : summarizeUpdateSegment(afterEntries),
    },
    scenarioResults: scenarios.map((scenario) => ({
      label: scenario.label,
      v0Detected: detectorResult(scenario, "v0PostureEvent"),
      v2Detected: detectorResult(scenario, "v2PostureEvent"),
    })),
    notes: comparisonEntries.length === 0
      ? ["No MAD comparison frames found. Record a MAD comparison session first."]
      : [
        "Detection delay is intentionally excluded because V2 requires a 5-second sustained posture.",
        "Transient actions are counted as normal-user intervals for false-alert metrics.",
        ...(madUpdateCount === 0
          ? ["No MAD update was recorded; before/after MAD comparison is unavailable."]
          : []),
        ...(Object.keys(finalMAD).length === 0
          ? ["This log has no MAD value snapshots; record a new session after this update."]
          : []),
      ],
  };
}

export function formatMADComparisonReport(report: MADComparisonReport): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const metric = (label: string, value: MADComparisonDetectorMetrics): string[] => [
    `${label} detection rate: ${percent(value.detectionRate)}`,
    `${label} normal false-alert episodes: ${value.falseAlertCount}`,
    `${label} normal false-alert frames: ${value.normalFalseAlertFrameCount} (${percent(value.normalFalseAlertRate)})`,
    `${label} posture false alerts: ${value.postureFalseAlertCount}`,
    `${label} posture false alerts by actual posture: ${formatCountMap(value.postureFalseAlertsByLabel)}`,
    `${label} false alerts by predicted posture: ${formatCountMap(value.falseAlertsByPredictedPosture)}`,
    `${label} alert persistence during posture: ${percent(value.alertPersistenceRate)}`,
    `${label} alert fragmentation count: ${value.alertFragmentationCount}`,
    `${label} normal alert average duration: ${formatDuration(value.normalAlertAverageDurationMs)}`,
  ];
  const confusion = (label: string, matrix: ConfusionMatrix): string[] => [
    `${label} candidate confusion:`,
    ...Object.entries(matrix).map(([actual, predicted]) =>
      `  ${actual} -> ${Object.entries(predicted).map(([key, count]) => `${key}:${count}`).join(", ")}`,
    ),
  ];
  const madLines = report.madByFeature
    .filter((item) => item.initial !== null || item.final !== null)
    .map((item) =>
      `  ${item.feature}: ${formatNullable(item.initial)} -> ${formatNullable(item.final)} ` +
      `(delta ${formatNullable(item.delta)}, rate ${formatNullable(item.changeRate, true)})`,
    );
  const before = report.updateBeforeAfter.beforeFirstUpdate;
  const after = report.updateBeforeAfter.afterFirstUpdate;

  return [
    `normal frames (including transient): ${report.normalFrameCount}`,
    `transient-action frames: ${report.transientFrameCount}`,
    `MAD update count: ${report.madUpdateCount}`,
    "",
    ...metric("V0", report.v0),
    ...metric("V2", report.v2),
    "",
    "natural-action false-alert comparison:",
    `  V0: ${report.naturalAction.v0FalseAlertCount} episodes, ${report.naturalAction.v0AlertFrameCount} frames (${percent(report.naturalAction.v0AlertRate)})`,
    `  V2: ${report.naturalAction.v2FalseAlertCount} episodes, ${report.naturalAction.v2AlertFrameCount} frames (${percent(report.naturalAction.v2AlertRate)})`,
    "",
    "posture detection by scenario:",
    ...report.scenarioResults.map((result) =>
      `  ${result.label}: V0 ${result.v0Detected ? "detected" : "missed"}, V2 ${result.v2Detected ? "detected" : "missed"}`,
    ),
    "",
    ...confusion("V0", report.v0.candidateConfusion),
    ...confusion("V2", report.v2.candidateConfusion),
    "",
    "MAD initial -> final by feature:",
    ...(madLines.length > 0 ? madLines : ["  unavailable"]),
    "",
    "before/after first MAD update:",
    `  before: V0 detection ${percent(before.v0.detectionRate)}, V2 detection ${percent(before.v2.detectionRate)}, ` +
      `normal false-alert rate V0/V2 ${percent(before.v0.normalFalseAlertRate)}/${percent(before.v2.normalFalseAlertRate)}`,
    after
      ? `  after:  V0 detection ${percent(after.v0.detectionRate)}, V2 detection ${percent(after.v2.detectionRate)}, ` +
        `normal false-alert rate V0/V2 ${percent(after.v0.normalFalseAlertRate)}/${percent(after.v2.normalFalseAlertRate)}`
      : "  after: unavailable (MAD was not updated)",
    "",
    ...report.notes,
  ].join("\n");
}

interface ScenarioSlice {
  label: PostureType;
  entries: SessionLogEntry[];
}

function buildPostureScenarios(entries: readonly SessionLogEntry[]): ScenarioSlice[] {
  const result: ScenarioSlice[] = [];
  let current: ScenarioSlice | null = null;
  for (const entry of entries) {
    if (isNormalEntry(entry)) {
      current = null;
      continue;
    }
    const label = entry.groundTruth as PostureType;
    if (!current || current.label !== label) {
      current = { label, entries: [] };
      result.push(current);
    }
    current.entries.push(entry);
  }
  return result;
}

function summarizeDetector(
  entries: readonly SessionLogEntry[],
  scenarios: readonly ScenarioSlice[],
  eventKey: EventKey,
): MADComparisonDetectorMetrics {
  const results = scenarios.map((scenario) => detectorResult(scenario, eventKey));
  const normalEntries = entries.filter(isNormalEntry);
  return {
    detectedScenarios: results.filter(Boolean).length,
    totalScenarios: scenarios.length,
    detectionRate: scenarios.length === 0 ? 0 : results.filter(Boolean).length / scenarios.length,
    falseAlertCount: countAlertRises(entries, eventKey),
    normalFalseAlertFrameCount: normalEntries.filter((entry) => isAlert(entry, eventKey)).length,
    normalFalseAlertRate: rate(
      normalEntries.filter((entry) => isAlert(entry, eventKey)).length,
      normalEntries.length,
    ),
    postureFalseAlertCount: countPostureFalseAlerts(entries, eventKey),
    postureFalseAlertsByLabel: postureFalseAlertsByLabel(entries, eventKey),
    falseAlertsByPredictedPosture: falseAlertsByPredictedPosture(entries, eventKey),
    candidateConfusion: buildCandidateConfusion(entries, eventKey),
    alertPersistenceRate: calculateAlertPersistenceRate(entries, eventKey),
    alertFragmentationCount: calculateAlertFragmentation(entries, eventKey),
    normalAlertAverageDurationMs: calculateNormalAlertAverageDuration(entries, eventKey),
  };
}

function summarizeUpdateSegment(entries: readonly SessionLogEntry[]): {
  v0: MADComparisonSegmentMetrics;
  v2: MADComparisonSegmentMetrics;
} {
  const scenarios = buildPostureScenarios(entries);
  const summarize = (eventKey: EventKey): MADComparisonSegmentMetrics => {
    const detector = summarizeDetector(entries, scenarios, eventKey);
    return {
      detectionRate: detector.detectionRate,
      normalFalseAlertCount: detector.falseAlertCount,
      normalFalseAlertFrameCount: detector.normalFalseAlertFrameCount,
      normalFalseAlertRate: detector.normalFalseAlertRate,
    };
  };
  return { v0: summarize("v0PostureEvent"), v2: summarize("v2PostureEvent") };
}

function summarizeNaturalAction(entries: readonly SessionLogEntry[]): MADComparisonReport["naturalAction"] {
  const natural = entries.filter((entry) => entry.groundTruth === "TRANSIENT_ACTION");
  const v0AlertFrames = natural.filter((entry) => isAlert(entry, "v0PostureEvent")).length;
  const v2AlertFrames = natural.filter((entry) => isAlert(entry, "v2PostureEvent")).length;
  return {
    frameCount: natural.length,
    v0AlertFrameCount: v0AlertFrames,
    v2AlertFrameCount: v2AlertFrames,
    v0AlertRate: rate(v0AlertFrames, natural.length),
    v2AlertRate: rate(v2AlertFrames, natural.length),
    v0FalseAlertCount: countAlertRises(natural, "v0PostureEvent"),
    v2FalseAlertCount: countAlertRises(natural, "v2PostureEvent"),
  };
}

function countAlertRises(entries: readonly SessionLogEntry[], eventKey: EventKey): number {
  let previous = false;
  let count = 0;
  for (const entry of entries) {
    if (!isNormalEntry(entry)) {
      previous = false;
      continue;
    }
    const alert = isAlert(entry, eventKey);
    if (alert && !previous) count += 1;
    previous = alert;
  }
  return count;
}

function countPostureFalseAlerts(entries: readonly SessionLogEntry[], eventKey: EventKey): number {
  return entries.filter((entry) => {
    if (isNormalEntry(entry) || !isAlert(entry, eventKey)) return false;
    return entry.comparison?.[eventKey].postureType !== entry.groundTruth;
  }).length;
}

function postureFalseAlertsByLabel(
  entries: readonly SessionLogEntry[],
  eventKey: EventKey,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of entries) {
    if (isNormalEntry(entry) || !isAlert(entry, eventKey)) continue;
    if (entry.comparison?.[eventKey].postureType === entry.groundTruth) continue;
    result[entry.groundTruth] = (result[entry.groundTruth] ?? 0) + 1;
  }
  return result;
}

function falseAlertsByPredictedPosture(
  entries: readonly SessionLogEntry[],
  eventKey: EventKey,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of entries) {
    const event = entry.comparison?.[eventKey];
    const predicted = event?.postureType;
    if (!event?.alert || !predicted || entry.groundTruth === predicted) continue;
    result[predicted] = (result[predicted] ?? 0) + 1;
  }
  return result;
}

function buildCandidateConfusion(entries: readonly SessionLogEntry[], eventKey: EventKey): ConfusionMatrix {
  const matrix: ConfusionMatrix = {};
  for (const entry of entries) {
    if (isNormalEntry(entry)) continue;
    const event = entry.comparison?.[eventKey];
    if (!event?.alert && !(event?.postureCandidates && event.postureCandidates.length > 0)) continue;
    const predicted = event.postureType ?? event.postureCandidates?.[0]?.postureType ?? "NO_CANDIDATE";
    const row = matrix[entry.groundTruth] ?? (matrix[entry.groundTruth] = {});
    row[predicted] = (row[predicted] ?? 0) + 1;
  }
  return matrix;
}

function calculateAlertPersistenceRate(
  entries: readonly SessionLogEntry[],
  eventKey: EventKey,
): number {
  const postureEntries = entries.filter((entry) => !isNormalEntry(entry));
  if (postureEntries.length === 0) return 0;
  return rate(postureEntries.filter((entry) => isAlert(entry, eventKey)).length, postureEntries.length);
}

function calculateAlertFragmentation(
  entries: readonly SessionLogEntry[],
  eventKey: EventKey,
): number {
  let fragmentation = 0;
  let currentLabel: string | null = null;
  let previousAlert = false;
  let alertStarts = 0;
  for (const entry of entries) {
    if (isNormalEntry(entry)) {
      if (currentLabel !== null) fragmentation += Math.max(0, alertStarts - 1);
      currentLabel = null;
      previousAlert = false;
      alertStarts = 0;
      continue;
    }
    if (entry.groundTruth !== currentLabel) {
      if (currentLabel !== null) fragmentation += Math.max(0, alertStarts - 1);
      currentLabel = entry.groundTruth;
      previousAlert = false;
      alertStarts = 0;
    }
    const alert = isAlert(entry, eventKey);
    if (alert && !previousAlert) alertStarts += 1;
    previousAlert = alert;
  }
  if (currentLabel !== null) fragmentation += Math.max(0, alertStarts - 1);
  return fragmentation;
}

function calculateNormalAlertAverageDuration(
  entries: readonly SessionLogEntry[],
  eventKey: EventKey,
): number | null {
  const durations: number[] = [];
  let alertStartedAt: number | null = null;
  for (const entry of entries) {
    if (!isNormalEntry(entry)) {
      if (alertStartedAt !== null) durations.push(entry.timestamp - alertStartedAt);
      alertStartedAt = null;
      continue;
    }
    const alert = isAlert(entry, eventKey);
    if (alert && alertStartedAt === null) alertStartedAt = entry.timestamp;
    if (!alert && alertStartedAt !== null) {
      durations.push(entry.timestamp - alertStartedAt);
      alertStartedAt = null;
    }
  }
  if (alertStartedAt !== null && entries.length > 0) {
    durations.push(entries[entries.length - 1].timestamp - alertStartedAt);
  }
  return durations.length === 0
    ? null
    : durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
}

function buildMADComparison(initial: FeatureVector, final: FeatureVector): MADFeatureComparison[] {
  return MAD_FEATURES.map((feature) => {
    const initialValue = initial[feature] ?? null;
    const finalValue = final[feature] ?? null;
    const delta = initialValue !== null && finalValue !== null ? finalValue - initialValue : null;
    return {
      feature,
      initial: initialValue,
      final: finalValue,
      delta,
      changeRate: delta !== null && initialValue !== null && initialValue !== 0
        ? delta / initialValue
        : null,
    };
  });
}

function lastMADValues(entries: readonly SessionLogEntry[]): FeatureVector | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const values = entries[index].comparison?.madValues;
    if (values) return values;
  }
  return undefined;
}

function isNormalEntry(entry: SessionLogEntry): boolean {
  return NORMAL_LABELS.has(entry.groundTruth);
}

function isAlert(entry: SessionLogEntry, eventKey: EventKey): boolean {
  return entry.comparison?.[eventKey].alert ?? false;
}

function detectorResult(scenario: ScenarioSlice, eventKey: EventKey): boolean {
  return scenario.entries.some((entry) => isAlert(entry, eventKey));
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function formatNullable(value: number | null, percent = false): string {
  return value === null ? "n/a" : percent ? `${(value * 100).toFixed(1)}%` : value.toFixed(4);
}

function formatDuration(value: number | null): string {
  return value === null ? "n/a" : `${(value / 1000).toFixed(2)}s`;
}

function formatCountMap(values: Record<string, number>): string {
  const entries = Object.entries(values);
  return entries.length === 0
    ? "none"
    : entries.map(([key, value]) => `${key}:${value}`).join(", ");
}
