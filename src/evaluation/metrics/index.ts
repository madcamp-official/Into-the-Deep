import type { DetectionEvent, ScenarioLabel } from "../../core/types";

export interface MetricsReport {
  falseAlertsPerHour: number;
  sustainedDriftDetectionRate: number;
  averageDetectionDelaySeconds: number;
}

// TODO(C): implement the three official/aux metrics from plan.md section 20:
// - false alerts per hour during NORMAL_WORK
// - sustained drift detection rate (alert within 10s of drift onset)
// - average detection delay
export function computeMetrics(
  events: DetectionEvent[],
  groundTruth: ScenarioLabel[],
): MetricsReport {
  void events;
  void groundTruth;
  throw new Error("not implemented");
}
