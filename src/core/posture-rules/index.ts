import type { LandmarkName, PostureRule } from "../types";

const CORE: LandmarkName[] = ["nose", "leftShoulder", "rightShoulder"];
const EYES: LandmarkName[] = [...CORE, "leftEye", "rightEye"];
const EARS: LandmarkName[] = [...EYES, "leftEar", "rightEar"];

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
      // Lowered 0.8 -> 0.6: a recorded development session (avg 0.66 across
      // the whole FORWARD_HEAD segment) and a fresh live capture (0.72)
      // both landed just under 0.8, causing HEAD_DOWN (pitchProxy alone) to
      // win instead as the sole match. Two consistent readings under the
      // old threshold, not a one-off — 0.6 clears both.
      { feature: "faceToShoulderRatio", operator: "GT", threshold: 0.6, reference: "CALIBRATION" },
      // Re-added with a wider threshold than the earlier attempt (removed
      // above): live testing confirmed moving substantially closer to the
      // camera (no real posture change) scores bodyScale ~3.14, while
      // genuine forward-head captures collected so far stayed under ~1.5
      // (one outlier at 1.35) since craning the head forward only brings a
      // *little* of the torso along with it. 2 sits in that gap — loose
      // enough not to repeat the old "blocked genuine detections" failure,
      // tight enough to exclude a real whole-body camera-distance change.
      { feature: "bodyScale", operator: "ABS_LT", threshold: 2, reference: "CALIBRATION" },
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
    // Lowered again 1.8 -> 1.3: live capture of a genuine held head-down
    // pitch only scored 1.54 under the current calibration (same MAD-basis
    // drift seen repeatedly this session) and failed to match at all. 1.3
    // clears it while staying well above the jsonl session's ~0.5 noise
    // ceiling.
    required: [{ feature: "pitchProxy", operator: "GT", threshold: 1.3, reference: "CALIBRATION" }],
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
    //
    // Lowered again 2 -> 1.2: a live, deliberately deep lean (post-
    // recalibration) only scored 1.44 — this calibration's MAD landed
    // higher than the jsonl session's did (same instability seen
    // repeatedly with other rules this session), so 2 was too strict for
    // this MAD basis. 1.2 clears it with margin while staying well above
    // the jsonl session's ~0.5 NORMAL_WORK ceiling.
    // bodyScale GT added: the user's physical distinction from FORWARD_HEAD
    // — leaning the whole torso forward brings the shoulders closer too
    // (bodyScale rises), while a pure turtle neck leaves shoulder distance
    // roughly unchanged (bodyScale flat/negative) and only the face grows.
    // Without this, a genuine FORWARD_HEAD case (bodyScale -0.10) lost to
    // FORWARD_LEAN's undiscounted priority whenever pitchProxy was also
    // elevated — confirmed live. Real FORWARD_LEAN captures so far scored
    // bodyScale 0.87/1.52, so 0.3 sits safely below both.
    required: [
      { feature: "forwardLeanProxy", operator: "GT", threshold: 1.2, reference: "CALIBRATION" },
      { feature: "bodyScale", operator: "GT", threshold: 0.3, reference: "CALIBRATION" },
    ],
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
    // shoulderWidthRatio threshold -1.5 -> -1.3: three live captures of a
    // genuine sustained backward lean scored -1.82/-1.41/-1.40 — two of
    // three fell just short of -1.5, failing this rule's own required
    // condition outright (not just losing on evidence score). -1.3 clears
    // all three while staying well past HEAD_BACK/HEAD_TURN's reference
    // values (-0.51/-0.91) for this same feature.
    required: [
      { feature: "faceToShoulderRatio", operator: "LT", threshold: -1, reference: "CALIBRATION" },
      { feature: "shoulderWidthRatio", operator: "LT", threshold: -1.3, reference: "CALIBRATION" },
    ],
    supporting: ["headShoulderDistanceRatio", "headYRatio", "forwardLeanProxy"],
    reason: "upper body is leaning backward",
    // Confirmed live: leaning back in a chair naturally also pitches the
    // head back (HEAD_BACK's pitchProxy) and nudges correctedYaw past
    // TORSO_TWIST's threshold, so even when both of *this* rule's own
    // (more specific, 2-condition) requirements clear, its evidence score
    // sat close enough to those two that the ambiguity gate returned
    // UNKNOWN instead of picking a winner. priority 1.3 gives a genuine
    // double-condition match enough of an edge to win outright.
    //
    // Raised 1.3 -> 2.1: TORSO_TWIST's own priority was later bumped to 2.0
    // (to beat FORWARD_HEAD, see TORSO_TWIST below), which silently
    // re-broke this fix — confirmed live, a pure backward lean (no actual
    // twist) flipped to TORSO_TWIST whenever correctedYaw's noise crossed
    // its ABS_GT 2 threshold (observed score 2.46 while only leaning back).
    // Safe to win outright rather than risk on evidence score: a genuine
    // torso twist inflates faceToShoulderRatio to strongly positive values
    // (TORSO_TWIST's own comment below, ~5-7), which fails this rule's own
    // faceToShoulderRatio LT -1 requirement, so this can't steal real
    // twists — it only wins the "pure lean, no twist" case it's meant to.
    priority: 2.1,
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
    //
    // Raised again 2.2 -> 5: live capture-button testing found FORWARD_HEAD
    // reliably swallowed by this rule whenever a forward-head/turtle-neck
    // hold incidentally produced some head roll too (headRoll scores -3.12,
    // -2.70 across two separate attempts) — FORWARD_HEAD's priority (0.4,
    // see above) couldn't outweigh even a marginal HEAD_TILT match. A
    // deliberate, roll-only head tilt (no forward-head component) instead
    // scored -9.19/+8.94 in the same session — a clean gap above the
    // contamination ceiling, so 5 excludes the forward-head side-effect
    // while keeping genuine tilts (which score far higher) comfortably
    // matched.
    required: [{ feature: "headRoll", operator: "ABS_GT", threshold: 5, reference: "CALIBRATION" }],
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
  // ROUNDED_SHOULDERS intentionally omitted: both candidate signals failed
  // to discriminate it, confirmed twice now (session-1784560098508.jsonl
  // replay, then again with live capture-button testing on a real rounded-
  // shoulders hold). shoulderWidthRatio barely moves for genuine rounded
  // shoulders (jsonl replay: -0.24 vs NORMAL_WORK's -0.22; live capture:
  // score -0.37, nowhere near the -2 the rule needed). relativeShoulderScale
  // does move (live capture: -10.10), but it swings just as hard or harder
  // for several *other* postures (jsonl replay averages: FORWARD_LEAN
  // -31.58, SHOULDERS_ONLY_TWIST -33.76, CHIN_REST -17.52, FORWARD_HEAD
  // -14.14, all bigger in magnitude than genuine ROUNDED_SHOULDERS' own
  // -8.61) — the live capture landed in that same contaminated range and
  // matched as FORWARD_HEAD instead. A z-axis (shoulder-depth) alternative
  // was also tried and abandoned (didn't move in the expected direction on
  // live testing). Stays unimplemented until a feature actually separates
  // it from FORWARD_HEAD/FORWARD_LEAN/CHIN_REST/SHOULDERS_ONLY_TWIST.
  {
    postureType: "CHIN_REST",
    // CORE, not HANDS (both wrists): assessRuleReliability requires every
    // listed landmark individually, but handFaceDistance/handShoulderDistance
    // only need *one* wrist (landmark-reliability's wristsReliable is
    // OR-based — resting a chin on one hand naturally leaves the other arm
    // off-frame/unreliable). Requiring both wrists here made the rule defer
    // whenever the *unused* wrist's confidence dipped, confirmed live via
    // the capture button (strong handFaceDistance/handShoulderDistance
    // scores present, but posture flickered between CHIN_REST and
    // HEAD_DOWN/no-match frame to frame). scoreCondition already returns
    // undefined (failing the required check) if handFaceDistance itself
    // couldn't be computed, so no separate landmark gate is needed here.
    requiredLandmarks: CORE,
    // Switched off CALIBRATION reference: confirmed live twice now that
    // handFaceDistance's calibration center is unstable across sessions —
    // a hand raised near the face but well off to the side (raw distance
    // ~1.72-1.75, farther than any genuine rest seen so far) scored MORE
    // extreme (-24.86/-25.49) than actual chin-rests at a *closer* raw
    // distance (~1.05-1.24, scored -12 to -35 in earlier sessions). The
    // calibration median for this feature depends entirely on incidental
    // hand position during that one 5-second window, so it isn't a
    // meaningful "neutral" reference the way head/shoulder features are.
    // Threshold lowered 28 -> 6: switching handFaceDistance's computation to
    // Hand Landmarker (middleFingerMcp-to-mouth) changed its scale entirely
    // — a fresh session replay showed genuine CHIN_REST normalized to
    // 3.33-5.80, so 28 was a no-op (always passed) rather than a real gate.
    // 6 at least covers every genuine CHIN_REST sample seen so far. Some
    // overlap with NORMAL_WORK remains at this scale (a hand passing near
    // the face briefly during typing can read just as close) — the dwell/
    // sustained-match mechanism is relied on to filter out those brief,
    // non-sustained overlaps rather than this single-frame threshold alone.
    required: [{ feature: "handFaceDistance", operator: "ABS_LT", threshold: 6, reference: "ABSOLUTE" }],
    // handShoulderDistance added after live capture-button testing: once
    // profile-builder started giving handFaceDistance a real CALIBRATION
    // center (see profile-builder fix), a genuine chin-rest scored
    // handFaceDistance -20.91 and handShoulderDistance -12.73 — but the
    // *old* anyOf (headRoll/pitchProxy) sat just under threshold (0.69x,
    // 0.89x) and faceShapeDeformation is never computed at all (always
    // undefined), so the rule still didn't fire. handShoulderDistance is a
    // much stronger, already-reliable signal for the same "hand near
    // face/shoulder" posture, so it's added here rather than loosening the
    // weaker head-orientation conditions.
    anyOf: [
      { feature: "handShoulderDistance", operator: "LT", threshold: -1, reference: "CALIBRATION" },
      { feature: "headRoll", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
      { feature: "pitchProxy", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
      { feature: "faceShapeDeformation", operator: "GT", threshold: 2, reference: "CALIBRATION" },
    ],
    supporting: [],
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
  // CHIN_TUCK intentionally removed: its required faceToShoulderRatioDelta
  // condition is dead code — that feature is never actually computed by
  // feature-normalizer (only mentioned in a comment describing what
  // forwardLeanProxy conceptually becomes after generic calibration-delta
  // normalization, not a real FrameFeature field), so the condition always
  // scored undefined and this rule could never match, same as the
  // torsoRotationProxy situation that kills SHOULDERS_ONLY_TWIST.
  {
    postureType: "TORSO_TWIST",
    requiredLandmarks: CORE,
    required: [
      { feature: "shoulderWidthRatio", operator: "LT", threshold: -1.25, reference: "CALIBRATION" },
      { feature: "correctedYaw", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
      // shoulderCenterY ABS_LT added: a *deep* BACKWARD_LEAN (well past the
      // shallow leans BACKWARD_LEAN's own priority fix above was tuned
      // against) also drives correctedYaw past this rule's threshold — live
      // captures showed correctedYaw 3.70-4.22 (no priority trick saves
      // BACKWARD_LEAN here either, since its own faceToShoulderRatio
      // condition failed outright at this lean depth, score only -0.13).
      // The clean discriminator: reclining moves the torso's vertical
      // screen position a lot (shoulderCenterY score 3.55-3.60 in that same
      // deep-lean capture), while three genuine live torso-twist captures
      // (rotating shoulders in place, no lean) scored -0.62/-0.03/0.16 —
      // barely moved. 2 sits well above the twist noise ceiling and well
      // below the lean-contamination floor.
      { feature: "shoulderCenterY", operator: "ABS_LT", threshold: 2, reference: "CALIBRATION" },
    ],
    supporting: ["shoulderTilt", "shoulderDepthAsymmetry"],
    reason: "torso direction differs from the calibrated forward direction",
    // A torso twist projects the shoulders narrower in 2D, which inflates
    // faceToShoulderRatio the same way it does for FORWARD_HEAD — already
    // documented from session-1784560098508.jsonl replay (SHOULDERS_ONLY_TWIST
    // averaged faceToShoulderRatio 7.37) and reconfirmed live just now
    // (5.01), both far past FORWARD_HEAD's own reference (~2.52). Even with
    // both of this rule's own conditions clearing their thresholds, its
    // evidence score (~1.10) still lost to FORWARD_HEAD's (~1.87) despite
    // that rule's 0.4 priority discount, so this needs a larger boost than
    // BACKWARD_LEAN's 1.3 did.
    priority: 2.0,
  },
  // SHOULDERS_ONLY_TWIST intentionally removed: its required torsoRotationProxy
  // condition is dead code — that feature is never actually computed by
  // feature-normalizer, so the condition always scored undefined and this
  // rule could never match (confirmed via a fresh session replay: 0/222
  // correct). Same situation as the removed CHIN_TUCK rule.
  {
    postureType: "ARMREST_LEAN",
    requiredLandmarks: CORE,
    // Distinguishes a real armrest lean from two visually similar but
    // non-posture cases (need_discussion #6: environment changes shouldn't
    // alert on their own):
    //   - chair slid sideways: shoulderCenterX changes, but shoulderCenterY
    //     and bodyScale both stay put (pure lateral translation only).
    //   - chair pushed back diagonally: shoulderCenterX/Y both change, same
    //     as a real lean, but bodyScale shrinks too (moved farther from the
    //     camera).
    // A real lean onto one armrest moves the body diagonally *down* on
    // screen (shoulderCenterY increases, MediaPipe y grows downward) plus
    // sideways (shoulderCenterX), while staying the same distance from the
    // camera (bodyScale unchanged) — the combination of "moved diagonally"
    // AND "didn't change size" is what SIDE_SHIFT (still unimplemented)
    // couldn't get from lateral position alone.
    // shoulderCenterY threshold 2 -> 0.7: 6 live captures of a genuine
    // armrest lean scored only 0.97-1.42 on this feature (X moved much more
    // than Y for this user's chair/desk setup — 3.25-4.39), so 2 was too
    // strict and blocked every one of them. 0.7 sits under the observed
    // range with some margin. shoulderCenterX (3.25-4.39) and bodyScale
    // (-0.06 to -0.66, all well under 1.5) already held up against the same
    // captures, unchanged.
    required: [
      { feature: "shoulderCenterY", operator: "GT", threshold: 0.7, reference: "CALIBRATION" },
      { feature: "shoulderCenterX", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
      { feature: "bodyScale", operator: "ABS_LT", threshold: 1.5, reference: "CALIBRATION" },
    ],
    supporting: ["shoulderTilt", "shoulderAsymmetry"],
    reason: "body has shifted diagonally to one side without moving closer to or farther from the camera",
  },
];
