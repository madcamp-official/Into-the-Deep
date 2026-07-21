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
    // Added after replaying session-1784560098508.jsonl: faceToShoulderRatio
    // rises for almost every "face got closer/bigger" posture, not just
    // turtle neck — real averages were FORWARD_LEAN 6.72, CLOSE_TO_CAMERA
    // 4.17, SHOULDERS_ONLY_TWIST 7.37, CHIN_REST 3.21, all bigger than
    // genuine FORWARD_HEAD's own 2.52. Evidence-score is normalized/
    // threshold, and this rule's threshold (1.2) is the lowest of the
    // bunch, so it mechanically out-scored every one of those more
    // specific (multi-condition) rules and swallowed them all. Lower
    // priority lets a more specific rule win whenever it also matches;
    // this only wins when it's the sole match (a "pure" turtle neck).
    priority: 0.4,
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
    // Threshold raised 0.7 -> 1.8: replayed a real recorded session
    // (session-1784560098508.jsonl) through the current rules —
    // NORMAL_WORK/SETTLING pitchProxy average 0.4-0.53, so 0.7 was far too
    // close to ordinary noise to be a safe bar.
    required: [{ feature: "pitchProxy", operator: "GT", threshold: 1.8, reference: "CALIBRATION" }],
    supporting: ["headYRatio", "headShoulderDistanceRatio"],
    reason: "head is pitched down relative to the calibrated direction",
    // Same story as FORWARD_HEAD's priority: pitchProxy alone rises for
    // several other postures too (real averages CHIN_REST 3.35,
    // CLOSE_TO_CAMERA 3.26, FORWARD_LEAN 4.94, all bigger than HEAD_DOWN
    // needs), and this rule's single easy condition out-scored their
    // more specific multi-condition rules. Deprioritized so this only
    // wins as the sole match.
    priority: 0.4,
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
    // Threshold raised 0.5 -> 2: replayed session-1784560098508.jsonl —
    // NORMAL_WORK/SETTLING forwardLeanProxy averages 0.36-0.51, so 0.5 was
    // firing on ordinary noise. Real FORWARD_LEAN in the same session
    // averaged 4.17, so 2 keeps a safe margin on both sides.
    required: [{ feature: "forwardLeanProxy", operator: "GT", threshold: 2, reference: "CALIBRATION" }],
    supporting: ["bodyCompressionRatio", "headYRatio"],
    reason: "upper body is leaning forward",
  },
  {
    postureType: "BACKWARD_LEAN",
    requiredLandmarks: EYES,
    // faceToShoulderRatio alone (previous design) turned out to be a bad
    // solo signal: replaying session-1784560098508.jsonl showed it shrinks
    // for almost *any* head reorientation, not just a real torso lean back
    // — HEAD_BACK groundtruth averaged -6.14 and HEAD_TURN averaged -6.76
    // on this same feature, both bigger in magnitude than real
    // BACKWARD_LEAN's own -1.68. That's why HEAD_BACK/HEAD_TURN were being
    // swallowed by this rule 100% of the time.
    //
    // The real discriminator in the data: shoulderWidthRatio (= bodyScale)
    // only drops for genuine BACKWARD_LEAN (-2.84 avg) — a pure head
    // tilt/turn leaves the torso in place, so shoulderWidthRatio stays
    // near 0 for HEAD_BACK (-0.51) and HEAD_TURN (-0.91). Requiring both
    // conditions together (torso actually moved away from the camera, not
    // just the face angle changing) fixes both the false positives and
    // the HEAD_BACK/HEAD_TURN starvation without touching those rules.
    required: [
      { feature: "faceToShoulderRatio", operator: "LT", threshold: -1, reference: "CALIBRATION" },
      { feature: "shoulderWidthRatio", operator: "LT", threshold: -1.5, reference: "CALIBRATION" },
    ],
    supporting: ["headShoulderDistanceRatio", "headYRatio", "forwardLeanProxy"],
    reason: "upper body is leaning backward",
  },
  {
    postureType: "HEAD_TURN",
    requiredLandmarks: EARS,
    // headRoll ABS_LT exclusion removed: replaying session-1784560098508.jsonl
    // showed real HEAD_TURN groundtruth averages headRoll -3.60 — turning
    // the head yaws the eye line too (2D-projection cross-axis
    // contamination, the mirror image of the earlier finding that a pure
    // tilt contaminates yawProxy), so this exclusion was above its own
    // threshold and blocked the rule from ever matching its own posture.
    // That's why HEAD_TURN was being swallowed entirely by BACKWARD_LEAN.
    // BACKWARD_LEAN no longer competes here anyway (its new
    // shoulderWidthRatio requirement excludes pure head reorientation), so
    // the exclusion isn't needed for that either.
    required: [
      { feature: "headXRatio", operator: "ABS_GT", threshold: 3, reference: "CALIBRATION" },
    ],
    anyOf: [
      { feature: "correctedYaw", operator: "ABS_GT", threshold: 5, reference: "CALIBRATION" },
      { feature: "yawProxy", operator: "ABS_GT", threshold: 5, reference: "CALIBRATION" },
    ],
    supporting: ["headXRatio", "yawProxy", "headRoll"],
    reason: "head direction differs from the calibrated direction",
    priority: 0.8,
  },
  {
    postureType: "HEAD_TILT",
    requiredLandmarks: EYES,
    // Raised 1.2 -> 2.2: replaying session-1784560098508.jsonl showed this
    // was the single biggest source of false *alerts* (352 sustained false
    // positives during NORMAL_WORK/SETTLING) — 1.2 sat too close to
    // ordinary noise (NORMAL_WORK/SETTLING headRoll averages 0.39-0.48,
    // but individual frames swing well past 1.2 during natural movement).
    // Real HEAD_TILT in the same session averaged -12.85, so 2.2 keeps a
    // large margin on that side.
    required: [{ feature: "headRoll", operator: "ABS_GT", threshold: 2.2, reference: "CALIBRATION" }],
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
    // EYES, not just CORE: relativeShoulderScale needs eye distance, so
    // the rule should defer (not silently fail to match) when eyes aren't
    // reliable.
    requiredLandmarks: EYES,
    // Tried shoulderWidthRatio LT -2 (theory: filters out pure
    // camera-distance changes) and relativeShoulderScale alone at various
    // thresholds/priorities while replaying session-1784560098508.jsonl.
    // Neither held up: shoulderWidthRatio barely differs from NORMAL_WORK
    // for real ROUNDED_SHOULDERS (-0.24 vs -0.22), and relativeShoulderScale
    // swings even harder for several *other* postures (FORWARD_LEAN
    // -31.58, SHOULDERS_ONLY_TWIST -33.76, CHIN_REST -17.52, FORWARD_HEAD
    // -14.14 — all bigger in magnitude than genuine ROUNDED_SHOULDERS'
    // own -8.61), so loosening it enough to catch its own cases made it
    // swallow those other rules instead, and tightening/deprioritizing it
    // enough to stop that made it miss most of its own cases again.
    // Left as the (still imperfect, ~0% recall but at least not
    // disruptive) dual-condition version pending a real per-feature MAD
    // recalibration — relativeShoulderScale's default MAD (0.04) looks too
    // small for its actual natural variance given how wildly it swings
    // across every label.
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
    required: [{ feature: "handFaceDistance", operator: "LT", threshold: -1, reference: "CALIBRATION" }],
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
    // The faceToShoulderRatio ABS_LT exclusion (an earlier attempt to
    // require "torso hasn't moved") turned out to fight the rule's own
    // purpose: replaying session-1784560098508.jsonl showed real HEAD_BACK
    // groundtruth averages faceToShoulderRatio -6.14 (tilting the head back
    // to look up drastically foreshortens the face) — far past the 1.2
    // exclusion, so the rule almost never matched its own posture and
    // BACKWARD_LEAN (which also used faceToShoulderRatio at the time)
    // caught 100% of these frames instead. BACKWARD_LEAN's new
    // shoulderWidthRatio requirement now handles that disambiguation
    // (a real torso lean shrinks shoulder width, a head tilt doesn't), so
    // this rule no longer needs its own exclusion — pitchProxy's magnitude
    // (real HEAD_BACK averaged -8.54, comfortably past -2) is enough on
    // its own.
    required: [{ feature: "pitchProxy", operator: "LT", threshold: -2, reference: "CALIBRATION" }],
    supporting: ["headYRatio", "headShoulderDistanceRatio", "faceToShoulderRatio", "forwardLeanProxy"],
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
