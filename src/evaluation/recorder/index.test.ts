import { describe, expect, it } from "vitest";
import { labelsFromEntries, SessionRecorder } from "./index";
import type { FrameFeature } from "../../core/types";

describe("SessionRecorder development markers", () => {
  it("keeps scenario markers and the active ground-truth label in JSON entries", () => {
    const recorder = new SessionRecorder();
    recorder.start();
    recorder.mark({
      timestamp: 100,
      type: "SCENARIO_STARTED",
      label: "FORWARD_LEAN",
    });
    recorder.record(createFeature(110), "SETTLING", "UNKNOWN");
    recorder.mark({
      timestamp: 500,
      type: "DRIFT_ONSET",
      label: "FORWARD_LEAN",
    });
    recorder.record(createFeature(510), "FORWARD_LEAN", "UNKNOWN");
    recorder.mark({
      timestamp: 1000,
      type: "SCENARIO_ENDED",
      label: "FORWARD_LEAN",
    });
    const entries = recorder.stop();

    expect(entries[0].markers).toEqual([
      { timestamp: 100, type: "SCENARIO_STARTED", label: "FORWARD_LEAN" },
    ]);
    expect(entries[1].markers).toEqual([
      { timestamp: 500, type: "DRIFT_ONSET", label: "FORWARD_LEAN" },
      { timestamp: 1000, type: "SCENARIO_ENDED", label: "FORWARD_LEAN" },
    ]);
    expect(labelsFromEntries(entries)).toEqual([
      { timestamp: 100, label: "SETTLING" },
      { timestamp: 500, label: "FORWARD_LEAN" },
      { timestamp: 1000, label: "NORMAL_WORK" },
    ]);
  });
});

function createFeature(timestamp: number): FrameFeature {
  return {
    timestamp,
    confidence: 0.95,
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    motionEnergy: 0,
  };
}
