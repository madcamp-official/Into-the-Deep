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
  | "LOW_SITTING"
  | "CHIN_REST"
  | "HEAD_BACK"
  | "SHOULDER_ASYMMETRY"
  | "ROUNDED_SHOULDERS"
  | "BACKWARD_LEAN"
  | "CHIN_TUCK"
  | "TORSO_TWIST"
  | "SHOULDERS_ONLY_TWIST";

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

  // New relative posture features. They remain optional until the input
  // pipeline supplies the corresponding landmarks reliably.
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
    | "LEFT_LEAN"
    | "RIGHT_LEAN"
    | "SIDE_SHIFT"
    | "HEAD_TURN"
    | "CLOSE_TO_CAMERA"
    | "CAMERA_CHANGE";
}
