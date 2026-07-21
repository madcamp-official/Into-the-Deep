import type { LandmarkName, PostureRule } from "../types";

const CORE: LandmarkName[] = ["nose", "leftShoulder", "rightShoulder"];
const EYES: LandmarkName[] = [...CORE, "leftEye", "rightEye"];
const EARS: LandmarkName[] = [...EYES, "leftEar", "rightEar"];
const HANDS: LandmarkName[] = [...CORE, "leftWrist", "rightWrist"];

// Thresholds are normalized deviations (feature delta / feature MAD). They
// are intentionally conservative starting values for development-session tuning.
export const DEFAULT_POSTURE_RULES: readonly PostureRule[] = [
  {
    postureType: "FORWARD_HEAD",
    requiredLandmarks: EYES,
    // anyOf used to require headShoulderDistanceRatio > 2 OR pitchProxy >
    // 1.5 on top of faceToShoulderRatio. Confirmed live: on a genuinely
    // exaggerated turtle neck, headShoulderDistanceRatio's score came back
    // -13.54 — it shrinks (head visually drops toward the shoulder line
    // in 2D as it pushes toward the camera), the opposite of what the
    // anyOf gate assumed. faceToShoulderRatio alone is the clean, reliable
    // signal for turtle neck (craning toward the camera) specifically —
    // a pure head-down pitch with no lean-toward-camera component is a
    // different posture (HEAD_DOWN below), not this one.
    required: [
      { feature: "faceToShoulderRatio", operator: "GT", threshold: 1.2, reference: "CALIBRATION" },
    ],
    supporting: ["headShoulderDistanceRatio", "pitchProxy"],
    reason: "head is forward relative to the calibrated shoulder position",
  },
  {
    postureType: "HEAD_DOWN",
    requiredLandmarks: EYES,
    // Distinct from FORWARD_HEAD: confirmed live that holding the head
    // pitched down (chin toward chest, no craning toward the camera) read
    // as normal, because faceToShoulderRatio doesn't respond to pure
    // downward pitch. pitchProxy is the direct signal for that motion on
    // its own. feature_discussion's #14 ("고개 숙여서 아래 보기") lists this
    // as a *transient* action (writing, glancing down), but a *sustained*
    // hold of the same pitch is a distinct posture worth its own alert
    // rather than being silently absorbed into FORWARD_HEAD.
    required: [{ feature: "pitchProxy", operator: "GT", threshold: 1.5, reference: "CALIBRATION" }],
    supporting: ["headYRatio", "headShoulderDistanceRatio"],
    reason: "head is pitched down relative to the calibrated direction",
  },
  // SIDE_SHIFT intentionally omitted: shoulderXOffset is shoulderCenterX /
  // shoulderWidth — an absolute screen position divided by scale, not a
  // body-relative quantity. Sliding a chair (pure distance/position change,
  // camera untouched) moves this exactly like a real sideways shift would,
  // so it can't be judged as posture without also solving the environment/
  // camera-vs-posture disambiguation problem. Confirmed live: this rule
  // fired BAD on a chair move alone, the same false positive already fixed
  // twice today in fixed-threshold-detector/personalized-detector.
  // need_discussion #6 already decided chair movement shouldn't alert —
  // there's no currently-computed feature that captures "moved sideways"
  // in a genuinely body-relative way (feature_discussion only lists
  // absolute-position features — shoulderCenterX, globalTranslationX — for
  // this scenario), so this posture type stays unimplemented until one
  // exists.
  {
    postureType: "FORWARD_LEAN",
    requiredLandmarks: CORE,
    required: [{ feature: "forwardLeanProxy", operator: "GT", threshold: 2, reference: "CALIBRATION" }],
    supporting: ["bodyCompressionRatio", "headYRatio"],
    reason: "upper body is leaning forward",
  },
  {
    postureType: "BACKWARD_LEAN",
    requiredLandmarks: EYES,
    // Used forwardLeanProxy (= faceToShoulderRatio + pitchProxy, delta'd
    // together). Since pitchProxy is baked into that sum, a pure head-back
    // tilt (HEAD_BACK, no torso movement) drags forwardLeanProxy down too
    // and could fire this as if the whole body leaned back. Whole-body lean
    // is really about faceToShoulderRatio alone (face gets smaller as the
    // torso moves away) — using that directly instead of the combined
    // proxy keeps this independent of pure head-angle changes.
    required: [
      { feature: "faceToShoulderRatio", operator: "LT", threshold: -2.5, reference: "CALIBRATION" },
    ],
    supporting: ["headShoulderDistanceRatio", "headYRatio", "forwardLeanProxy"],
    reason: "upper body is leaning backward",
  },
  {
    postureType: "HEAD_TURN",
    requiredLandmarks: EARS,
    // yawProxy alone is noisy when the head is partially occluded or the
    // camera is slightly off-axis. A head tilt can also move the nose between
    // the ears, so require horizontal displacement and exclude a tilted head.
    required: [
      { feature: "headXRatio", operator: "ABS_GT", threshold: 3, reference: "CALIBRATION" },
      { feature: "headRoll", operator: "ABS_LT", threshold: 1.2, reference: "CALIBRATION" },
    ],
    anyOf: [
      { feature: "correctedYaw", operator: "ABS_GT", threshold: 5, reference: "CALIBRATION" },
      { feature: "yawProxy", operator: "ABS_GT", threshold: 5, reference: "CALIBRATION" },
    ],
    supporting: ["headXRatio", "yawProxy"],
    reason: "head direction differs from the calibrated direction",
    priority: 0.8,
  },
  {
    postureType: "HEAD_TILT",
    requiredLandmarks: EYES,
    // The posture session showed that 1.2 is inside the normal-work noise
    // range. Keep a moderate margin until more sessions are available.
    required: [{ feature: "headRoll", operator: "ABS_GT", threshold: 2.5, reference: "CALIBRATION" }],
    supporting: ["shoulderTilt"],
    reason: "head is tilted relative to the calibrated direction",
  },
  {
    postureType: "SHOULDER_ASYMMETRY",
    requiredLandmarks: CORE,
    required: [
      { feature: "shoulderTilt", operator: "ABS_GT", threshold: 2.5, reference: "CALIBRATION" },
    ],
    supporting: ["shoulderAsymmetry"],
    reason: "shoulder heights are asymmetric",
  },
  {
    postureType: "ROUNDED_SHOULDERS",
    // EYES, not just CORE: relativeShoulderScale (added below) needs eye
    // distance, so the rule should defer (not silently fail to match) when
    // eyes aren't reliable.
    requiredLandmarks: EYES,
    // shoulderWidthRatio alone (= raw shoulderWidth vs its calibration
    // value) can't tell "shoulders rounded forward" apart from "moved
    // farther from the camera" — both shrink shoulderWidth identically.
    // Confirmed live: this rule fired as a false positive with no real
    // rounding happening (same class of environment-vs-posture confound as
    // shoulderXOffset/SIDE_SHIFT). relativeShoulderScale (shoulderWidth /
    // face width) stays flat under a pure distance change since both
    // shrink together, but drops when the shoulders actually narrow
    // relative to a face that hasn't changed size — requiring it too
    // (feature_discussion rule 11's actual "동일 방향" AND, which this rule
    // had dropped) filters the distance-only case out.
    required: [
      { feature: "shoulderWidthRatio", operator: "LT", threshold: -2, reference: "CALIBRATION" },
      { feature: "relativeShoulderScale", operator: "LT", threshold: -1, reference: "CALIBRATION" },
    ],
    supporting: ["faceToShoulderRatio", "shoulderTilt"],
    reason: "shoulder shape is narrower than the calibrated posture",
  },
  {
    postureType: "CHIN_REST",
    requiredLandmarks: HANDS,
    required: [{ feature: "handFaceDistance", operator: "LT", threshold: -2, reference: "CALIBRATION" }],
    anyOf: [
      { feature: "headRoll", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
      { feature: "pitchProxy", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
      { feature: "faceShapeDeformation", operator: "GT", threshold: 2, reference: "CALIBRATION" },
    ],
    supporting: ["handShoulderDistance"],
    reason: "hand is close to the face and the head shape indicates support",
  },
  {
    postureType: "HEAD_BACK",
    requiredLandmarks: EYES,
    // The forwardLeanProxy ABS_LT exclusion used to fight its own first
    // condition: forwardLeanProxy bakes pitchProxy into its sum, so a big
    // enough pitchProxy drop to satisfy condition 1 usually also pushes
    // forwardLeanProxy well past the "stayed near 0" exclusion in
    // condition 2 — the rule could end up almost never matching.
    // faceToShoulderRatio directly is the actual "torso hasn't moved"
    // signal (independent of pitchProxy), so excluding on that instead
    // lets this fire whenever the head alone tilts back.
    required: [
      { feature: "pitchProxy", operator: "LT", threshold: -2, reference: "CALIBRATION" },
      { feature: "faceToShoulderRatio", operator: "ABS_LT", threshold: 1.2, reference: "CALIBRATION" },
    ],
    supporting: ["headYRatio", "headShoulderDistanceRatio", "forwardLeanProxy"],
    reason: "head is tilted backward without a matching torso lean",
  },
  {
    postureType: "CHIN_TUCK",
    requiredLandmarks: EYES,
    required: [
      { feature: "faceToShoulderRatioDelta", operator: "LT", threshold: -2, reference: "CALIBRATION" },
      { feature: "headShoulderDistanceRatio", operator: "LT", threshold: -2, reference: "CALIBRATION" },
    ],
    anyOf: [{ feature: "pitchProxy", operator: "LT", threshold: -1.5, reference: "CALIBRATION" }],
    supporting: ["headXRatio"],
    reason: "chin is pulled backward relative to the calibrated head position",
  },
  {
    postureType: "TORSO_TWIST",
    requiredLandmarks: CORE,
    required: [
      { feature: "shoulderWidthRatio", operator: "LT", threshold: -1.25, reference: "CALIBRATION" },
      { feature: "correctedYaw", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
    ],
    supporting: ["shoulderTilt", "shoulderDepthAsymmetry"],
    reason: "torso direction differs from the calibrated forward direction",
  },
  {
    postureType: "SHOULDERS_ONLY_TWIST",
    requiredLandmarks: CORE,
    required: [
      { feature: "torsoRotationProxy", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
      { feature: "correctedYaw", operator: "ABS_LT", threshold: 2, reference: "CALIBRATION" },
    ],
    supporting: ["shoulderWidthRatio", "shoulderTilt"],
    reason: "shoulders rotate while the head remains forward",
  },
];
