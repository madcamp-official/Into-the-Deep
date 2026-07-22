import type { PostureType, ScenarioLabel } from "../../core/types";
import type { SessionLogEntry } from "../recorder";

const NON_POSTURE_LABELS = new Set<ScenarioLabel["label"]>([
  "NORMAL_WORK",
  "TRANSIENT_ACTION",
  "SETTLING",
]);

export interface MADComparisonDetectorMetrics {
  detectedScenarios: number;
  totalScenarios: number;
  detectionRate: number;
  averageDetectionDelayMs: number | null;
  falseAlertCount: number;
}

export interface MADComparisonReport {
  v0: MADComparisonDetectorMetrics;
  v2: MADComparisonDetectorMetrics;
  normalFrameCount: number;
  transientFrameCount: number;
  madUpdateCount: number;
  finalMADUpdateCount: number;
  scenarioResults: Array<{
    label: PostureType;
    v0Detected: boolean;
    v2Detected: boolean;
    v0DelayMs: number | null;
    v2DelayMs: number | null;
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
  const finalMADUpdateCount = updateCounts.length > 0 ? Math.max(...updateCounts) : 0;

  return {
    v0,
    v2,
    normalFrameCount: comparisonEntries.filter((entry) => entry.groundTruth === "NORMAL_WORK").length,
    transientFrameCount: comparisonEntries.filter((entry) => entry.groundTruth === "TRANSIENT_ACTION").length,
    madUpdateCount: finalMADUpdateCount,
    finalMADUpdateCount,
    scenarioResults: scenarios.map((scenario) => {
      const v0Result = detectorResult(scenario, "v0PostureEvent");
      const v2Result = detectorResult(scenario, "v2PostureEvent");
      return {
        label: scenario.label,
        v0Detected: v0Result.detected,
        v2Detected: v2Result.detected,
        v0DelayMs: v0Result.delayMs,
        v2DelayMs: v2Result.delayMs,
      };
    }),
    notes: comparisonEntries.length === 0
      ? ["비교 데이터가 없습니다. MAD Comparison Session으로 새 로그를 기록하세요."]
      : [
        "V0는 초기 MAD를 고정하고, V2는 안정적인 정상 구간에서 MAD를 업데이트했습니다.",
        "정상 오탐 감소와 자세 탐지율을 함께 비교하세요.",
      ],
  };
}

export function formatMADComparisonReport(report: MADComparisonReport): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const delay = (value: number | null): string => value === null ? "n/a" : `${(value / 1000).toFixed(2)}s`;
  return [
    `정상 프레임: ${report.normalFrameCount}`,
    `자연 행동 프레임: ${report.transientFrameCount}`,
    `V2 MAD 업데이트 횟수: ${report.finalMADUpdateCount}`,
    "",
    `V0 탐지율: ${percent(report.v0.detectionRate)}, 평균 지연: ${delay(report.v0.averageDetectionDelayMs)}, 정상 오탐: ${report.v0.falseAlertCount}`,
    `V2 탐지율: ${percent(report.v2.detectionRate)}, 평균 지연: ${delay(report.v2.averageDetectionDelayMs)}, 정상 오탐: ${report.v2.falseAlertCount}`,
    "",
    ...report.scenarioResults.map((result) =>
      `${result.label}: V0 ${result.v0Detected ? "탐지" : "미탐지"} (${delay(result.v0DelayMs)}), ` +
      `V2 ${result.v2Detected ? "탐지" : "미탐지"} (${delay(result.v2DelayMs)})`,
    ),
    "",
    ...report.notes,
  ].join("\n");
}

type EventKey = "v0PostureEvent" | "v2PostureEvent";
interface ScenarioSlice {
  label: PostureType;
  entries: SessionLogEntry[];
}

function buildPostureScenarios(entries: readonly SessionLogEntry[]): ScenarioSlice[] {
  const result: ScenarioSlice[] = [];
  let current: ScenarioSlice | null = null;
  for (const entry of entries) {
    const label = entry.groundTruth;
    if (NON_POSTURE_LABELS.has(label)) {
      current = null;
      continue;
    }
    if (!current || current.label !== label) {
      current = { label: label as PostureType, entries: [] };
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
  const delays = results
    .map((result) => result.delayMs)
    .filter((value): value is number => value !== null);
  return {
    detectedScenarios: results.filter((result) => result.detected).length,
    totalScenarios: scenarios.length,
    detectionRate: scenarios.length === 0
      ? 0
      : results.filter((result) => result.detected).length / scenarios.length,
    averageDetectionDelayMs: delays.length === 0
      ? null
      : delays.reduce((sum, value) => sum + value, 0) / delays.length,
    falseAlertCount: countAlertRises(
      entries.filter((entry) => NON_POSTURE_LABELS.has(entry.groundTruth)),
      eventKey,
    ),
  };
}

function detectorResult(
  scenario: ScenarioSlice,
  eventKey: EventKey,
): { detected: boolean; delayMs: number | null } {
  const firstTimestamp = scenario.entries[0]?.timestamp ?? 0;
  const firstAlert = scenario.entries.find((entry) => entry.comparison?.[eventKey].alert);
  return {
    detected: firstAlert !== undefined,
    delayMs: firstAlert ? firstAlert.timestamp - firstTimestamp : null,
  };
}

function countAlertRises(entries: readonly SessionLogEntry[], eventKey: EventKey): number {
  let previous = false;
  let count = 0;
  for (const entry of entries) {
    const alert = entry.comparison?.[eventKey].alert ?? false;
    if (alert && !previous) count += 1;
    previous = alert;
  }
  return count;
}
