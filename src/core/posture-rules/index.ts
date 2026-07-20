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
  {
    postureType: "SIDE_SHIFT",
    requiredLandmarks: CORE,
    required: [{ feature: "shoulderXOffset", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" }],
    supporting: ["shoulderCenterX"],
    reason: "shoulder center moved sideways from the calibrated position",
  },
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
    required: [],
    anyOf: [
      { feature: "correctedYaw", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
      { feature: "yawProxy", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
    ],
    supporting: ["headXRatio"],
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
