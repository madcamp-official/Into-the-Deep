import type { FeatureVector } from "../../core/types";
import {
  calculateMAD,
  DEFAULT_MAD_VALUES,
  MAD_FEATURES,
} from "../../core/mad-profile";
import type { SessionLogEntry } from "../recorder";

export interface DevelopmentAnalysis {
  normalFrameCount: number;
  initialMAD: FeatureVector;
  minMAD: FeatureVector;
  maxMAD: FeatureVector;
  ruleThreshold: number;
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
  const normalEntries = entries.filter((entry) => entry.groundTruth === "NORMAL_WORK");
  const metadata = entries.find((entry) => entry.metadata)?.metadata;
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
  return {
    normalFrameCount: normalEntries.length,
    initialMAD,
    minMAD,
    maxMAD,
    ruleThreshold: 2,
    v2: {
      stableWindowMs: 5000,
      minStableDurationMs: 3000,
      alpha: 0.95,
      motionEnergyThreshold: 0.08,
    },
    notes: [
      "Use this report to review V0 values before fixing them.",
      "For a common MAD, combine reports from multiple users and take the median per feature.",
      "V0 keeps these values fixed; V2 starts with them and updates during stable windows.",
    ],
  };
}

function scaleValues(values: FeatureVector, factor: number): FeatureVector {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Math.max(value * factor, Number.EPSILON)]),
  );
}
