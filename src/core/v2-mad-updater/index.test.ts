import { describe, expect, it } from "vitest";
import { createInitialMADProfile } from "../mad-profile";
import { V2MadUpdater } from "./index";
import type { FrameFeature } from "../types";

describe("V2MadUpdater", () => {
  it("updates only after a stable five-second window", () => {
    const profile = createInitialMADProfile({ values: { headXRatio: 0.1 } });
    const updater = new V2MadUpdater(profile, { alpha: 0.95 });
    const values = [0.1, 0.11, 0.09, 0.1, 0.12, 0.08];

    values.forEach((value, index) => {
      updater.update(createFrame(index * 1000, value), {
        landmarkQuality: { reliable: true, confidence: 0.95 },
      });
    });

    expect(updater.getProfile().updateCount).toBe(1);
    expect(updater.getProfile().values.headXRatio).toBeLessThan(0.1);
  });

  it("does not learn a matched posture", () => {
    const profile = createInitialMADProfile({ values: { headXRatio: 0.1 } });
    const updater = new V2MadUpdater(profile);
    updater.update(createFrame(0, 0.1), { matchedPosture: "FORWARD_HEAD" });
    updater.update(createFrame(6000, 0.2), { matchedPosture: "FORWARD_HEAD" });
    expect(updater.getProfile().updateCount).toBe(0);
  });
});

function createFrame(timestamp: number, headXRatio: number): FrameFeature {
  return {
    timestamp,
    confidence: 0.95,
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    motionEnergy: 0.01,
    headXRatio,
  };
}
