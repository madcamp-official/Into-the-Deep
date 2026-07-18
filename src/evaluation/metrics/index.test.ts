import { describe, expect, it } from "vitest";
import type { DetectionEvent, ScenarioLabel } from "../../core/types";
import { computeMetrics } from "./index";

function event(timestamp: number, alert: boolean): DetectionEvent {
  return { timestamp, state: alert ? "BAD" : "STABLE", alert, reason: alert ? ["shoulderTilt"] : [] };
}

describe("computeMetrics", () => {
  // Regression test: timestamps here are milliseconds, like a real session
  // recorded via performance.now(). Before this fix, computeDriftDetection
  // compared ms differences directly against DETECTION_WINDOW_SECONDS (10),
  // a ~10ms window instead of 10s, so a drift detected 2s after onset was
  // wrongly scored as "not detected".
  it("detects a drift episode that starts a few seconds after drift onset", () => {
    const groundTruth: ScenarioLabel[] = [
      { timestamp: 0, label: "NORMAL_WORK" },
      { timestamp: 10_000, label: "FORWARD_LEAN" },
      { timestamp: 20_000, label: "NORMAL_WORK" },
    ];
    const events: DetectionEvent[] = [
      event(0, false),
      event(10_000, false),
      event(12_000, true), // alert fires 2s after drift onset
      event(13_000, true),
      event(20_000, false),
    ];

    const metrics = computeMetrics(events, groundTruth, 25_000);

    expect(metrics.sustainedDriftDetectionRate).toBe(1);
    expect(metrics.averageDetectionDelaySeconds).toBeCloseTo(2, 5);
  });

  it("does not credit a detection more than DETECTION_WINDOW_SECONDS after drift onset", () => {
    const groundTruth: ScenarioLabel[] = [
      { timestamp: 0, label: "NORMAL_WORK" },
      { timestamp: 10_000, label: "FORWARD_LEAN" },
      { timestamp: 20_000, label: "NORMAL_WORK" },
    ];
    const events: DetectionEvent[] = [
      event(0, false),
      event(10_000, false),
      event(21_500, true), // 11.5s after drift onset, outside the 10s window
      event(22_000, false),
    ];

    const metrics = computeMetrics(events, groundTruth, 25_000);

    expect(metrics.sustainedDriftDetectionRate).toBe(0);
  });

  it("reports false alerts per hour on a realistic (seconds-scale) session length", () => {
    const groundTruth: ScenarioLabel[] = [{ timestamp: 0, label: "NORMAL_WORK" }];
    // One false-alert episode in a 10-second NORMAL_WORK window.
    const events: DetectionEvent[] = [
      event(0, false),
      event(2_000, true),
      event(3_000, false),
    ];

    const metrics = computeMetrics(events, groundTruth, 10_000);

    // 1 episode / (10s / 3600s-per-hour) = 360/hour.
    expect(metrics.falseAlertsPerHour).toBeCloseTo(360, 5);
  });
});
