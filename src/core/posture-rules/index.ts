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
    required: [
      { feature: "faceToShoulderRatio", operator: "GT", threshold: 2, reference: "CALIBRATION" },
    ],
    anyOf: [
      { feature: "headShoulderDistanceRatio", operator: "GT", threshold: 2, reference: "CALIBRATION" },
      { feature: "pitchProxy", operator: "GT", threshold: 1.5, reference: "CALIBRATION" },
    ],
    supporting: ["faceToShoulderRatio", "pitchProxy"],
    reason: "head is forward relative to the calibrated shoulder position",
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
    requiredLandmarks: CORE,
    required: [{ feature: "forwardLeanProxy", operator: "LT", threshold: -2, reference: "CALIBRATION" }],
    supporting: ["headShoulderDistanceRatio", "headYRatio"],
    reason: "upper body is leaning backward",
  },
  {
    postureType: "HEAD_TURN",
    requiredLandmarks: EARS,
    // yawProxy alone is noisy when the head is partially occluded or the
    // camera is slightly off-axis. Require a matching horizontal head shift
    // so unrelated posture changes do not become HEAD_TURN.
    required: [{ feature: "headXRatio", operator: "ABS_GT", threshold: 2.5, reference: "CALIBRATION" }],
    anyOf: [
      { feature: "correctedYaw", operator: "ABS_GT", threshold: 3, reference: "CALIBRATION" },
      { feature: "yawProxy", operator: "ABS_GT", threshold: 3, reference: "CALIBRATION" },
    ],
    supporting: ["headXRatio", "yawProxy"],
    reason: "head direction differs from the calibrated direction",
  },
  {
    postureType: "HEAD_TILT",
    requiredLandmarks: EYES,
    required: [{ feature: "headRoll", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" }],
    supporting: ["shoulderTilt"],
    reason: "head is tilted relative to the calibrated direction",
  },
  {
    postureType: "SHOULDER_ASYMMETRY",
    requiredLandmarks: CORE,
    required: [
      { feature: "shoulderTilt", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
    ],
    supporting: ["shoulderAsymmetry"],
    reason: "shoulder heights are asymmetric",
  },
  {
    postureType: "ROUNDED_SHOULDERS",
    requiredLandmarks: CORE,
    required: [{ feature: "shoulderWidthRatio", operator: "LT", threshold: -2, reference: "CALIBRATION" }],
    supporting: ["relativeShoulderScale", "faceToShoulderRatio", "shoulderTilt"],
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
    required: [
      { feature: "pitchProxy", operator: "LT", threshold: -2, reference: "CALIBRATION" },
      { feature: "forwardLeanProxy", operator: "ABS_LT", threshold: 2, reference: "CALIBRATION" },
    ],
    supporting: ["headYRatio", "headShoulderDistanceRatio"],
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
      { feature: "shoulderWidthRatio", operator: "LT", threshold: -2, reference: "CALIBRATION" },
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
