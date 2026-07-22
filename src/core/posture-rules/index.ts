import type { LandmarkName, PostureRule } from "../types";

// ===========================================================================
// FRONTAL-CALIBRATION RULES
//
// Reverted to commit 56e0bb6 (2026-07-21) as the trusted baseline: frontal
// and side-angle calibration are being fully separated into two
// independently-tuned rule sets from here on (user's explicit call after
// today's side-angle-driven fixes — FORWARD_HEAD's anyOf restructure,
// HEAD_TURN's disable, TORSO_TWIST's ABS_GT+faceSize redesign — turned out
// to only really be needed/verified for the side-angle case). This array is
// a clean starting point; re-apply any of today's fixes here deliberately,
// one at a time, only once separately verified against a frontal
// calibration.
// ===========================================================================

const CORE: LandmarkName[] = ["nose", "leftShoulder", "rightShoulder"];
const EYES: LandmarkName[] = [...CORE, "leftEye", "rightEye"];
// EARS only used by HEAD_TURN, disabled below (barely-used posture, and
// live testing found it can win a priority contest against TORSO_TWIST
// when a twist also involves noticeable head rotation) — kept here so
// re-enabling it doesn't need this line rewritten too.
// const EARS: LandmarkName[] = [...EYES, "leftEar", "rightEar"];

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
      // History: 0.6 (too sensitive) -> 0.8 (session replay: NORMAL_WORK
      // false-positive 9.2%->7.8%, but genuine recall 69.4%->37.0%) -> live
      // testing at 0.8 then showed genuine held FORWARD_HEAD scoring right
      // at the boundary (0.80/1.01/1.12 across 3 captures of the same
      // hold), so ordinary jitter flickered it in and out of match — the
      // 0.8 fix traded oversensitivity for under-detection instead of
      // fixing the real problem (single-frame faceToShoulderRatio doesn't
      // cleanly separate these cases at any threshold, confirmed by the
      // replay's own sweep). 0.7 splits the difference (replay: NORMAL_WORK
      // 8.5%, genuine recall 53.4%) — still a compromise, not a fix.
      // Raised 0.7 -> 0.9: user reported FORWARD_HEAD feeling slightly too
      // sensitive after the 56e0bb6 revert; live captures showed
      // faceToShoulderRatio scoring 0.87/0.93/1.08 against this calibration
      // — right at the old threshold's edge. 0.9 pushes the two lower ones
      // below 1 while still leaving room for a clearly-held hold.
      //
      // Raised again 0.9 -> 1.3: a full-session replay (session-
      // 1784722544259.jsonl, 8636 frames) showed 0.9 was nowhere near
      // enough — NORMAL_WORK false-positived on FORWARD_HEAD 28-29% of the
      // time. Distribution: NORMAL_WORK median 0.32 (p90 1.22), genuine
      // FORWARD_HEAD median 2.15 (p10 1.95) — 1.3 sits just above
      // NORMAL_WORK's p90 with real margin below FORWARD_HEAD's own p10.
      { feature: "faceToShoulderRatio", operator: "GT", threshold: 1.3, reference: "CALIBRATION" },
      // Re-added with a wider threshold than the earlier attempt (removed
      // above): live testing confirmed moving substantially closer to the
      // camera (no real posture change) scores bodyScale ~3.14, while
      // genuine forward-head captures collected so far stayed under ~1.5
      // (one outlier at 1.35) since craning the head forward only brings a
      // *little* of the torso along with it. 2 sits in that gap — loose
      // enough not to repeat the old "blocked genuine detections" failure,
      // tight enough to exclude a real whole-body camera-distance change.
      { feature: "bodyScale", operator: "ABS_LT", threshold: 2, reference: "CALIBRATION" },
      // headRoll GT added: faceToShoulderRatio/pitchProxy both rise for
      // HEAD_DOWN almost as much as for genuine FORWARD_HEAD (session-
      // 1784722544259.jsonl: pitchProxy medians 2.44 vs 2.65, heavily
      // overlapping), so FORWARD_HEAD kept winning the evidence-score
      // contest on 97% of real HEAD_DOWN frames — tried rebalancing via
      // HEAD_DOWN's priority instead (see its own comment) and found no
      // viable middle ground. headRoll turned out to separate the two
      // cleanly in the same replay: genuine FORWARD_HEAD scored
      // consistently positive (p10 1.14, median 1.67, p90 2.19) while
      // genuine HEAD_DOWN scored negative-to-flat (p10 -1.95, median
      // -0.52, p90 0.53) — a real gap between HEAD_DOWN's p90 and
      // FORWARD_HEAD's p10. 0.8 sits in that gap.
      { feature: "headRoll", operator: "GT", threshold: 0.8, reference: "CALIBRATION" },
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
    // Distinct from FORWARD_HEAD: pitchProxy is the direct signal for a
    // downward pitch. feature_discussion's #14 ("고개 숙여서 아래 보기")
    // lists this as a *transient* action (writing, glancing down), but a
    // *sustained* hold of the same pitch is a distinct posture worth its
    // own alert rather than being silently absorbed into FORWARD_HEAD.
    // Threshold raised 0.7 -> 1.8: replayed a real recorded session
    // (session-1784560098508.jsonl) through the current rules —
    // NORMAL_WORK/SETTLING pitchProxy average 0.4-0.53, so 0.7 was far too
    // close to ordinary noise to be a safe bar.
    // Lowered again 1.8 -> 1.3: live capture of a genuine held head-down
    // pitch only scored 1.54 under the current calibration (same MAD-basis
    // drift seen repeatedly this session) and failed to match at all. 1.3
    // clears it while staying well above the jsonl session's ~0.5 noise
    // ceiling.
    // Raised again 1.3 -> 2.2: contrary to this rule's original assumption,
    // faceToShoulderRatio *does* creep up somewhat for a pure head-down too
    // (live capture: 0.72, just past FORWARD_HEAD's own 0.7 threshold) —
    // so a genuine turtle-neck-while-looking-slightly-down blend can score
    // pitchProxy 1.82, just past the old 1.3 bar, and out-evidence
    // FORWARD_HEAD despite being the wrong call (user confirmed it was
    // turtle neck, not head-down). A confirmed genuine pure head-down in
    // the same session scored pitchProxy 3.46 — comfortably clears 2.2,
    // while 1.82 no longer does and falls through to FORWARD_HEAD instead.
    required: [{ feature: "pitchProxy", operator: "GT", threshold: 2.2, reference: "CALIBRATION" }],
    supporting: ["headYRatio", "headShoulderDistanceRatio"],
    reason: "head is pitched down relative to the calibrated direction",
    // Same story as FORWARD_HEAD's priority: pitchProxy alone rises for
    // several other postures too (real averages CHIN_REST 3.35,
    // CLOSE_TO_CAMERA 3.26, FORWARD_LEAN 4.94, all bigger than HEAD_DOWN
    // needs), and this rule's single easy condition out-scored their
    // more specific multi-condition rules. Deprioritized so this only
    // wins as the sole match.
    //
    // Tried raising this to 0.7 to beat FORWARD_HEAD's evidence score
    // (session-1784722544259.jsonl replay showed 97% of genuine HEAD_DOWN
    // matched FORWARD_HEAD instead) — swept 0.4 through 0.7 and found no
    // middle ground: HEAD_DOWN stayed near 0% until ~0.6, then FORWARD_HEAD
    // collapsed to 36% just as HEAD_DOWN recovered. Priority can't fix an
    // evidence-score overlap this deep. Reverted to 0.4; see FORWARD_HEAD's
    // new headRoll condition above for the actual fix (a required-condition
    // exclusion instead of an evidence-score arms race).
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
    // faceToShoulderRatio swapped out for shoulderCenterY: live captures
    // across several different calibration sessions showed faceToShoulderRatio
    // swings wildly and unpredictably as lean depth increases (-2.15, -1.09,
    // -0.13, 0.00, +1.03 — the deepest leans actually flipped positive,
    // structurally failing this rule's own LT -1 requirement and leaving the
    // posture undetected or misclassified as FORWARD_HEAD/TORSO_TWIST
    // instead). shoulderCenterY was consistently elevated (1.48-3.60) across
    // every one of those same captures regardless of depth or session —
    // reclining moves the torso's vertical screen position in a way
    // faceToShoulderRatio doesn't reliably track.
    required: [
      { feature: "shoulderCenterY", operator: "GT", threshold: 1.3, reference: "CALIBRATION" },
      { feature: "shoulderWidthRatio", operator: "LT", threshold: -1.3, reference: "CALIBRATION" },
    ],
    supporting: ["headShoulderDistanceRatio", "headYRatio", "forwardLeanProxy", "faceToShoulderRatio"],
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
    // Safe to win outright rather than risk on evidence score: three
    // confirmed live genuine-twist captures (rotating shoulders in place, no
    // lean) scored shoulderCenterY -0.62/-0.03/0.16 — comfortably under this
    // rule's own GT 1.5 requirement — so this still can't steal real twists,
    // it only wins the "pure lean, no twist" case it's meant to.
    priority: 2.1,
  },
  // HEAD_TURN disabled (not deleted): barely used in practice, and live
  // testing just found it can win a priority contest against TORSO_TWIST
  // whenever a twist also involves noticeable head rotation (headXRatio
  // 17.71 vs a genuine-twist-only capture's 3.22, dragging TORSO_TWIST's
  // evidence score down via its own weakest condition) — same underlying
  // complaint as the side-angle version's disable, now applying to the
  // frontal rule set too after reverting it to 56e0bb6 re-activated this.
  // {
  //   postureType: "HEAD_TURN",
  //   requiredLandmarks: EARS,
  //   // headRoll ABS_LT exclusion removed: replaying session-1784560098508.jsonl
  //   // showed real HEAD_TURN groundtruth averages headRoll -3.60 — turning
  //   // the head yaws the eye line too (2D-projection cross-axis
  //   // contamination, the mirror image of the earlier finding that a pure
  //   // tilt contaminates yawProxy), so this exclusion was above its own
  //   // threshold and blocked the rule from ever matching its own posture.
  //   // That's why HEAD_TURN was being swallowed entirely by BACKWARD_LEAN.
  //   // BACKWARD_LEAN no longer competes here anyway (its new
  //   // shoulderWidthRatio requirement excludes pure head reorientation), so
  //   // the exclusion isn't needed for that either.
  //   //
  //   // Re-enabled after briefly disabling it: a teammate's fix (posture-
  //   // rule-detector's SILENT_POSTURES) suppresses the *alert* for HEAD_TURN
  //   // specifically (annoying during calls/meetings) while still wanting it
  //   // detected/recorded as BAD for other consumers like the MAD updater —
  //   // that needs this rule to still match, so disabling it outright here
  //   // was the wrong fix for the same underlying complaint.
  //   required: [
  //     { feature: "headXRatio", operator: "ABS_GT", threshold: 3, reference: "CALIBRATION" },
  //   ],
  //   anyOf: [
  //     { feature: "correctedYaw", operator: "ABS_GT", threshold: 5, reference: "CALIBRATION" },
  //     { feature: "yawProxy", operator: "ABS_GT", threshold: 5, reference: "CALIBRATION" },
  //   ],
  //   supporting: ["headXRatio", "yawProxy", "headRoll"],
  //   reason: "head direction differs from the calibrated direction",
  //   priority: 0.8,
  // },
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
      // shoulderCenterX ABS_LT added: sliding the chair sideways in front of
      // a fixed camera changes the viewing angle enough to also move
      // shoulderWidthRatio/correctedYaw past this rule's thresholds (live
      // capture: shoulderXOffset/shoulderYOffset scores 38/83 confirming a
      // large chair slide, shoulderCenterX -2.35) — the same "no body-
      // relative sideways-move feature" gap SIDE_SHIFT has always had
      // (see comment above), just landing on this rule instead. The three
      // genuine live torso-twist captures (rotating in place, no lean, no
      // slide) scored shoulderCenterX 0.40/-0.61/-0.56 — comfortably under
      // 1.5, while the chair-slide capture's -2.35 clears well past it.
      { feature: "shoulderCenterX", operator: "ABS_LT", threshold: 1.5, reference: "CALIBRATION" },
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

// ===========================================================================
// SIDE-ANGLE-CALIBRATION RULES
//
// Fully independent copy of today's accumulated fixes (NOT derived from
// DEFAULT_POSTURE_RULES above via .map() or any other sharing) — the user
// asked for the two calibration modes to be completely separated so each
// can be tuned one rule at a time without one edit silently affecting the
// other. Own local landmark-group consts below (SIDE_CORE/SIDE_EYES/
// SIDE_EARS) for the same reason, even though they're identical to the
// frontal ones above.
// ===========================================================================

const SIDE_CORE: LandmarkName[] = ["nose", "leftShoulder", "rightShoulder"];
const SIDE_EYES: LandmarkName[] = [...SIDE_CORE, "leftEye", "rightEye"];
// SIDE_EARS only used by HEAD_TURN, disabled below (barely-used posture,
// kept misfiring even after the bodyScale guard) — kept here so
// re-enabling it doesn't need this line rewritten too.
// const SIDE_EARS: LandmarkName[] = [...SIDE_EYES, "leftEar", "rightEar"];

export const SIDE_ANGLE_POSTURE_RULES: readonly PostureRule[] = [
  {
    postureType: "FORWARD_HEAD",
    requiredLandmarks: SIDE_EYES,
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
      // Re-added with a wider threshold than the earlier attempt (removed
      // above): live testing confirmed moving substantially closer to the
      // camera (no real posture change) scores bodyScale ~3.14, while
      // genuine forward-head captures collected so far stayed under ~1.5
      // (one outlier at 1.35) since craning the head forward only brings a
      // *little* of the torso along with it. 2 sits in that gap — loose
      // enough not to repeat the old "blocked genuine detections" failure,
      // tight enough to exclude a real whole-body camera-distance change.
      { feature: "bodyScale", operator: "ABS_LT", threshold: 2, reference: "CALIBRATION" },
      // shoulderCenterY GT added: tilting the camera itself (not leaning
      // toward it) also pushes faceToShoulderRatio and bodyScale into
      // FORWARD_HEAD's range, with no real posture change at all. Live
      // testing (staying in a genuinely correct posture, only tilting the
      // camera) across 4 captures scored shoulderCenterY -3.55/-3.57/-4.76/
      // -5.91 — consistently large and negative, since tilting shifts the
      // person's whole vertical position in frame. Genuine FORWARD_HEAD
      // captures (leaning toward the camera, camera untouched) scored
      // 1.29-2.00 — consistently positive and modest, since the camera
      // itself doesn't move. 0.5 sits cleanly in the gap between them.
      { feature: "shoulderCenterY", operator: "GT", threshold: 0.5, reference: "CALIBRATION" },
    ],
    // faceToShoulderRatio moved from required into anyOf, and
    // headShoulderDistanceRatio added alongside it: live testing found a
    // frontal turtle-neck hold (two captures, 2026-07-21) where
    // faceToShoulderRatio actually normalized *negative* (-0.57/-0.11,
    // failing its old GT 0.7 required condition outright — the face never
    // registered as visually bigger/closer this time) while
    // headShoulderDistanceRatio normalized strongly negative in both
    // (-4.08/-3.93) — the head genuinely got much closer to the shoulder
    // line, just without the face-size growth the old required condition
    // demanded. That matches this same rule's own history above:
    // headShoulderDistanceRatio shrinks for genuine turtle neck (previously
    // measured as low as -13.54), it just isn't the *only* shape a turtle
    // neck hold takes. Treating the two features as alternatives (either
    // signal is enough) catches both variants without loosening the
    // required bodyScale/shoulderCenterY guards that exclude camera-move
    // false positives.
    anyOf: [
      // History: 0.6 (too sensitive) -> 0.8 (session replay: NORMAL_WORK
      // false-positive 9.2%->7.8%, but genuine recall 69.4%->37.0%) -> live
      // testing at 0.8 then showed genuine held FORWARD_HEAD scoring right
      // at the boundary (0.80/1.01/1.12 across 3 captures of the same
      // hold), so ordinary jitter flickered it in and out of match — the
      // 0.8 fix traded oversensitivity for under-detection instead of
      // fixing the real problem (single-frame faceToShoulderRatio doesn't
      // cleanly separate these cases at any threshold, confirmed by the
      // replay's own sweep). 0.7 splits the difference (replay: NORMAL_WORK
      // 8.5%, genuine recall 53.4%) — still a compromise, not a fix.
      { feature: "faceToShoulderRatio", operator: "GT", threshold: 0.7, reference: "CALIBRATION" },
      // -2 sits at roughly half the two live genuine samples' magnitude
      // (-4.08/-3.93), leaving margin against ordinary jitter while still
      // comfortably catching both.
      { feature: "headShoulderDistanceRatio", operator: "LT", threshold: -2, reference: "CALIBRATION" },
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
    requiredLandmarks: SIDE_EYES,
    // Distinct from FORWARD_HEAD: pitchProxy is the direct signal for a
    // downward pitch. feature_discussion's #14 ("고개 숙여서 아래 보기")
    // lists this as a *transient* action (writing, glancing down), but a
    // *sustained* hold of the same pitch is a distinct posture worth its
    // own alert rather than being silently absorbed into FORWARD_HEAD.
    // Threshold raised 0.7 -> 1.8: replayed a real recorded session
    // (session-1784560098508.jsonl) through the current rules —
    // NORMAL_WORK/SETTLING pitchProxy average 0.4-0.53, so 0.7 was far too
    // close to ordinary noise to be a safe bar.
    // Lowered again 1.8 -> 1.3: live capture of a genuine held head-down
    // pitch only scored 1.54 under the current calibration (same MAD-basis
    // drift seen repeatedly this session) and failed to match at all. 1.3
    // clears it while staying well above the jsonl session's ~0.5 noise
    // ceiling.
    // Raised again 1.3 -> 2.2: contrary to this rule's original assumption,
    // faceToShoulderRatio *does* creep up somewhat for a pure head-down too
    // (live capture: 0.72, just past FORWARD_HEAD's own 0.7 threshold) —
    // so a genuine turtle-neck-while-looking-slightly-down blend can score
    // pitchProxy 1.82, just past the old 1.3 bar, and out-evidence
    // FORWARD_HEAD despite being the wrong call (user confirmed it was
    // turtle neck, not head-down). A confirmed genuine pure head-down in
    // the same session scored pitchProxy 3.46 — comfortably clears 2.2,
    // while 1.82 no longer does and falls through to FORWARD_HEAD instead.
    required: [{ feature: "pitchProxy", operator: "GT", threshold: 2.2, reference: "CALIBRATION" }],
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
  {
    postureType: "FORWARD_LEAN",
    requiredLandmarks: SIDE_CORE,
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
    requiredLandmarks: SIDE_EYES,
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
    // faceToShoulderRatio swapped out for shoulderCenterY: live captures
    // across several different calibration sessions showed faceToShoulderRatio
    // swings wildly and unpredictably as lean depth increases (-2.15, -1.09,
    // -0.13, 0.00, +1.03 — the deepest leans actually flipped positive,
    // structurally failing this rule's own LT -1 requirement and leaving the
    // posture undetected or misclassified as FORWARD_HEAD/TORSO_TWIST
    // instead). shoulderCenterY was consistently elevated (1.48-3.60) across
    // every one of those same captures regardless of depth or session —
    // reclining moves the torso's vertical screen position in a way
    // faceToShoulderRatio doesn't reliably track.
    required: [
      { feature: "shoulderCenterY", operator: "GT", threshold: 1.5, reference: "CALIBRATION" },
      { feature: "shoulderWidthRatio", operator: "LT", threshold: -1.3, reference: "CALIBRATION" },
    ],
    supporting: ["headShoulderDistanceRatio", "headYRatio", "forwardLeanProxy", "faceToShoulderRatio"],
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
    // Safe to win outright rather than risk on evidence score: three
    // confirmed live genuine-twist captures (rotating shoulders in place, no
    // lean) scored shoulderCenterY -0.62/-0.03/0.16 — comfortably under this
    // rule's own GT 1.5 requirement — so this still can't steal real twists,
    // it only wins the "pure lean, no twist" case it's meant to.
    priority: 2.1,
  },
  // HEAD_TURN disabled again: barely used in practice, and even with the
  // bodyScale guard below it still misfired on a plain frontal-calibration
  // capture (headXRatio/correctedYaw/yawProxy scores blew up to
  // -7.67/13.57/13.57 off raw values near 0, i.e. that calibration's MAD for
  // these features came out too tight — a separate, still-unfixed MAD
  // sensitivity issue, not something a rule-threshold tweak can fix) while
  // the user confirmed no actual head turn was happening. Keeping the logic
  // (not deleting it) since the bodyScale exclusion work is still worth
  // reusing whenever this gets re-enabled.
  // {
  //   postureType: "HEAD_TURN",
  //   requiredLandmarks: SIDE_EARS,
  //   // headRoll ABS_LT exclusion removed: replaying session-1784560098508.jsonl
  //   // showed real HEAD_TURN groundtruth averages headRoll -3.60 — turning
  //   // the head yaws the eye line too (2D-projection cross-axis
  //   // contamination, the mirror image of the earlier finding that a pure
  //   // tilt contaminates yawProxy), so this exclusion was above its own
  //   // threshold and blocked the rule from ever matching its own posture.
  //   // That's why HEAD_TURN was being swallowed entirely by BACKWARD_LEAN.
  //   // BACKWARD_LEAN no longer competes here anyway (its new
  //   // shoulderWidthRatio requirement excludes pure head reorientation), so
  //   // the exclusion isn't needed for that either.
  //   //
  //   // Re-enabled after briefly disabling it: a teammate's fix (posture-
  //   // rule-detector's SILENT_POSTURES) suppresses the *alert* for HEAD_TURN
  //   // specifically (annoying during calls/meetings) while still wanting it
  //   // detected/recorded as BAD for other consumers like the MAD updater —
  //   // that needs this rule to still match, so disabling it outright here
  //   // was the wrong fix for the same underlying complaint.
  //   required: [
  //     { feature: "headXRatio", operator: "ABS_GT", threshold: 3, reference: "CALIBRATION" },
  //     // bodyScale ABS_LT added: with the fixed-angle side-calibration
  //     // correction (feature-normalizer's correctBodyYaw), moving toward the
  //     // camera (FORWARD_LEAN/HEAD_DOWN/FORWARD_HEAD) started spuriously
  //     // spiking correctedYaw/yawProxy too — live testing under an angled
  //     // calibration found all three misfiring as HEAD_TURN, each scoring
  //     // bodyScale 1.39-4.41 (moving closer). A genuine head turn alone
  //     // shouldn't move bodyScale much since the torso doesn't approach the
  //     // camera — this doesn't fully fix the underlying contamination, just
  //     // excludes the clearest overlapping case.
  //     { feature: "bodyScale", operator: "ABS_LT", threshold: 1, reference: "CALIBRATION" },
  //   ],
  //   anyOf: [
  //     { feature: "correctedYaw", operator: "ABS_GT", threshold: 5, reference: "CALIBRATION" },
  //     { feature: "yawProxy", operator: "ABS_GT", threshold: 5, reference: "CALIBRATION" },
  //   ],
  //   supporting: ["headXRatio", "yawProxy", "headRoll"],
  //   reason: "head direction differs from the calibrated direction",
  //   priority: 0.8,
  // },
  {
    postureType: "HEAD_TILT",
    requiredLandmarks: SIDE_EYES,
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
    requiredLandmarks: SIDE_CORE,
    required: [
      { feature: "shoulderTilt", operator: "ABS_GT", threshold: 2.5, reference: "CALIBRATION" },
    ],
    supporting: ["shoulderAsymmetry"],
    reason: "shoulder heights are asymmetric",
  },
  {
    postureType: "CHIN_REST",
    requiredLandmarks: SIDE_CORE,
    required: [{ feature: "handFaceDistance", operator: "ABS_LT", threshold: 6, reference: "ABSOLUTE" }],
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
    requiredLandmarks: SIDE_EYES,
    required: [{ feature: "pitchProxy", operator: "LT", threshold: -2, reference: "CALIBRATION" }],
    supporting: ["headYRatio", "headShoulderDistanceRatio", "faceToShoulderRatio", "forwardLeanProxy"],
    reason: "head is tilted backward without a matching torso lean",
  },
  // Side-angle-calibration variant of TORSO_TWIST: under an active
  // fixed-angle yaw correction, a twist's shoulderWidthRatio can swing
  // either direction depending on twist direction relative to the
  // calibration's own baked-in rotation — confirmed live via
  // session-1784717447733.jsonl replay (322 genuine TORSO_TWIST frames
  // scored shoulderWidthRatio median +5.88, the opposite sign from the
  // frontal version's LT -1.25 assumption). Checks magnitude only (either
  // sign) and adds faceSize (raw eye-to-eye distance, independent of
  // shoulderWidth) as a guard: a twist rotates the shoulders in place (face
  // size stays flat), while leaning forward/backward moves the whole body
  // and changes shoulder width and face size together.
  {
    postureType: "TORSO_TWIST",
    requiredLandmarks: SIDE_CORE,
    required: [
      { feature: "shoulderWidthRatio", operator: "ABS_GT", threshold: 1.25, reference: "CALIBRATION" },
      // Raised 1.5 -> 2.0: live testing under a large side-angle calibration
      // found genuine twist captures scoring faceSize 1.25/1.85 (the 1.85
      // one failed outright at 1.5), while genuine HEAD_DOWN captures in the
      // same session scored -3.05/-3.39 — a clear gap, so 2.0 covers both
      // twist samples while still excluding real posture changes. Still
      // doesn't cover every case: a twist that swings the live angle
      // drastically past the calibrated baseline (confirmed live:
      // calibrated -58.1 degrees, twisted live to -2.7 degrees, a 55+
      // degree swing) scored faceSize -3.39 — likely MediaPipe's own eye
      // tracking becoming unreliable at that extreme an angle, not
      // something a threshold alone fixes.
      { feature: "faceSize", operator: "ABS_LT", threshold: 2.0, reference: "CALIBRATION" },
      { feature: "correctedYaw", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
      { feature: "shoulderCenterY", operator: "ABS_LT", threshold: 2, reference: "CALIBRATION" },
      { feature: "shoulderCenterX", operator: "ABS_LT", threshold: 1.5, reference: "CALIBRATION" },
    ],
    supporting: ["shoulderTilt", "shoulderDepthAsymmetry"],
    reason: "torso direction differs from the calibrated forward direction",
    priority: 2.0,
  },
  {
    postureType: "ARMREST_LEAN",
    requiredLandmarks: SIDE_CORE,
    required: [
      { feature: "shoulderCenterY", operator: "GT", threshold: 0.7, reference: "CALIBRATION" },
      { feature: "shoulderCenterX", operator: "ABS_GT", threshold: 2, reference: "CALIBRATION" },
      { feature: "bodyScale", operator: "ABS_LT", threshold: 1.5, reference: "CALIBRATION" },
    ],
    supporting: ["shoulderTilt", "shoulderAsymmetry"],
    reason: "body has shifted diagonally to one side without moving closer to or farther from the camera",
  },
];
