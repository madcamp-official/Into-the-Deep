import { describe, expect, it } from "vitest";
import { generateFeedback } from "./index";
import type { DetectionEvent } from "../types";

function event(overrides: Partial<DetectionEvent>): DetectionEvent {
  return { timestamp: 0, state: "STABLE", alert: false, reason: [], ...overrides };
}

describe("generateFeedback", () => {
  it("shows no message and no guideline while STABLE", () => {
    const feedback = generateFeedback(event({ state: "STABLE" }));
    expect(feedback).toMatchObject({ alert: false, guidelineVisible: false, message: "" });
  });

  it("stays quiet during a brief DRIFT_SUSPECTED blip (no guideline yet)", () => {
    const feedback = generateFeedback(event({ state: "DRIFT_SUSPECTED", reason: ["shoulderTilt"] }));
    expect(feedback).toMatchObject({ alert: false, guidelineVisible: false, message: "" });
    expect(feedback.dominantFeatures).toEqual(["shoulderTilt"]);
  });

  it("shows the guideline and a feature-specific message once SUSTAINED_DRIFT", () => {
    const feedback = generateFeedback(event({ state: "SUSTAINED_DRIFT", reason: ["bodyScale"] }));
    expect(feedback.guidelineVisible).toBe(true);
    expect(feedback.alert).toBe(false);
    expect(feedback.message).toBe("상체가 기준보다 카메라에 가까워졌습니다.");
  });

  it("raises alert:true with a combined message for ALERTED with multiple dominant features", () => {
    const feedback = generateFeedback(event({ state: "ALERTED", reason: ["shoulderYOffset", "bodyScale"] }));
    expect(feedback).toMatchObject({ alert: true, guidelineVisible: true });
    expect(feedback.message).toContain("어깨 높이가 기준보다 달라졌습니다.");
    expect(feedback.message).toContain("상체가 기준보다 카메라에 가까워졌습니다.");
  });

  it("falls back to a generic message for a feature not yet in the phrase map", () => {
    const feedback = generateFeedback(event({ state: "ALERTED", reason: ["torsoRotationProxy"] }));
    expect(feedback.message).toBe("자세가 기준에서 벗어났습니다.");
  });

  it("dedupes repeated phrases instead of repeating the generic fallback", () => {
    const feedback = generateFeedback(event({ state: "ALERTED", reason: ["unknownA", "unknownB"] }));
    expect(feedback.message).toBe("자세가 기준에서 벗어났습니다.");
  });

  it("shows a positive message with no guideline on RECOVERED", () => {
    const feedback = generateFeedback(event({ state: "RECOVERED", reason: ["shoulderTilt"] }));
    expect(feedback).toMatchObject({ alert: false, guidelineVisible: false, message: "자세가 기준으로 돌아왔습니다." });
    expect(feedback.dominantFeatures).toEqual([]);
  });
});
