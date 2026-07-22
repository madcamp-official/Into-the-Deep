import { describe, expect, it } from "vitest";
import {
  getNextDevelopmentStep,
  STANDARD_DEVELOPMENT_SESSION,
} from "./index";

describe("development session preset", () => {
  it("walks through steps in timestamp order", () => {
    const first = getNextDevelopmentStep(STANDARD_DEVELOPMENT_SESSION, -1, 0);
    const second = getNextDevelopmentStep(
      STANDARD_DEVELOPMENT_SESSION,
      first?.index ?? -1,
      20,
    );

    expect(first?.step).toEqual({
      atSeconds: 0,
      action: "SCENARIO_STARTED",
      label: "NORMAL_WORK",
    });
    expect(second?.step).toEqual({
      atSeconds: 10,
      action: "SCENARIO_STARTED",
      label: "TRANSIENT_ACTION",
    });
  });

  it("does not advance before the next scheduled time", () => {
    expect(
      getNextDevelopmentStep(STANDARD_DEVELOPMENT_SESSION, 0, 0.5),
    ).toBeNull();
  });
});
