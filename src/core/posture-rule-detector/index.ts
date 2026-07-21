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
import { ALERT_TIMING } from "../temporal-state-machine";

const AMBIGUITY_RATIO = 0.9;

// HEAD_TURN fires constantly during normal conversation (turning to talk to
// someone off-camera), and user feedback flagged the resulting alarms as
// distracting during meetings. Still detected/recorded as BAD like any other
// posture — just never promoted to an alert. (The HEAD_TURN rule itself is
// currently commented out in posture-rules/index.ts, so this is a no-op
// until that's re-enabled — left in place so both fixes apply together
// then instead of this silently regressing.)
const SILENT_POSTURES: ReadonlySet<PostureRule["postureType"]> = new Set(["HEAD_TURN"]);

// motionEnergy is a raw single-frame delta of already-smoothed features
// (feature-normalizer's SMOOTHING_ALPHA is only 0.3), so landmark jitter
// alone regularly spikes it past any fixed gate even while holding a
// posture still — confirmed live twice now: a static ARMREST_LEAN hold
// spiked to 0.398 (above a 0.3 gate), while a genuine deliberate mouse-reach
// motion read as low as 0.190 in one transitional frame. A single frame's
// magnitude alone can't separate the two (the "still" ceiling sits above
// the "moving" floor), so gating requires the elevated reading to persist
// for a minimum duration instead: jitter is frame-to-frame noise that
// rarely stays above the gate for multiple consecutive frames, while a real
// reach/lean motion does.
const DEFAULT_MOTION_SUSTAIN_MS = 250;

// A held bad posture can drop out of every rule's required conditions for a
// single frame purely from landmark jitter nudging a score just under its
// threshold — previously that immediately cleared the dwell timer and
// reported STABLE ("정상 자세로 오탐"), even though the posture never
// actually changed. Tolerate a brief no-match gap (holding the last known
// match instead of clearing) and only treat it as a genuine return to
// normal once the gap outlasts this window.
//
// Raised 300 -> 800: a genuine bad-posture-to-normal transition should
// require sustained non-matching too, not just long enough to bridge
// single-frame jitter.
const DEFAULT_NO_MATCH_GRACE_MS = 800;

export interface PostureRuleDetectorOptions {
  rules?: readonly PostureRule[];
  sustainedSeconds?: number;
  // feature_discussion 0번 global motionEnergy gate: while motionEnergy stays
  // at/above this continuously for motionSustainMs, hold judgment for the
  // frame instead of evaluating rules (transient motion like reaching for a
  // mouse shouldn't reset or advance a dwell timer). Undefined disables the
  // gate entirely — used for the v0 detector instance so it stays a pure
  // per-frame baseline for comparison.
  motionEnergyGate?: number;
  // How long motionEnergy must stay continuously at/above motionEnergyGate
  // before a frame counts as genuine motion rather than single-frame
  // landmark jitter. Only meaningful when motionEnergyGate is set.
  motionSustainMs?: number;
  // How long a rule can stop matching before the dwell timer actually
  // clears and the detector reports STABLE. Bridges single-frame jitter
  // dropouts during an otherwise-held bad posture.
  noMatchGraceMs?: number;
}

export interface RuleMatch {
  postureType: PostureRule["postureType"];
  matchedFeatures: PostureFeatureName[];
  reason: string;
  score: number;
}

export class PostureRuleDetector {
  private badStartedAtByPosture = new Map<PostureRule["postureType"], number>();
  private motionHoldStartedAt: number | null = null;
  private motionStreakStartedAt: number | null = null;
  private noMatchStartedAt: number | null = null;
  private lastMatch: RuleMatch | null = null;
  private readonly rules: readonly PostureRule[];
  private readonly sustainedSeconds: number;
  private readonly motionEnergyGate: number | undefined;
  private readonly motionSustainMs: number;
  private readonly noMatchGraceMs: number;
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
    this.motionEnergyGate = options.motionEnergyGate;
    this.motionSustainMs = options.motionSustainMs ?? DEFAULT_MOTION_SUSTAIN_MS;
    this.noMatchGraceMs = options.noMatchGraceMs ?? DEFAULT_NO_MATCH_GRACE_MS;
  }

  update(feature: FrameFeature, quality?: LandmarkQuality): DetectionEvent {
    if (this.motionEnergyGate !== undefined) {
      const aboveGate = feature.motionEnergy >= this.motionEnergyGate;
      this.motionStreakStartedAt = aboveGate ? (this.motionStreakStartedAt ?? feature.timestamp) : null;
      const isMoving =
        aboveGate && feature.timestamp - (this.motionStreakStartedAt ?? feature.timestamp) >= this.motionSustainMs;
      if (isMoving) {
        const holdStartedAt = this.motionHoldStartedAt ?? feature.timestamp;
        this.motionHoldStartedAt = holdStartedAt;
        // Held too long: this is no longer "brief motion during a sustained bad
        // posture" — drop the dwell timers so a stale pre-motion streak can't
        // silently count the whole moving interval toward sustained/alert.
        if (feature.timestamp - holdStartedAt >= ALERT_TIMING.holdResetSec * 1000) {
          this.badStartedAtByPosture.clear();
        }
        return { timestamp: feature.timestamp, state: "MOVING", alert: false, reason: [] };
      }
      this.motionHoldStartedAt = null;
    }

    const matches = evaluatePostureRules(feature, this.profile, this.madProfile, this.rules, quality);
    if (matches.length === 0) {
      const graceStartedAt = this.noMatchStartedAt ?? feature.timestamp;
      this.noMatchStartedAt = graceStartedAt;
      if (feature.timestamp - graceStartedAt < this.noMatchGraceMs && this.lastMatch) {
        return this.buildBadEvent(feature, this.lastMatch, [this.lastMatch]);
      }
      this.badStartedAtByPosture.clear();
      this.lastMatch = null;
      return { timestamp: feature.timestamp, state: "STABLE", alert: false, reason: [] };
    }
    this.noMatchStartedAt = null;

    const selected = matches[0];
    const runnerUp = matches[1];
    if (runnerUp && runnerUp.score >= selected.score * AMBIGUITY_RATIO) {
      this.badStartedAtByPosture.clear();
      this.lastMatch = null;
      return {
        timestamp: feature.timestamp,
        state: "UNKNOWN",
        alert: false,
        postureCandidates: matches.map(({ postureType, score }) => ({ postureType, score })),
        reason: [`ambiguous_posture:${selected.postureType},${runnerUp.postureType}`],
      };
    }
    this.lastMatch = selected;
    return this.buildBadEvent(feature, selected, matches);
  }

  private buildBadEvent(feature: FrameFeature, selected: RuleMatch, matches: RuleMatch[]): DetectionEvent {
    const selectedStartedAt = this.badStartedAtByPosture.get(selected.postureType);
    if (selectedStartedAt === undefined || feature.timestamp < selectedStartedAt) {
      this.badStartedAtByPosture.set(selected.postureType, feature.timestamp);
    }
    for (const match of matches) {
      if (match.postureType !== selected.postureType) {
        this.badStartedAtByPosture.delete(match.postureType);
      }
    }
    const sustained =
      (feature.timestamp - (this.badStartedAtByPosture.get(selected.postureType) ?? feature.timestamp)) /
        1000 >=
      this.sustainedSeconds;
    return {
      timestamp: feature.timestamp,
      state: "BAD",
      alert: sustained && !SILENT_POSTURES.has(selected.postureType),
      postureType: selected.postureType,
      matchedFeatures: selected.matchedFeatures,
      postureCandidates: matches.map(({ postureType, score }) => ({ postureType, score })),
      reason: matches.map((match) => `${match.postureType}: ${match.reason}`),
    };
  }

  reset(): void {
    this.badStartedAtByPosture.clear();
    this.noMatchStartedAt = null;
    this.lastMatch = null;
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
