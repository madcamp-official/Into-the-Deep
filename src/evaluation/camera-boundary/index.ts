import type { CameraTransform, ScenarioLabel } from "../../core/types";
import type { SessionLogEntry } from "../recorder";

type BoundaryCategory = "NO_ADJUSTMENT" | "ADJUSTMENT_POSSIBLE" | "REMEASUREMENT_REQUIRED";

export interface CameraBoundaryScenarioResult {
  label: ScenarioLabel["label"];
  unit: string;
  sampleCount: number;
  noAdjustmentMax: number | null;
  adjustmentMin: number | null;
  adjustmentMax: number | null;
  remeasurementMin: number | null;
  noAdjustmentSamples: number;
  adjustmentSamples: number;
  remeasurementSamples: number;
  unknownSamples: number;
}

export interface CameraBoundaryMetrics {
  sessionType: "CAMERA_BOUNDARY";
  frameCount: number;
  scenarios: CameraBoundaryScenarioResult[];
  notes: string[];
}

const CAMERA_BOUNDARY_LABELS = new Set<ScenarioLabel["label"]>([
  "CAMERA_TRANSLATION_X",
  "CAMERA_TRANSLATION_Y",
  "CAMERA_ROLL",
  "CAMERA_YAW_LEFT",
  "CAMERA_YAW_RIGHT",
  "CAMERA_PITCH_UP",
  "CAMERA_PITCH_DOWN",
  "CAMERA_SCALE",
]);

export function analyzeCameraBoundarySession(
  entries: readonly SessionLogEntry[],
): CameraBoundaryMetrics {
  const metadata = entries.find((entry) => entry.metadata)?.metadata;
  if (metadata?.sessionType !== "CAMERA_BOUNDARY") {
    throw new Error("카메라 경계 분석에는 CAMERA_BOUNDARY 세션 로그가 필요합니다.");
  }

  const starts = entries.flatMap((entry) =>
    (entry.markers ?? []).filter(
      (marker) => marker.type === "SCENARIO_STARTED" && CAMERA_BOUNDARY_LABELS.has(marker.label),
    ),
  );

  return {
    sessionType: "CAMERA_BOUNDARY",
    frameCount: entries.length,
    scenarios: starts.map((marker) => analyzeScenario(entries, marker.label, marker.timestamp)),
    notes: [
      "정상 자세인데 V0 알림이 없고 CameraState가 VALID이면 보정 불필요 샘플로 분류했습니다.",
      "정상 자세인데 CameraState가 ADJUSTED이고 V0 알림이 없으면 보정 가능 샘플로 분류했습니다.",
      "보정 후에도 V0 알림이 있거나 CameraState가 RECALIBRATION_REQUIRED이면 재측정 필요 샘플로 분류했습니다.",
      "경계값은 해당 범주에서 관측된 변화량의 최댓값 또는 최솟값입니다. 반복 세션으로 안정성을 확인해야 합니다.",
    ],
  };
}

export function formatCameraBoundaryMetrics(report: CameraBoundaryMetrics): string {
  const lines = [
    "카메라 경계 탐색 결과",
    `전체 프레임: ${report.frameCount}`,
    "",
    "시나리오 | 단위 | 보정 불필요 최대 | 보정 가능 범위 | 재측정 필요 시작 | 샘플 수",
    "--- | --- | --- | --- | --- | ---",
  ];

  for (const scenario of report.scenarios) {
    const adjustmentRange = scenario.adjustmentMin === null || scenario.adjustmentMax === null
      ? "자료 없음"
      : `${formatValue(scenario.adjustmentMin)} ~ ${formatValue(scenario.adjustmentMax)}`;
    lines.push(
      `${scenario.label} | ${scenario.unit} | ${formatNullable(scenario.noAdjustmentMax)} | ` +
      `${adjustmentRange} | ${formatNullable(scenario.remeasurementMin)} | ${scenario.sampleCount}`,
    );
  }

  lines.push("", ...report.notes);
  return lines.join("\n");
}

function analyzeScenario(
  entries: readonly SessionLogEntry[],
  label: ScenarioLabel["label"],
  startedAt: number,
): CameraBoundaryScenarioResult {
  const changeMarker = entries
    .flatMap((entry) => entry.markers ?? [])
    .find((marker) => marker.type === "CHANGE_ONSET" && marker.label === label && marker.timestamp >= startedAt);
  const endMarker = entries
    .flatMap((entry) => entry.markers ?? [])
    .find((marker) => marker.type === "SCENARIO_ENDED" && marker.label === label && marker.timestamp >= startedAt);
  const start = changeMarker?.timestamp ?? startedAt;
  const end = endMarker?.timestamp ?? Number.POSITIVE_INFINITY;
  const segment = entries.filter((entry) => entry.timestamp >= start && entry.timestamp <= end);
  const values = segment
    .map((entry) => {
      const transform = entry.cameraAssessment?.transform ?? entry.cameraTransform;
      if (!transform || !entry.postureEvent) return null;
      const category = classify(entry);
      if (!category) return null;
      return { value: scenarioMagnitude(label, transform), category };
    })
    .filter((sample): sample is { value: number; category: BoundaryCategory } => sample !== null);

  const noAdjustment = values.filter((sample) => sample.category === "NO_ADJUSTMENT").map((sample) => sample.value);
  const adjustment = values.filter((sample) => sample.category === "ADJUSTMENT_POSSIBLE").map((sample) => sample.value);
  const remeasurement = values.filter((sample) => sample.category === "REMEASUREMENT_REQUIRED").map((sample) => sample.value);
  const measuredCount = segment.filter((entry) => entry.postureEvent).length;

  return {
    label,
    unit: scenarioUnit(label),
    sampleCount: measuredCount,
    noAdjustmentMax: max(noAdjustment),
    adjustmentMin: min(adjustment),
    adjustmentMax: max(adjustment),
    remeasurementMin: min(remeasurement),
    noAdjustmentSamples: noAdjustment.length,
    adjustmentSamples: adjustment.length,
    remeasurementSamples: remeasurement.length,
    unknownSamples: Math.max(0, measuredCount - values.length),
  };
}

function classify(entry: SessionLogEntry): BoundaryCategory | null {
  const state = entry.cameraAssessment?.state ?? entry.cameraState;
  const alert = entry.postureEvent?.alert === true;
  if (state === "VALID" && !alert) return "NO_ADJUSTMENT";
  if (state === "ADJUSTED" && !alert) return "ADJUSTMENT_POSSIBLE";
  if (state === "RECALIBRATION_REQUIRED" || (state === "ADJUSTED" && alert)) {
    return "REMEASUREMENT_REQUIRED";
  }
  return null;
}

function scenarioMagnitude(label: ScenarioLabel["label"], transform: CameraTransform): number {
  switch (label) {
    case "CAMERA_TRANSLATION_X": return Math.abs(transform.translationX);
    case "CAMERA_TRANSLATION_Y": return Math.abs(transform.translationY);
    case "CAMERA_ROLL": return Math.abs(transform.roll);
    case "CAMERA_YAW_LEFT":
    case "CAMERA_YAW_RIGHT": return Math.abs(transform.yawProxy ?? 0);
    case "CAMERA_PITCH_UP":
    case "CAMERA_PITCH_DOWN": return Math.abs(transform.pitchProxy ?? 0);
    case "CAMERA_SCALE": return Math.abs(transform.scale);
    default: return 0;
  }
}

function scenarioUnit(label: ScenarioLabel["label"]): string {
  if (label === "CAMERA_ROLL") return "radian";
  if (label === "CAMERA_YAW_LEFT" || label === "CAMERA_YAW_RIGHT") return "yaw proxy";
  if (label === "CAMERA_PITCH_UP" || label === "CAMERA_PITCH_DOWN") return "pitch proxy";
  if (label === "CAMERA_SCALE") return "비율";
  return "정규화 좌표";
}

function min(values: number[]): number | null {
  return values.length > 0 ? Math.min(...values) : null;
}

function max(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null;
}

function formatNullable(value: number | null): string {
  return value === null ? "자료 없음" : formatValue(value);
}

function formatValue(value: number): string {
  return value.toFixed(4);
}
