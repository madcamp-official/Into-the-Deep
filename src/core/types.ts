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
