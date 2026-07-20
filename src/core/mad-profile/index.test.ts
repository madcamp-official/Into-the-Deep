import { describe, expect, it } from "vitest";
import {
  calculateMAD,
  createInitialMADProfile,
  normalizeFeature,
  updateMADProfile,
} from "./index";

describe("MAD profile", () => {
  it("calculates a robust feature spread and normalizes by that feature's MAD", () => {
    expect(calculateMAD([0.09, 0.1, 0.1, 0.11, 0.12])).toBeCloseTo(0.01);
    expect(normalizeFeature(0.13, 0.1, 0.01)).toBeCloseTo(3);
  });

  it("updates MAD with EWMA and clamps to feature bounds", () => {
    const profile = createInitialMADProfile({
      now: 100,
      values: { headXRatio: 0.1 },
      min: { headXRatio: 0.05 },
      max: { headXRatio: 0.2 },
    });
    const updated = updateMADProfile(profile, { headXRatio: 0.2 }, 0.95, 200);
    expect(updated.values.headXRatio).toBeCloseTo(0.105);
    expect(updated.updateCount).toBe(1);
  });
});
