import type {
  DetectionEvent,
  FrameFeature,
  LandmarkQuality,
  MADProfile,
  PostureFeatureName,
  PostureRule,
  UserProfile,
} from "../types";
import { normalizeFeature } from "../mad-profile";
import { assessRuleReliability } from "../rule-reliability";
import { DEFAULT_POSTURE_RULES } from "../posture-rules";

export interface PostureRuleDetectorOptions {
  rules?: readonly PostureRule[];
  sustainedSeconds?: number;
}

export interface RuleMatch {
  postureType: PostureRule["postureType"];
  matchedFeatures: PostureFeatureName[];
  reason: string;
}

export class PostureRuleDetector {
  private badStartedAt: number | null = null;
  private readonly rules: readonly PostureRule[];
  private readonly sustainedSeconds: number;
  private readonly profile: UserProfile;
  private madProfile: MADProfile;

  constructor(
    profile: UserProfile,
    madProfile: MADProfile,
    options: PostureRuleDetectorOptions = {},
  ) {
    this.profile = profile;
    this.madProfile = madProfile;
    this.rules = options.rules ?? DEFAULT_POSTURE_RULES;
    this.sustainedSeconds = options.sustainedSeconds ?? 1.5;
  }

  update(feature: FrameFeature, quality?: LandmarkQuality): DetectionEvent {
    const matches = evaluatePostureRules(feature, this.profile, this.madProfile, this.rules, quality);
    if (matches.length === 0) {
      this.badStartedAt = null;
      return { timestamp: feature.timestamp, state: "STABLE", alert: false, reason: [] };
    }

    if (this.badStartedAt === null || feature.timestamp < this.badStartedAt) {
      this.badStartedAt = feature.timestamp;
    }
    const sustained = (feature.timestamp - this.badStartedAt) / 1000 >= this.sustainedSeconds;
    const first = matches[0];
    return {
      timestamp: feature.timestamp,
      state: "BAD",
      alert: sustained,
      postureType: first.postureType,
      matchedFeatures: first.matchedFeatures,
      reason: matches.map((match) => `${match.postureType}: ${match.reason}`),
    };
  }

  reset(): void {
    this.badStartedAt = null;
  }

  setMADProfile(profile: MADProfile): void {
    this.madProfile = profile;
  }
}

export function evaluatePostureRules(
  feature: FrameFeature,
  profile: UserProfile,
  madProfile: MADProfile,
  rules: readonly PostureRule[] = DEFAULT_POSTURE_RULES,
  quality?: LandmarkQuality,
): RuleMatch[] {
  const matches: RuleMatch[] = [];
  for (const rule of rules) {
    if (quality && !assessRuleReliability(rule, quality).canEvaluate) continue;
    const required = rule.required.every((condition) => evaluateCondition(feature, profile, madProfile, condition));
    const optional = !rule.anyOf || rule.anyOf.some((condition) => evaluateCondition(feature, profile, madProfile, condition));
    if (!required || !optional) continue;
    matches.push({
      postureType: rule.postureType,
      matchedFeatures: [...rule.required.map((condition) => condition.feature), ...(rule.anyOf?.map((condition) => condition.feature) ?? [])],
      reason: rule.reason,
    });
  }
  return matches;
}

function evaluateCondition(
  feature: FrameFeature,
  profile: UserProfile,
  madProfile: MADProfile,
  condition: PostureRule["required"][number],
): boolean {
  const value = feature[condition.feature];
  if (value === undefined) return false;
  const center = condition.reference === "CALIBRATION" ? profile.originalCenters[condition.feature] : 0;
  const normalized = normalizeFeature(value, center, madProfile.values[condition.feature]);
  if (normalized === undefined) return false;
  switch (condition.operator) {
    case "GT": return normalized > condition.threshold;
    case "GTE": return normalized >= condition.threshold;
    case "LT": return normalized < condition.threshold;
    case "LTE": return normalized <= condition.threshold;
    case "ABS_GT": return Math.abs(normalized) > condition.threshold;
    case "ABS_LT": return Math.abs(normalized) < condition.threshold;
  }
}
