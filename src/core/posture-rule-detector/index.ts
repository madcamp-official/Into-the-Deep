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

const AMBIGUITY_RATIO = 0.9;

export interface PostureRuleDetectorOptions {
  rules?: readonly PostureRule[];
  sustainedSeconds?: number;
}

export interface RuleMatch {
  postureType: PostureRule["postureType"];
  matchedFeatures: PostureFeatureName[];
  reason: string;
  score: number;
}

export class PostureRuleDetector {
  private badStartedAtByPosture = new Map<PostureRule["postureType"], number>();
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
      this.badStartedAtByPosture.clear();
      return { timestamp: feature.timestamp, state: "STABLE", alert: false, reason: [] };
    }

    const selected = matches[0];
    const runnerUp = matches[1];
    if (runnerUp && runnerUp.score >= selected.score * AMBIGUITY_RATIO) {
      this.badStartedAtByPosture.clear();
      return {
        timestamp: feature.timestamp,
        state: "UNKNOWN",
        alert: false,
        postureCandidates: matches.map(({ postureType, score }) => ({ postureType, score })),
        reason: [`ambiguous_posture:${selected.postureType},${runnerUp.postureType}`],
      };
    }
    const selectedStartedAt = this.badStartedAtByPosture.get(selected.postureType);
    if (selectedStartedAt === undefined || feature.timestamp < selectedStartedAt) {
      this.badStartedAtByPosture.set(selected.postureType, feature.timestamp);
    }
    for (const match of matches.slice(1)) {
      this.badStartedAtByPosture.delete(match.postureType);
    }
    const sustained =
      (feature.timestamp - (this.badStartedAtByPosture.get(selected.postureType) ?? feature.timestamp)) /
        1000 >=
      this.sustainedSeconds;
    return {
      timestamp: feature.timestamp,
      state: "BAD",
      alert: sustained,
      postureType: selected.postureType,
      matchedFeatures: selected.matchedFeatures,
      postureCandidates: matches.map(({ postureType, score }) => ({ postureType, score })),
      reason: matches.map((match) => `${match.postureType}: ${match.reason}`),
    };
  }

  reset(): void {
    this.badStartedAtByPosture.clear();
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
    const requiredScores = rule.required.map((condition) =>
      scoreCondition(feature, profile, madProfile, condition),
    );
    const optionalScores = rule.anyOf?.map((condition) =>
      scoreCondition(feature, profile, madProfile, condition),
    );
    const required = requiredScores.every((score) => score !== undefined && score >= 1);
    const optional = !optionalScores || optionalScores.some((score) => score !== undefined && score >= 1);
    if (!required || !optional) continue;
    const requiredScore = requiredScores.length > 0
      ? Math.min(...requiredScores.filter(isDefined))
      : 1;
    const anyOfScore = optionalScores ? Math.max(...optionalScores.filter(isDefined), 1) : 1;
    const evidenceScore = requiredScore * 0.7 + anyOfScore * 0.3;
    matches.push({
      postureType: rule.postureType,
      matchedFeatures: [...rule.required.map((condition) => condition.feature), ...(rule.anyOf?.map((condition) => condition.feature) ?? [])],
      reason: rule.reason,
      score: evidenceScore * (rule.priority ?? 1),
    });
  }
  return matches.sort((left, right) => right.score - left.score);
}

function scoreCondition(
  feature: FrameFeature,
  profile: UserProfile,
  madProfile: MADProfile,
  condition: PostureRule["required"][number],
): number | undefined {
  const value = feature[condition.feature];
  if (value === undefined) return undefined;
  const center = condition.reference === "CALIBRATION" ? profile.originalCenters[condition.feature] : 0;
  const normalized = normalizeFeature(value, center, madProfile.values[condition.feature]);
  if (normalized === undefined) return undefined;
  switch (condition.operator) {
    case "GT": return normalized / condition.threshold;
    case "GTE": return normalized / condition.threshold;
    case "LT": return normalized / condition.threshold;
    case "LTE": return normalized / condition.threshold;
    case "ABS_GT": return Math.abs(normalized) / condition.threshold;
    case "ABS_LT": return Math.min(2, condition.threshold / Math.max(Math.abs(normalized), Number.EPSILON));
  }
}

function isDefined(value: number | undefined): value is number {
  return value !== undefined;
}
