export type CameraState =
  | "VALID"
  | "ADJUSTED"
  | "RECALIBRATION_REQUIRED"
  | "UNKNOWN";

export type DetectionState =
  | "STABLE"
  | "MOVING"
  | "SETTLING"
  | "DRIFT_SUSPECTED"
  | "ALERTED"
  | "RECOVERED"
  | "UNKNOWN";

export type PostureType =
  | "FORWARD_HEAD"
  | "ARMREST_LEAN"
  | "SIDE_SHIFT"
  | "FORWARD_LEAN"
  | "HEAD_TURN"
  | "HEAD_TILT"
  | "HEAD_DOWN"
  | "LOW_SITTING"
  | "CHIN_REST"
  | "HEAD_BACK"
  | "SHOULDER_ASYMMETRY"
  | "ROUNDED_SHOULDERS"
  | "BACKWARD_LEAN"
  | "CHIN_TUCK"
  | "TORSO_TWIST"
  | "SHOULDERS_ONLY_TWIST";

export type MovementContext =
  | "NONE"
  | "CAMERA_MOVEMENT"
  | "ARMREST_LEAN"
  | "SIDE_SHIFT"
  | "CHAIR_MOVEMENT"
  | "UNKNOWN";

export type PostureFeatureName =
  | "shoulderTilt"
  | "headXOffset"
  | "shoulderXOffset"
  | "shoulderYOffset"
  | "bodyScale"
  | "shoulderAsymmetry"
  | "shoulderCenterX"
  | "shoulderCenterY"
  | "shoulderWidth"
  | "headXRatio"
  | "headYRatio"
  | "headShoulderDistanceRatio"
  | "faceToShoulderRatio"
  | "faceToShoulderRatioDelta"
  | "pitchProxy"
  | "yawProxy"
  | "correctedYaw"
  | "headRoll"
  | "faceShapeDeformation"
  | "forwardLeanProxy"
  | "bodyCompressionRatio"
  | "shoulderWidthRatio"
  | "relativeShoulderScale"
  | "shoulderDepthAsymmetry"
  | "torsoRotationProxy"
  | "handFaceDistance"
  | "handShoulderDistance"
  | "motionEnergy";

export type FeatureVector = Partial<Record<PostureFeatureName, number>>;

export type LandmarkName =
  | "nose"
  | "leftEye"
  | "rightEye"
  | "leftEar"
  | "rightEar"
  | "mouthLeft"
  | "mouthRight"
  | "leftShoulder"
  | "rightShoulder"
  | "leftHip"
  | "rightHip"
  | "leftWrist"
  | "rightWrist"
  | "leftElbow"
  | "rightElbow";

export interface FrameFeature {
  timestamp: number;
  confidence: number;
  shoulderTilt: number;
  headXOffset: number;
  shoulderXOffset: number;
  shoulderYOffset: number;
  bodyScale: number;
  faceToShoulderRatio?: number;
  pitchProxy?: number;
  yawProxy?: number;
  motionEnergy: number;

  // feature_discussion additions (additive only — headXOffset/
  // shoulderXOffset/shoulderYOffset/bodyScale above stay in place since
  // B/C's detectors, profile-builder, and evaluation/* already key off
  // them; renaming or removing them needs a team sync first per
  // need_discussion #1). Optional here even though feature-normalizer
  // always fills most of these in (nose/shoulders are required landmarks),
  // so existing FrameFeature literals in B/C's fixtures/tests keep
  // compiling without needing to know about every new field immediately.
  shoulderWidth?: number;
  shoulderCenterX?: number;
  shoulderCenterY?: number;
  shoulderAsymmetry?: number;
  headXRatio?: number;
  headYRatio?: number;
  headShoulderDistanceRatio?: number;
  faceToShoulderRatioDelta?: number;
  correctedYaw?: number;
  headRoll?: number;
  faceShapeDeformation?: number;
  forwardLeanProxy?: number;
  bodyCompressionRatio?: number;
  shoulderWidthRatio?: number;
  relativeShoulderScale?: number;
  shoulderDepthAsymmetry?: number;
  torsoRotationProxy?: number;
  handFaceDistance?: number;
  handShoulderDistance?: number;

  // Environment and quality features are recorded with the frame but do not
  // directly decide whether a posture is bad.
  cameraRollProxy?: number;
  cameraPitchProxy?: number;
  backgroundMotion?: number;
  backgroundTransformConfidence?: number;
  movementContext?: MovementContext;
  landmarkCoverage?: number;
  landmarkConfidence?: number;
}

export interface CameraRawFeature {
  timestamp: number;
  shoulderWidth: number;
  faceCenterX: number;
  faceCenterY: number;
  shoulderCenterX: number;
  shoulderCenterY: number;
  faceToShoulderRatio: number;
  yawProxy: number;
  pitchProxy: number;
}

export interface CameraProfile {
  shoulderWidth: number;
  faceCenterX: number;
  faceCenterY: number;
  shoulderCenterX: number;
  shoulderCenterY: number;
  faceToShoulderRatio: number;
  yawProxy: number;
  pitchProxy: number;
}

// Raw camera-relative deltas (A's job — computed straight from
// CameraRawFeature vs the stored CameraProfile), not yet a VALID/ADJUSTED/
// RECALIBRATION_REQUIRED judgment. That judgment (CameraAssessment) is B's.
export interface CameraDelta {
  timestamp: number;
  globalScaleDelta: number;
  globalTranslationX: number;
  globalTranslationY: number;
  correctedYaw: number;
}

export interface CameraAssessment {
  timestamp: number;
  state: CameraState;
  scaleCorrection: number;
  offsetX: number;
  offsetY: number;
  reliability: number;
  reason?: string[];
  backgroundTransformConfidence?: number;
}

export interface UserProfile {
  originalCenters: Record<string, number>;
  // Kept temporarily for compatibility with the existing V1 code. New V0/V2
  // code should use originalCenters plus MADProfile instead.
  adaptiveCenters: Record<string, number>;
  featureDeviations: Record<string, number>;
  calibrationDuration: number;
  validFrameCount: number;
  profileCreatedAt?: number;
}

export interface MADProfile {
  values: FeatureVector;
  min: FeatureVector;
  max: FeatureVector;
  initializedAt: number;
  updatedAt: number;
  updateCount: number;
}

export type RuleOperator = "GT" | "GTE" | "LT" | "LTE" | "ABS_GT" | "ABS_LT";

export interface PostureRuleCondition {
  feature: PostureFeatureName;
  operator: RuleOperator;
  threshold: number;
  reference: "CALIBRATION" | "ABSOLUTE";
}

export interface PostureRule {
  postureType: PostureType;
  requiredLandmarks: LandmarkName[];
  required: PostureRuleCondition[];
  anyOf?: PostureRuleCondition[];
  supporting: PostureFeatureName[];
  reason: string;
  // Lower values are useful for generic rules that commonly overlap with a
  // more specific posture, such as HEAD_TURN.
  priority?: number;
}

export interface DriftObservation {
  timestamp: number;
  driftScore: number;
  reliability: number;
  dominantFeatures: string[];
}

export interface DetectionEvent {
  timestamp: number;
  state: string;
  alert: boolean;
  reason: string[];
  postureType?: PostureType;
  matchedFeatures?: PostureFeatureName[];
  postureCandidates?: Array<{ postureType: PostureType; score: number }>;
  cameraState?: CameraState;
  cameraCheckRequired?: boolean;
  qualityReasons?: string[];
}

export interface PostureFeedback {
  timestamp: number;
  state: string;
  alert: boolean;
  guidelineVisible: boolean;
  message: string;
  dominantFeatures: string[];
}

export interface LandmarkQuality {
  timestamp: number;
  personPresent: boolean;
  faceInFrame: boolean;
  shouldersInFrame: boolean;
  confidence: number;
  reliable: boolean;
  eyesReliable: boolean;
  earsReliable: boolean;
  wristsReliable: boolean;
  landmarkCoverage: number;
  occlusionRate: number;
  missingLandmarks?: string[];
  reasons?: string[];
  reliableLandmarks?: LandmarkName[];
  unreliableLandmarks?: LandmarkName[];
}

export interface ScenarioLabel {
  timestamp: number;
  label:
    | "NORMAL_WORK"
    | "TRANSIENT_ACTION"
    | "SETTLING"
    | "FORWARD_LEAN"
    | "FORWARD_HEAD"
    | "HEAD_DOWN"
    | "LEFT_LEAN"
    | "RIGHT_LEAN"
    | "SIDE_SHIFT"
    | "HEAD_TURN"
    | "CLOSE_TO_CAMERA"
    | "CAMERA_CHANGE"
    | "HEAD_TILT"
    | "CHIN_REST"
    | "HEAD_BACK"
    | "SHOULDER_ASYMMETRY"
    | "ROUNDED_SHOULDERS"
    | "BACKWARD_LEAN"
    | "CHIN_TUCK"
    | "TORSO_TWIST"
    | "SHOULDERS_ONLY_TWIST"
    | "ARMREST_LEAN";
}
