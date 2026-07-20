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
  // always fills them in (nose/shoulders are required landmarks), so
  // existing FrameFeature literals in B/C's fixtures/tests keep compiling
  // without needing to know about every new field immediately.
  shoulderAsymmetry?: number;
  headXRatio?: number;
  headYRatio?: number;
  headShoulderDistanceRatio?: number;
  bodyCompressionRatio?: number;
  headRoll?: number;
  relativeShoulderScale?: number;
  handFaceDistance?: number;
  handShoulderDistance?: number;
  shoulderDepthAsymmetry?: number;
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
  state: "VALID" | "ADJUSTED" | "RECALIBRATION_REQUIRED";
  scaleCorrection: number;
  offsetX: number;
  offsetY: number;
  reliability: number;
}

export interface UserProfile {
  originalCenters: Record<string, number>;
  adaptiveCenters: Record<string, number>;
  featureDeviations: Record<string, number>;
  calibrationDuration: number;
  validFrameCount: number;
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
