import type { DetectionEvent } from "../../core/types";

// Longer, actionable correction text for the fairy's speech bubble — the
// status pill only needs the short label (POSTURE_LABELS below), but a
// nudge that's actually going to change behavior needs to say what to do
// about it. Shared by product-main.ts (visible status pill + fairy) and
// electron-detector-main.ts (headless — only ever sends this to the fairy
// overlay via IPC) so the copy can't drift between the two entry points.
const POSTURE_DETAILS: Partial<Record<string, string>> = {
  FORWARD_HEAD: "고개가 앞으로 나와 거북목이 됐어요. 턱을 목 쪽으로 살짝 당기고, 정수리를 위로 끌어올리듯 목을 펴보세요.",
  HEAD_DOWN: "고개가 아래로 많이 숙여졌어요. 화면 높이를 눈높이까지 올리고, 시선만 아래로 내려서 보는 습관을 들여보세요.",
  HEAD_TILT: "고개가 한쪽으로 기울어져 있어요. 양쪽 귀가 수평이 되도록 천천히 바로잡아주세요.",
  HEAD_BACK: "고개가 뒤로 많이 젖혀졌어요. 턱을 살짝 당기고 목을 편하게 세워주세요.",
  HEAD_TURN: "고개가 옆으로 돌아가 있어요. 모니터 정면을 바라보도록 몸 전체를 화면 쪽으로 돌려보세요.",
  CHIN_REST: "턱을 손으로 괴고 있어요. 손을 내리고 등과 목의 힘으로 자세를 지탱해보세요.",
  CHIN_TUCK: "턱이 눌려서 목에 힘이 들어가고 있어요. 목과 어깨의 긴장을 풀어주세요.",
  SHOULDER_ASYMMETRY: "어깨가 한쪽으로 기울었어요. 양쪽 어깨 높이를 맞추고 힘을 빼보세요.",
  ROUNDED_SHOULDERS: "어깨가 앞으로 말려 있어요. 어깨를 뒤로 살짝 젖히고 가슴을 펴보세요.",
  ARMREST_LEAN: "한쪽 팔걸이에 기대어 몸이 틀어졌어요. 엉덩이를 등받이 끝까지 붙이고 양쪽 무게를 고르게 실어보세요.",
  SIDE_SHIFT: "허리가 틀어져서 몸이 옆으로 치우쳤어요. 골반을 의자 중앙에 맞추고 다시 앉아보세요.",
  FORWARD_LEAN: "몸이 화면 쪽으로 기울어졌어요. 등받이에 등을 기대고 살짝 뒤로 물러나보세요.",
  BACKWARD_LEAN: "몸이 뒤로 많이 젖혀졌어요. 허리를 곧게 세우고 상체를 조금 앞으로 가져와보세요.",
  LOW_SITTING: "자세가 낮게 주저앉았어요. 엉덩이를 등받이 끝까지 붙이고 허리를 세워 앉아보세요.",
  TORSO_TWIST: "상체가 비틀어져 있어요. 골반과 어깨가 같은 방향을 보도록 몸을 정면으로 돌려보세요.",
  SHOULDERS_ONLY_TWIST: "어깨만 비틀어져 있어요. 어깨와 골반이 같은 방향을 향하도록 맞춰보세요.",
};

export function describePostureDetail(event: DetectionEvent, fallback: string): string {
  const detail = event.postureType ? POSTURE_DETAILS[event.postureType] : undefined;
  return detail ?? fallback ?? "지금 자세를 한번 확인해볼까요?";
}

// Turns a DetectionEvent into a short Korean label for the status pill /
// fairy bubble title. Kept separate from feedback-generator's longer
// sentence-form message so the pill stays skimmable.
const POSTURE_LABELS: Partial<Record<string, string>> = {
  FORWARD_HEAD: "거북목이 감지됐어요",
  HEAD_DOWN: "고개가 아래로 숙여졌어요",
  HEAD_TILT: "고개가 기울었어요",
  HEAD_BACK: "고개가 뒤로 젖혀졌어요",
  HEAD_TURN: "고개가 돌아가 있어요",
  CHIN_REST: "턱을 괴고 있어요",
  CHIN_TUCK: "턱이 눌려 있어요",
  SHOULDER_ASYMMETRY: "어깨가 한쪽으로 기울었어요",
  ROUNDED_SHOULDERS: "어깨가 말려 있어요",
  ARMREST_LEAN: "한쪽으로 기대앉았어요",
  SIDE_SHIFT: "몸이 옆으로 치우쳤어요",
  FORWARD_LEAN: "몸이 화면 쪽으로 기울었어요",
  BACKWARD_LEAN: "몸이 뒤로 젖혀졌어요",
  LOW_SITTING: "자세가 낮아졌어요",
  TORSO_TWIST: "상체가 비틀어졌어요",
  SHOULDERS_ONLY_TWIST: "어깨만 비틀어졌어요",
};

export function describePostureLabel(event: DetectionEvent): string {
  return (event.postureType && POSTURE_LABELS[event.postureType]) || "자세를 확인해주세요";
}

// Copy for landmark-reliability's "NO_PERSON" / "UNKNOWN" states (see
// describeUnreliableState in core/landmark-reliability). `wasTracking`
// distinguishes "someone was just here and left" from "no one has shown up
// yet this session" — the caller passes whether the previous frame had a
// live tracked feature, since that's the only place with that context.
export function describePresenceLabel(
  state: "NO_PERSON" | "UNKNOWN",
  wasTracking: boolean,
): string {
  if (state === "NO_PERSON") {
    return wasTracking ? "화면에서 벗어났어요" : "사람이 인식되지 않고 있어요";
  }
  return "자세를 잘 인식하지 못하고 있어요";
}

export function describePresenceDetail(
  state: "NO_PERSON" | "UNKNOWN",
  wasTracking: boolean,
): string {
  if (state === "NO_PERSON") {
    return wasTracking
      ? "카메라 화면 밖으로 나가신 것 같아요. 다시 화면 안으로 들어와 주세요."
      : "카메라에 사람이 보이지 않아요. 화면에 잘 나오는지 확인해주세요.";
  }
  return "카메라 각도나 조명을 조금 조정해보세요.";
}
