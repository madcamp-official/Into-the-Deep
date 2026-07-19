# PostureCore 압축 기획서

## 1. 프로젝트 목표

PostureCore는 웹캠 landmark를 이용해 사용자가 등록한 기준 자세에서 지속적으로 벗어나는지를 감지한다.

핵심 목표는 두 가지다.

1. 지적해야 하는 지속적인 자세 이탈은 감지한다.
2. 정상 작업, 일시 행동, 의자·카메라 이동은 가능한 한 지적하지 않는다.

의학적으로 올바른 자세를 진단하거나 자세 종류를 많이 분류하는 것이 목적은 아니다.

## 2. MVP 범위

- 데스크톱 Chrome 웹앱
- MediaPipe 기반 얼굴·어깨 landmark 추출
- 사용자 1명, 기기 1대, 주 카메라 환경 1개
- 얼굴과 양쪽 어깨가 보이는 정면 중심 환경
- 원본 영상은 저장하지 않음
- Profile은 IndexedDB, 평가 로그는 JSONL에 저장
- 서버, 로그인, 클라우드 동기화는 제외

지원 범위를 벗어난 카메라 변화나 landmark 불안정은 나쁜 자세가 아니라 `UNKNOWN` 또는 재설정 대상으로 처리한다.

## 3. 전체 처리 흐름

```text
Webcam
→ MediaPipe landmarks
→ landmark 신뢰도 검사
→ 카메라·환경 변화 추정 및 제한적 보정
→ 상대 자세 feature 계산
→ Baseline(V0) / Proposed(V2) 판정
→ alert 및 JSONL 기록
→ 동일 로그 replay 평가
```

## 4. Feature 역할 분리

화면상 위치·크기와 실제 자세 변화를 같은 기준으로 직접 판정하지 않는다.

### 자세 판단용 상대 feature

사람이 화면 안에서 이동하거나 크기가 달라져도 가능한 한 유지되는 값이다.

| Feature | 의미 |
| --- | --- |
| Shoulder tilt | 양쪽 어깨를 잇는 선의 각도 |
| Head X ratio | `(얼굴 중심 X - 어깨 중심 X) / 어깨 너비` |
| Head Y ratio | `(얼굴 중심 Y - 어깨 중심 Y) / 어깨 너비` |
| Head-shoulder distance ratio | 얼굴 중심과 어깨 중심 거리 / 어깨 너비 |
| Face-shoulder ratio | 얼굴 너비 / 어깨 너비 |
| Pitch proxy | 얼굴 landmark의 상하 비율로 추정한 고개 숙임 |
| Yaw proxy | 코·눈·귀의 좌우 비대칭으로 추정한 고개 돌림 |

이 feature를 V0와 V2의 실제 자세 drift 판단에 사용한다.

### 환경 변화 판단용 feature

| Feature | 역할 |
| --- | --- |
| Shoulder width / body scale | 카메라 거리 또는 의자 이동 추정 |
| Face center / shoulder center | 화면 내 전체 이동 추정 |
| Framing | 얼굴·어깨가 지원 범위 안에 있는지 확인 |
| 전체 landmark 공통 변환 | translation, scale, 작은 roll 변화 추정 |

환경 feature 하나가 변했다고 자세 `BAD`로 판정하지 않는다.

```text
환경 feature만 변화 + 상대 자세 유지
→ 의자 또는 카메라 이동 가능성
→ alert 없음

상대 자세 feature가 지속적으로 변화
→ 자세 drift 후보
```

## 5. Calibration과 개인 정상 범위

### Original Reference Profile

Calibration에서는 사용자가 기준으로 삼을 자세의 feature 중심값을 median으로 저장한다. 이 중심값은 자동으로 이동하지 않는다.

Adaptive Profile은 사용하지 않는다.

### MAD 초기값과 업데이트

Calibration에서 MAD를 직접 계산하지 않는다. 경직된 자세로 인해 정상 범위가 지나치게 좁아지는 문제를 막기 위해 feature별 공통 초기 MAD를 사용한다.

```text
초기 정상 중심 = 개인 Calibration median
초기 정상 변동 폭 = feature별 공통 MAD 초기값
```

이후 정상으로 판단된 안정 구간의 분포를 이용해 MAD만 개인화한다.

업데이트 조건:

- 상태가 `STABLE` 또는 `RECOVERED`
- landmark confidence가 높음
- motion energy가 낮음
- 카메라 상태가 유효함
- alert 또는 drift 의심 상태가 아님
- 현재 값이 기존 정상 범위를 크게 벗어나지 않음

최근 안정 구간에서 median absolute deviation 또는 IQR 기반 scale을 계산하고 기존 MAD에 천천히 반영한다.

```text
updatedMAD = (1 - alpha) × previousMAD + alpha × stableWindowMAD
```

MAD에는 feature별 `min`과 `max`를 둔다. 지속적인 나쁜 자세가 정상 범위를 무제한으로 넓히지 못하도록 업데이트 대상과 변화량도 제한한다.

공식 Test Session에서는 MAD 업데이트를 비활성화하고 Development Session에서 확정한 값을 사용한다.

## 6. 카메라 변화 처리

카메라와 바닥의 물리적 각도를 직접 측정하지 않는다. Calibration 당시의 landmark 분포를 Camera Profile로 저장하고 현재 전체 landmark 변화와 비교한다.

- 작은 translation, scale, roll 변화: 자동 보정 후 판정
- 큰 변화 또는 보정이 모호한 경우: `UNKNOWN` 또는 `RECALIBRATION_REQUIRED`
- 얼굴만 변하고 어깨가 유지되는 경우: 고개 돌림 가능성
- 얼굴과 어깨가 함께 같은 방식으로 변하는 경우: 카메라 변화 가능성

2D landmark만으로 큰 상하·좌우 카메라 회전을 완벽히 복원하는 것은 목표에서 제외한다.

## 7. 비교 알고리즘

V1은 별도 버전으로 두지 않는다. 개인화된 drift score는 V2 내부 단계로 포함한다.

### Baseline (V0)

- 상대 자세 feature에 팀 공통 fixed threshold 적용
- 하나 이상의 기준이 임계값을 지속적으로 넘으면 alert
- 개인별 MAD, 카메라 자동 보정, motion state, recovery 없음
- 기존 방식의 오탐과 한계를 보여주는 비교 기준

### Proposed (V2)

- 고정된 Original Reference 중심 사용
- feature별 초기 MAD와 정상 구간 기반 MAD 업데이트
- 상대 feature의 정규화된 이탈을 결합해 drift score 계산
- 작은 카메라·의자 이동은 환경 변화로 분리
- motion energy와 시간 상태로 일시 행동과 지속 drift 구분

```text
STABLE
→ MOVING
→ SETTLING
→ STABLE                 일시 행동, alert 없음

STABLE
→ MOVING
→ SETTLING
→ DRIFT_SUSPECTED
→ SUSTAINED_DRIFT
→ ALERTED                지속 자세 이탈
```

## 8. 기록과 평가

JSONL 로그에는 다음을 저장한다.

- Calibration metadata: Original Profile, Camera Profile, MAD 설정, 생성 시각
- timestamp, confidence, 상대 자세 feature, 환경 feature
- motion energy, camera state, detector state, alert, dominant features
- ground-truth label과 `scenarioStarted`, `driftOnset`, `scenarioEnded`

Development Session은 threshold, 초기 MAD, MAD min/max, 시간 상태 파라미터를 정하는 데 사용한다. 값을 확정한 뒤 별도의 Test Session에서 수정 없이 V0와 V2를 비교한다.

핵심 지표:

| 지표 | 목표 |
| --- | --- |
| 시간당 오탐 수 | V2가 V0보다 감소 |
| 지속 drift 탐지율 | V2가 V0 수준을 유지하거나 개선 |
| 평균 탐지 지연 | 허용 범위 안에서 유지 |
| 자연 행동 오탐률 | V2가 V0보다 감소 |
| 자세 종류별 탐지율 | 특정 자세만 놓치는 문제 확인 |

연속된 alert 프레임은 하나의 alert episode로 계산한다. 자세를 만드는 전이 구간은 평가에서 제외하고 `driftOnset` 이후부터 탐지 여부와 지연시간을 계산한다.

## 9. 주요 검증 시나리오

- 정상 타이핑과 마우스 사용
- 잠깐 키보드 보기, 물 마시기, 옆 화면 보기
- 앞으로 숙인 자세 유지
- 머리만 앞으로 내민 자세 유지
- 좌우 기울임과 좌우 이동
- 고개 돌림
- 자세를 유지한 채 의자 앞뒤·좌우 이동
- 작은 카메라 위치·각도 변화
- 지원 범위를 벗어난 큰 카메라 변화

## 10. 완료 기준

- Calibration으로 Original Profile과 Camera Profile 생성 가능
- 공통 초기 MAD로 시작하고 안전한 정상 구간에서 MAD 업데이트 가능
- 상대 자세 feature와 환경 feature가 분리되어 사용됨
- V0와 V2를 동일 JSONL 로그에서 replay 가능
- V2가 지속 drift 탐지율을 유지하면서 V0보다 정상·자연 행동 오탐을 줄임
- 큰 카메라 변화는 자세 경고 대신 판정 보류 또는 재설정을 요청함
