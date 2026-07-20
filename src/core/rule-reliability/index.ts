import type { LandmarkName, LandmarkQuality, PostureRule } from "../types";

export interface RuleReliabilityResult {
  canEvaluate: boolean;
  missingLandmarks: LandmarkName[];
  reason: string[];
}

// A missing optional landmark defers only the rules that depend on it. Other
// rules can continue to evaluate from the landmarks they require.
export function assessRuleReliability(
  rule: Pick<PostureRule, "postureType" | "requiredLandmarks">,
  quality: LandmarkQuality,
): RuleReliabilityResult {
  const reliable = new Set(quality.reliableLandmarks ?? []);
  const missingLandmarks = rule.requiredLandmarks.filter(
    (landmark) => !reliable.has(landmark),
  );

  if (missingLandmarks.length === 0) {
    return { canEvaluate: true, missingLandmarks: [], reason: [] };
  }

  return {
    canEvaluate: false,
    missingLandmarks,
    reason: [
      `${rule.postureType}_deferred_missing_landmarks:${missingLandmarks.join(",")}`,
    ],
  };
}
