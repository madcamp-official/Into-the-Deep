import type { FeatureVector } from "../../core/types";
import {
  calculateMAD,
  DEFAULT_MAD_VALUES,
  MAD_FEATURES,
} from "../../core/mad-profile";
import type { SessionLogEntry } from "../recorder";
import { DEFAULT_POSTURE_RULES } from "../../core/posture-rules";

export interface DevelopmentAnalysis {
  normalFrameCount: number;
  initialMAD: FeatureVector;
  minMAD: FeatureVector;
  maxMAD: FeatureVector;
  ruleThreshold: number;
  recommendedRuleThresholds: Record<string, number>;
  v2: {
    stableWindowMs: number;
    minStableDurationMs: number;
    alpha: number;
    motionEnergyThreshold: number;
  };
  notes: string[];
}

// This is a recommendation report, not a silent production configuration
// change. The developer reviews it and then supplies the values to V0/V2.
export function analyzeDevelopmentSession(
  entries: readonly SessionLogEntry[],
): DevelopmentAnalysis {
  const metadata = entries.find((entry) => entry.metadata)?.metadata;
  const normalEntries = entries.filter((entry) =>
    (metadata?.sessionType ?? "POSTURE") === "POSTURE" &&
    entry.groundTruth === "NORMAL_WORK",
  );
  const centers = metadata?.userProfile.originalCenters ?? {};
  const initialMAD: FeatureVector = { ...DEFAULT_MAD_VALUES };

  for (const feature of MAD_FEATURES) {
    const center = centers[feature];
    if (center === undefined) continue;
    const values = normalEntries
      .map((entry) => entry.features[feature])
      .filter((value): value is number => typeof value === "number");
    const mad = calculateMAD(values, center);
    if (mad !== undefined && mad > 0) initialMAD[feature] = mad;
  }

  const minMAD = scaleValues(initialMAD, 0.5);
  const maxMAD = scaleValues(initialMAD, 4);
  const recommendedRuleThresholds = Object.fromEntries(
    DEFAULT_POSTURE_RULES.map((rule) => {
      const conditions = [...rule.required, ...(rule.anyOf ?? [])];
      const normalScores = conditions.flatMap((condition) =>
        normalEntries.flatMap((entry) => {
          const value = entry.features[condition.feature];
          const center = centers[condition.feature];
          const mad = initialMAD[condition.feature];
          if (typeof value !== "number" || center === undefined || mad === undefined || mad <= 0) return [];
          return [Math.abs((value - center) / mad)];
        }),
      );
      const normalP95 = percentile(normalScores, 0.95);
      return [rule.postureType, clamp(Math.max(1.5, normalP95 * 1.25), 1.5, 3.5)];
    }),
  );
  return {
    normalFrameCount: normalEntries.length,
    initialMAD,
    minMAD,
    maxMAD,
    ruleThreshold: 2,
    recommendedRuleThresholds,
    v2: {
      stableWindowMs: 5000,
      minStableDurationMs: 3000,
      alpha: 0.95,
      motionEnergyThreshold: 1.0,
    },
    notes: [
      "Use this report to review V0 values before fixing them.",
      "For a common MAD, combine reports from multiple users and take the median per feature.",
      "V0 keeps these values fixed; V2 starts with them and updates during stable windows.",
      normalEntries.length < 100
        ? "Normal sample is short; collect more posture-session normal frames before finalizing values."
        : "Normal sample size is sufficient for an initial threshold review.",
    ],
  };
}

function percentile(values: readonly number[], proportion: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * proportion))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scaleValues(values: FeatureVector, factor: number): FeatureVector {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Math.max(value * factor, Number.EPSILON)]),
  );
}
