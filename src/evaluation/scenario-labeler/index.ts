import type { ScenarioLabel } from "../../core/types";

// A contiguous span where the ground truth label held steady, derived from
// the point-in-time ScenarioLabel[] the labeler records.
export interface ScenarioEvent {
  label: ScenarioLabel["label"];
  startTimestamp: number;
  endTimestamp: number;
}

// Day2 scenario labeling tool (plan.md section 18/19). Test sessions call
// setLabel() whenever the timer/scenario screen advances to the next
// segment (NORMAL_WORK, FORWARD_LEAN, ...); the resulting ScenarioLabel[]
// becomes the replay evaluator's ground truth.
export class ScenarioLabeler {
  private labels: ScenarioLabel[] = [];
  private current: ScenarioLabel["label"] = "NORMAL_WORK";

  setLabel(timestamp: number, label: ScenarioLabel["label"]): void {
    if (label === this.current && this.labels.length > 0) return;
    this.current = label;
    this.labels.push({ timestamp, label });
  }

  reset(timestamp: number): void {
    this.labels = [{ timestamp, label: "NORMAL_WORK" }];
    this.current = "NORMAL_WORK";
  }

  getCurrentLabel(): ScenarioLabel["label"] {
    return this.current;
  }

  getLabels(): readonly ScenarioLabel[] {
    return this.labels;
  }
}

// Expands point-in-time labels into contiguous [start, end) segments so
// metrics can compute durations and per-event detection windows.
export function toScenarioEvents(
  labels: readonly ScenarioLabel[],
  sessionEndTimestamp: number,
): ScenarioEvent[] {
  const sorted = [...labels].sort((a, b) => a.timestamp - b.timestamp);

  return sorted.map((entry, index) => ({
    label: entry.label,
    startTimestamp: entry.timestamp,
    endTimestamp: sorted[index + 1]?.timestamp ?? sessionEndTimestamp,
  }));
}
