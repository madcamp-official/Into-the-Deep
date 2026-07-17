# 기획서

# PostureCore 기획서

## 1. 프로젝트 개요

### 프로젝트명

**PostureCore: Robust Personalized Posture Drift Detection**

### 선택 옵션

**Option 1. Build the Core**

### 개발 기간 및 인원

- 기간: 6일
- 인원: 3명
- 세 명 모두 자세 판정 코어와 평가 시스템 개발에 참여한다.
- 별도의 UI 전담자는 두지 않는다.

### 한 줄 설명

웹캠에서 AI 기반으로 추출한 자세 landmark를 이용해 사용자별 기준 자세와 카메라 환경을 모델링하고, 일시적인 움직임과 지속적인 자세 이탈을 구분하여 불필요한 알림을 줄이는 실시간 자세 drift 탐지 엔진이다.

---

## 2. 문제 정의

일반적인 웹캠 자세 감지 시스템은 어깨 기울기, 머리 위치, 얼굴 크기 등이 미리 정한 임계값을 넘으면 잘못된 자세라고 판단한다.

하지만 실제 사용자는 작업 중 다음과 같은 자연스러운 행동을 반복한다.

- 키보드를 잠시 내려다보기
- 물 마시기
- 옆 모니터 보기
- 의자 위치 조정
- 기지개 켜기
- 물건을 집기 위해 몸 숙이기

또한 landmark 변화는 자세 변화뿐 아니라 다음과 같은 카메라 환경 변화로도 발생할 수 있다.

- 노트북 화면을 더 펴거나 접는 경우
- 노트북을 앞뒤로 이동하는 경우
- 카메라의 높이가 조금 변하는 경우
- 사용자가 카메라 중심에서 조금 이동하는 경우

이러한 변화를 모두 잘못된 자세로 판단하면 불필요한 알림이 반복되고, 사용자는 프로그램을 신뢰하지 않게 된다.

본 프로젝트가 해결하려는 핵심 문제는 다음과 같다.

> 사용자별 체형과 정상 자세 범위, 자연스러운 일시 행동, 제한적인 카메라 환경 변화를 고려하면서 지속적인 자세 이탈만 안정적으로 감지할 수 있는가?
> 

---

## 3. 프로젝트 목표

본 프로젝트는 여러 건강 기능을 제공하는 종합 자세 교정 앱을 만드는 것이 아니다.

다음의 하나의 기술 문제에 집중한다.

> 고정 임계값 기반 자세 감지기의 오탐을 줄이는 개인화된 자세 drift 판정 코어를 구현하고, 개선 정도를 재현 가능한 평가 방법으로 검증한다.
> 

핵심 가설은 다음과 같다.

> 개인별 정상 자세 분포, 카메라 환경 검증, 움직임량과 시간 상태 추론을 적용하면 고정 임계값 방식보다 정상 작업 중 오탐을 줄이면서 지속적인 자세 drift 탐지 성능을 유지할 수 있다.
> 

PostureCore는 의학적으로 올바른 자세를 판정하지 않는다.

> 사용자가 직접 등록한 기준 자세에서 지속적으로 벗어나는지를 감지한다.
> 

---

## 4. MVP 확정 사항

1. MVP는 데스크톱 Chrome 브라우저에서 실행되는 웹앱으로 구현한다.
2. 모바일 앱과 데스크톱 설치형 앱은 필수 범위에서 제외한다.
3. 하나의 사용자, 하나의 기기, 하나의 주 카메라 환경을 기준으로 한다.
4. 카메라는 사용자의 정면에서 약 30도 이내를 공식 지원 범위로 둔다.
5. 얼굴과 양쪽 어깨가 안정적으로 보여야 한다.
6. 사용자는 처음 calibration에서 자신이 기준으로 삼고 싶은 자세를 등록한다.
7. 기준 자세는 의학적인 정답이 아니라 사용자가 등록한 reference posture이다.
8. 작은 카메라 거리·위치·기울기 변화는 제한적으로 자동 보정한다.
9. 자동 보정 가능 범위를 넘으면 자세 경고 대신 recalibration을 요청한다.
10. 노트북 화면이 펴진 각도는 직접 측정하지 않고 landmark 분포 변화로 간접 감지한다.
11. 정상 자세 업데이트 후보는 자동으로 감지하지만, 실제 profile 반영은 사용자의 확인을 거친다.
12. 원본 영상과 얼굴 이미지는 저장하지 않는다.
13. posture profile과 camera profile은 브라우저 IndexedDB에 저장한다.
14. 평가용 landmark·feature·state 로그는 JSON 또는 JSONL로 내보낸다.
15. 별도의 서버 DB, 로그인, 계정 동기화 기능은 사용하지 않는다.
16. 공식 평가 지표는 시간당 오탐 수와 지속 자세 drift 탐지율 두 개로 한다.
17. 평균 탐지 지연시간은 보조 지표로 기록한다.
18. calibration 기준 자세 guideline은 현재 자세와의 차이를 보여주는 시각적 피드백으로만 사용한다.
19. 데스크톱 앱은 향후 확장 계획으로만 다룬다.
20. Docker는 실시간 앱 실행이 아니라 replay evaluator의 재현 환경에 선택적으로 사용한다.

---

## 5. 프로젝트 범위

### 반드시 구현할 기능

1. 웹캠 입력
2. MediaPipe 기반 pose landmark 추출
3. landmark confidence 및 유효성 판정
4. 좌표 정규화
5. posture feature 계산
6. camera profile 생성
7. 카메라 환경 변화 감지
8. 고정 임계값 V0 Baseline
9. 개인화된 V1 Drift Detector
10. 움직임과 시간 상태를 분석하는 V2 Detector
11. guideline overlay
12. reference posture와 camera profile의 로컬 저장
13. landmark 및 feature 로그 기록
14. ground-truth labeling 기능
15. replay evaluator
16. V0·V1·V2 성능 비교

### 최소 UI

하나의 화면을 중심으로 구현한다.

- 카메라 영상
- 현재 skeleton
- calibration 기준 skeleton 또는 guideline
- 현재 drift score
- 현재 상태
- camera 상태
- landmark 신뢰도
- 알림 메시지
- Calibration 버튼
- 측정 시작·종료 버튼
- 기준 자세 업데이트 버튼
- 로그 다운로드 버튼
- recalibration 안내

### 구현하지 않을 기능

- 거북목, 척추 질환 등 의료 진단
- 의학적으로 올바른 자세 판정
- 졸음 감지
- 눈 깜빡임 및 안구 건조 감지
- 조도 감지
- 스트레칭 추천
- 장기 건강 리포트
- 회원가입과 로그인
- 서버 DB
- 여러 기기 간 profile 동기화
- 모바일 앱
- 운영체제 부팅 시 자동 실행
- 시스템 트레이 상주
- 다른 프로그램 위에 표시되는 OS 수준 overlay
- 자체 pose estimation 모델 학습
- LSTM·Transformer 등 대규모 시계열 모델 학습

---

## 6. AI 활용 방식

PostureCore에서는 AI를 두 단계로 구분한다.

### 6.1 AI 기반 landmark 추출

사전 학습된 MediaPipe Pose 모델을 이용해 카메라 영상에서 코, 눈, 귀, 어깨, 골반 등의 신체 landmark를 추출한다.

```
Camera image
→ MediaPipe Pose AI
→ Pose landmarks
```

MediaPipe는 영상에서 landmark를 추출하는 AI 계층이다.

### 6.2 개인화된 자세 이상 탐지

MediaPipe가 추출한 landmark를 그대로 정상·비정상으로 분류하지 않는다.

landmark로부터 자세 특징값을 계산한 뒤, 사용자의 calibration 데이터에서 정상 자세 분포를 만든다.

MVP에서는 다음 방식 중 설명 가능성과 안정성이 높은 방식을 사용한다.

- Median과 MAD 기반 robust drift score
- 평균과 표준편차 기반 normalized score
- 데이터가 충분히 안정적인 경우 Mahalanobis distance

직접 학습한 딥러닝 모델은 사용하지 않는다. 적은 calibration 데이터에서도 동작하고, 어떤 특징이 판정에 영향을 미쳤는지 설명할 수 있는 통계적 이상 탐지 방식을 우선한다.

---

## 7. 시스템 구조

```
Web Camera
   ↓
Web Camera Adapter
   ↓
MediaPipe Pose Landmarker
   ↓
Landmark Reliability Filter
   ↓
Camera Profile Validator
   ├─ 정상 범위: 그대로 진행
   ├─ 작은 변화: scale/offset 보정
   └─ 큰 변화: 판정 중단 및 recalibration
   ↓
Feature Normalizer
   ↓
Posture Feature Vector
   ├─ V0 Fixed Threshold Detector
   ├─ V1 Personalized Drift Detector
   └─ V2 Personalized Temporal Detector
   ↓
Posture Feedback Generator
   ├─ Web Canvas Overlay
   ├─ Alert Message
   └─ Calibration Guideline
   ↓
IndexedDB / Session Logger
   ↓
Replay Evaluator
   ↓
Metrics Report
```

실시간 판정 코어와 웹 UI를 분리한다.

```
Core Engine
- feature processing
- personalization
- camera validation
- drift scoring
- state machine
- evaluation

Web Adapter
- camera permission
- canvas rendering
- buttons
- IndexedDB
```

이 구조를 통해 향후 Electron 또는 Tauri 데스크톱 앱에서도 코어 엔진을 재사용할 수 있게 한다.

---

## 8. Landmark 및 Feature Pipeline

### 주요 landmark

- 코
- 양쪽 눈 또는 귀
- 양쪽 어깨
- 양쪽 골반

골반 landmark가 책상이나 물체에 가려져 신뢰도가 낮으면 골반 기반 feature를 사용하지 않는다.

### Reliability Filter

다음 상황에서는 자세 판정을 보류한다.

- 사람이 화면에 없음
- 코 또는 양쪽 어깨 landmark 신뢰도가 낮음
- 얼굴이나 어깨 일부가 화면 밖으로 나감
- 카메라 입력이 중단됨
- 갑작스러운 landmark 좌표 점프가 발생함
- 카메라 환경이 지원 범위를 크게 벗어남

이러한 프레임은 `BAD`가 아니라 `UNKNOWN`으로 처리한다.

### 좌표 정규화

```
원점: 양쪽 어깨 중심
크기 기준: 양쪽 어깨 사이 거리
```

화면 픽셀이 아니라 어깨 너비에 대한 상대적 위치를 사용한다.

### 주요 posture feature

| Feature | 의미 |
| --- | --- |
| Shoulder tilt | 좌우 어깨 기울기 |
| Head lateral offset | 머리가 어깨 중심에서 좌우로 이동한 정도 |
| Head vertical offset | 머리가 기준 위치에서 위아래로 이동한 정도 |
| Body scale | 사용자와 카메라 사이 거리 변화 |
| Torso lean | 골반이 보일 때 상체 기울기 |
| Motion energy | 최근 feature 변화량 |
| Landmark reliability | 판정에 사용할 수 있는 입력인지 나타내는 값 |

---

## 9. Camera Profile과 자동 보정

Calibration에서는 posture profile뿐 아니라 camera profile도 함께 생성한다.

### Camera Profile 예시

- 기준 shoulder width
- 기준 face center
- 기준 shoulder center
- 얼굴과 어깨의 상대 위치
- 얼굴과 어깨 크기 비율
- 좌우 landmark 비대칭
- yaw proxy
- pitch proxy
- 화면 내 여백 및 framing 상태

브라우저에서 노트북 힌지 각도를 직접 읽지는 않는다.

노트북 화면 각도가 변하면 얼굴·어깨의 화면 위치와 상대 비율이 변하므로 이를 camera profile 변화로 간접 감지한다.

### 카메라 상태

```
VALID
- calibration 환경과 충분히 유사함

ADJUSTED
- 작은 scale 또는 offset 변화
- 보정 후 자세 판정 진행

RECALIBRATION_REQUIRED
- 카메라 위치나 각도 변화가 큼
- 자세 판정과 알림 중단
- recalibration 요청
```

자동 보정은 다음 정도로 제한한다.

- 화면 중심의 작은 이동
- 사람과 카메라 거리의 작은 변화
- 노트북 화면 각도의 작은 변화
- 카메라 높이의 작은 변화

정면 약 30도를 크게 벗어나거나 얼굴·어깨가 잘리는 경우에는 자동 보정하지 않는다.

카메라 보정 모듈은 모든 V0·V1·V2가 공통으로 사용하는 입력 검증 계층으로 둔다. 이를 통해 V0·V1·V2 비교에서는 판정 알고리즘의 차이만 평가한다.

---

## 10. Calibration과 정상 자세 Profile

### Calibration 절차

1. 카메라와 사용자의 위치를 조정한다.
2. 얼굴과 양쪽 어깨가 정상적으로 보이는지 확인한다.
3. 사용자가 기준으로 삼고 싶은 자세로 앉는다.
4. 30초 동안 landmark와 feature를 수집한다.
5. 신뢰도가 낮거나 움직임이 큰 프레임은 제외한다.
6. reference posture profile을 생성한다.
7. camera profile을 생성한다.
8. 기준 skeleton을 guideline으로 저장한다.

### Profile 구성

#### Original Reference Profile

- 최초 calibration에서 등록한 기준 자세
- 쉽게 변경되지 않는다.
- adaptive profile이 잘못된 방향으로 이동하는 것을 막는 기준점이다.

#### Adaptive Profile

- 실제 drift score 계산에 사용되는 조정 가능한 profile
- 처음에는 Original Reference와 동일하다.
- 사용자가 확인한 교정 자세를 작은 비율로 반영한다.
- Original Reference에서 일정 범위 이상 벗어날 수 없다.

### 정상 자세 업데이트

완전 자동으로 profile을 변경하지 않는다.

```
알림 발생
→ 사용자가 자세를 교정
→ 시스템이 STABLE 또는 RECOVERED 확인
→ 10~20초간 낮은 motion energy 유지
→ 높은 landmark reliability 확인
→ Original Reference와 가까운지 확인
→ “이 자세를 기준에 반영할까요?” 표시
→ 사용자 확인
→ Adaptive Profile에 일부 반영
```

예시:

```
updatedAdaptive
= 0.98 × previousAdaptive
+ 0.02 × correctedPosture
```

공식 test session에서는 공정한 비교를 위해 adaptive update를 비활성화하고 calibration profile을 고정한다.

---

## 11. V0 Baseline 설계

### 이름

**Reference-centered Fixed Threshold Detector**

논문에서 사용한 MediaPipe landmark 기반 고정 임계값 판정 방식을 참고한다. 해당 논문은 어깨 높이 차이와 머리 위치 편차를 계산하고 고정된 범위로 정자세·기울어짐·엎드림 등을 분류했다.

### 동작 방식

1. Calibration profile에서 feature 중심값을 가져온다.
2. 현재 feature와 기준값의 절대 차이를 계산한다.
3. 팀원 모두에게 동일한 고정 임계값을 적용한다.
4. 하나 이상의 feature가 임계값을 넘으면 `BAD` 후보로 판단한다.
5. `BAD`가 1.5초 이상 지속되면 경고한다.

### 초기 임계값 후보

| Feature | 초기 임계값 |
| --- | --- |
| 어깨 기울기 변화 | 8도 |
| 머리 좌우 이동 | 어깨 너비의 20% |
| 머리 하강 | 어깨 너비의 18% |
| 카메라 접근 | 기준 크기 대비 25% 증가 |
| 상체 기울기 변화 | 10도 |
| 지속 시간 | 1.5초 |

Development session에서 한 번 조정한 뒤 고정한다.

V0에는 다음 기능을 사용하지 않는다.

- feature별 개인 정상 변동 폭
- 복합 drift score
- motion energy
- 시간 상태 머신
- adaptive profile
- 사용자별 동적 임계값

---

## 12. V1 Personalized Drift Detector

V1은 현재 자세가 사용자의 정상 자세 분포에서 얼마나 벗어났는지를 계산한다.

```
feature deviation
= |현재 feature - 개인 기준값|
  / 개인 정상 변동 폭
```

여러 feature의 이탈 정도를 결합해 하나의 drift score를 생성한다.

```
낮은 score
→ 개인 정상 범위

중간 score
→ 자세 이탈 가능성

높은 score
→ 개인 기준에서 크게 벗어남
```

V1은 사용자별 체형과 평소 자세, calibration 중 발생한 자연스러운 흔들림을 반영한다.

다만 V1은 시간적 행동 흐름을 깊게 해석하지 않는다.

따라서 다음과 같은 짧은 행동에서도 drift score가 일시적으로 높아질 수 있다.

- 물 마시기
- 키보드 보기
- 옆 화면 보기
- 기지개 켜기

V1에서는 높은 drift score가 단순 지속시간을 넘으면 경고하도록 한다.

---

## 13. V2 Personalized Temporal Detector

V2는 V1의 개인화 drift score에 motion energy와 시간 상태 머신을 결합한다.

```
V1 drift score
+ motion energy
+ 최근 상태 변화
+ recovery 조건
+ cooldown
→ 최종 알림
```

### 상태 머신

```
STABLE
→ MOVING
→ SETTLING
→ DRIFT_SUSPECTED
→ SUSTAINED_DRIFT
→ ALERTED
→ RECOVERED
```

### 물 마시기

```
STABLE
→ MOVING
→ SETTLING
→ STABLE
```

기준 자세로 복귀했으므로 알림을 발생시키지 않는다.

### 앞으로 숙인 채 계속 작업

```
STABLE
→ MOVING
→ SETTLING
→ DRIFT_SUSPECTED
→ SUSTAINED_DRIFT
→ ALERTED
```

움직임이 끝난 뒤에도 높은 drift score가 유지되므로 경고한다.

### V1과 V2의 차이

| V1 | V2 |
| --- | --- |
| 현재 자세가 개인 기준에서 얼마나 벗어났는지 판단 | 그 벗어남이 일시적인 행동인지 지속적인 자세 이탈인지 판단 |
| 개인화된 score 중심 | 개인화된 score + 시간 상태 |
| 짧은 행동에도 score가 높아질 수 있음 | 움직임과 회복 과정을 추적 |
| 단순 지속시간 조건 | MOVING·SETTLING·RECOVERED 상태 사용 |
| 개인차 개선 효과 측정 | 일시 행동 오탐 감소 효과 측정 |

---

## 14. Guideline 및 Feedback

Guideline은 의학적으로 올바른 자세를 보여주는 것이 아니다.

> 사용자가 calibration에서 등록한 기준 자세와 현재 자세의 차이를 시각화한다.
> 

정상 상태에서는 현재 skeleton만 표시한다.

지속 drift가 감지되면 다음을 표시한다.

- Calibration 기준 skeleton
- 현재 skeleton
- 차이가 큰 부위
- 기준 자세에서 벗어난 방향
- 간단한 설명

예시:

- 머리가 기준 위치보다 아래로 이동했습니다.
- 상체가 기준보다 카메라에 가까워졌습니다.
- 왼쪽 어깨의 높이 차이가 커졌습니다.
- 카메라 환경이 변경되어 recalibration이 필요합니다.

LLM은 사용하지 않고 feature 차이와 dominant feature에 따라 설명 문구를 규칙적으로 생성한다.

---

## 15. 데이터 저장 구조

MVP는 하나의 기기와 하나의 Chrome 브라우저 환경을 기준으로 하므로 별도 서버 DB를 사용하지 않는다.

### IndexedDB 저장 항목

- Original Reference Profile
- Adaptive Profile
- Camera Profile
- Calibration guideline
- 사용자 설정
- 마지막 calibration 시간

### JSON 또는 JSONL 저장 항목

- timestamp
- ground-truth label
- landmark confidence
- 주요 landmark
- posture features
- camera state
- drift score
- state
- alert 여부
- dominant features

### 저장하지 않는 데이터

- 원본 카메라 영상
- 얼굴 이미지
- 스크린샷
- 음성
- 서버 전송 데이터

브라우저 데이터 삭제에 대비해 profile export/import는 선택 기능으로 둔다.

---

## 16. 코어 인터페이스

```
interfaceFrameFeature {
  timestamp:number;
  confidence:number;
  shoulderTilt:number;
  headXOffset:number;
  headYOffset:number;
  bodyScale:number;
  torsoLean?:number;
  motionEnergy:number;
}
```

```
interfaceCameraProfile {
  shoulderWidth:number;
  faceCenterX:number;
  faceCenterY:number;
  shoulderCenterX:number;
  shoulderCenterY:number;
  faceToShoulderRatio:number;
  yawProxy:number;
  pitchProxy:number;
}
```

```
interfaceCameraAssessment {
  timestamp:number;
  state:"VALID"|"ADJUSTED"|"RECALIBRATION_REQUIRED";
  scaleCorrection:number;
  offsetX:number;
  offsetY:number;
  reliability:number;
}
```

```
interfaceUserProfile {
  originalCenters:Record<string,number>;
  adaptiveCenters:Record<string,number>;
  featureDeviations:Record<string,number>;
  calibrationDuration:number;
  validFrameCount:number;
}
```

```
interfaceDriftObservation {
  timestamp:number;
  driftScore:number;
  reliability:number;
  dominantFeatures:string[];
}
```

```
interfaceDetectionEvent {
  timestamp:number;
  state:string;
  alert:boolean;
  reason:string[];
}
```

```
interfacePostureFeedback {
  timestamp:number;
  state:string;
  alert:boolean;
  guidelineVisible:boolean;
  message:string;
  dominantFeatures:string[];
}
```

---

## 17. 평가 설계

### 비교 버전

| 버전 | 구성 |
| --- | --- |
| V0 | Reference-centered fixed threshold |
| V1 | Personalized drift score |
| V2 | V1 + motion energy + temporal state machine |

Camera Profile Validator와 Reliability Filter는 세 버전에 공통으로 적용한다.

### 참가자

팀원 3명이 모두 평가에 참여한다.

외부 참가자는 시간이 남을 경우 추가하되 필수 범위에는 포함하지 않는다.

### 데이터 분리

각 팀원이 Development Session과 Test Session을 별도로 수행한다.

#### Development Session

- feature 안정성 확인
- baseline threshold 결정
- drift score threshold 결정
- motion energy 기준 결정
- state transition 시간 결정
- camera 보정 범위 결정

#### Test Session

- 최종 성능 측정 전용
- Test Session을 확인한 뒤 알고리즘이나 threshold를 수정하지 않는다.
- Adaptive Profile 업데이트를 비활성화한다.

---

## 18. 참가자별 Test Session

### 1. Calibration

- 30초
- 사용자가 기준 자세 유지
- Original Reference와 Camera Profile 생성

### 2. 정상 작업

1인당 10분 동안 다음 행동을 수행한다.

- 타이핑
- 마우스 사용
- 키보드 잠시 보기
- 물 마시기 2회
- 옆 화면 보기 3회
- 기지개 켜기 2회
- 의자 위치 조정 2회

이 구간은 `NORMAL_WORK`로 라벨링한다.

### 3. 지속 drift 시나리오

다음 자세를 각각 3회, 15초간 유지한다.

- 앞으로 숙이기
- 왼쪽으로 기대기
- 오른쪽으로 기대기
- 카메라 쪽으로 가까이 다가가기

각 이벤트 사이에는 15~20초간 기준 자세로 돌아간다.

1인당 12개, 3명 기준 총 36개 이상의 drift 이벤트를 수집한다.

### Ground Truth

타이머 기반 시나리오 화면을 사용해 시작과 종료 시점을 자동 기록한다.

```
NORMAL_WORK
FORWARD_LEAN
LEFT_LEAN
RIGHT_LEAN
CLOSE_TO_CAMERA
CAMERA_CHANGE
```

원본 영상 없이도 정확한 시나리오 시작·종료 시점을 로그에 저장한다.

---

## 19. Replay Evaluation

동일한 feature sequence에 V0·V1·V2를 각각 실행한다.

```
Test JSONL
   ↓
V0 Replay
   ↓
V1 Replay
   ↓
V2 Replay
   ↓
Ground Truth와 비교
   ↓
Metrics Report
```

동일한 입력을 사용하므로 사용자 행동과 카메라 FPS 차이 없이 알고리즘만 공정하게 비교할 수 있다.

### 로그 예시

```
{
  "timestamp":31.42,
  "groundTruth":"NORMAL_WORK",
  "cameraState":"VALID",
  "confidence":0.94,
  "features": {
    "shoulderTilt":2.1,
    "headXOffset":0.06,
    "headYOffset":0.93,
    "bodyScale":1.04,
    "motionEnergy":0.12
  }
}
```

---

## 20. 평가 지표

### 공식 지표 1: 정상 작업 중 시간당 오탐 수

```
False Alerts per Hour
= 정상 작업 중 발생한 오탐 episode 수
  / 정상 작업 시간
```

연속해서 유지되는 하나의 경고는 프레임 수와 관계없이 1회로 계산한다.

### 공식 지표 2: 지속 자세 drift 탐지율

```
Sustained Drift Detection Rate
= 제한 시간 안에 탐지한 drift 이벤트 수
  / 전체 drift 이벤트 수
```

Drift 시작 후 10초 안에 경고가 발생하면 탐지 성공으로 계산한다.

### 보조 지표: 평균 탐지 지연

```
Detection Delay
= 최초 경고 시각 - Drift 시작 시각
```

### 카메라 강건성 테스트

사용자는 기준 자세를 유지하고 카메라 환경만 조금 변경한다.

- 노트북 화면 각도 소폭 변경
- 노트북을 5~10cm 이동
- 화면 중심 소폭 이동
- 노트북 높이 소폭 변경

허용 범위 안에서는 자세 경고가 발생하지 않아야 한다.

허용 범위를 넘으면 `BAD_POSTURE`가 아니라 `RECALIBRATION_REQUIRED`가 발생해야 한다.

이 결과는 공식 두 지표와 별도로 사례 기반으로 보고한다.

---

## 21. 성공 기준

다음 목표를 프로젝트 시작 전에 고정한다.

1. V2는 V0 대비 정상 작업 중 시간당 오탐을 50% 이상 줄인다.
2. V2의 지속 자세 drift 탐지율은 80% 이상이다.
3. 평균 탐지 지연은 10초 미만이다.
4. 큰 카메라 환경 변화를 자세 drift로 경고하지 않고 recalibration으로 분류한다.

목표를 달성하지 못하더라도 V0→V1→V2 변화와 실패 원인을 분석한다.

예:

- V0→V1 개선: 개인화 효과
- V1→V2 개선: 시간 상태 추론 효과
- 탐지율 감소: state transition 대기시간 문제
- 카메라 오탐: Camera Profile Validator의 허용 범위 문제

---

## 22. 3인 역할 분담

### 팀원 A — Vision Input, Landmark Reliability & Feature Pipeline (김혜리)

#### 담당 업무

- MediaPipe 연결
- 웹캠 입력 처리
- 주요 landmark 추출
- landmark confidence filter
- 사람이 화면에 있는지 여부 판정
- 얼굴·양쪽 어깨가 화면 안에 있는지 판정
- 좌표 정규화
- posture feature 계산
- camera profile에 필요한 raw feature 계산
    - shoulder width
    - face center
    - shoulder center
    - face-to-shoulder ratio
    - yaw/pitch proxy 후보값
- skeleton overlay 렌더링 데이터 생성
- feature sequence 로그 저장 형식 제공

#### 담당 산출물

```
FrameFeatureCameraRawFeatureLandmarkQualityGuideSkeleton
```

#### 핵심 기술 문제

> 카메라 거리, 해상도, landmark 흔들림, 신뢰도 문제를 처리하면서 B와 C가 안정적으로 사용할 수 있는 자세 feature를 어떻게 생성할 것인가?
> 

#### 부담 조정 포인트

A는 **카메라 변화 감지의 최종 판단**까지 맡지 않는다.

A는 카메라 상태 판단에 필요한 raw feature만 만든다.

예를 들어:

```
A 담당:
shoulderWidth가 얼마인지 계산

B 담당:
shoulderWidth 변화가 보정 가능한 수준인지 판단
```

---

### 팀원 B — Baseline, Personalization & Profile Management (조예준)

#### 담당 업무

- V0 Fixed Threshold Baseline 구현
- calibration 처리
- Original Reference Profile 생성
- Adaptive Profile 생성
- 개인별 정상 변동 폭 계산
- V1 drift score 계산
- dominant feature 계산
- camera profile 생성 및 비교
- camera 상태 판정
    - VALID
    - ADJUSTED
    - RECALIBRATION_REQUIRED
- 작은 카메라 변화에 대한 scale/offset 보정 기준 설정
- adaptive update 후보 판정
- 사용자 확인 기반 adaptive update 반영
- IndexedDB profile 저장 및 불러오기
- V0와 V1 비교

#### 담당 산출물

```
UserProfileCameraProfileCameraAssessmentDriftObservationProfileStorage
```

#### 핵심 기술 문제

> 사용자별 정상 자세와 자연스러운 변동을 어떻게 모델링하고, 카메라 환경 변화와 자세 drift를 어떻게 분리하면서 profile이 잘못된 자세 방향으로 오염되는 것을 막을 것인가?
> 

#### 부담 조정 포인트

B는 **profile과 score의 책임자**다.

즉, A가 feature를 만들면 B는 그 feature를 이용해 다음을 판단한다.

```
이 사용자의 정상 범위인가?
개인 기준에서 얼마나 벗어났는가?
카메라가 바뀐 것인가, 자세가 바뀐 것인가?
이 자세를 adaptive profile에 반영해도 되는가?
```

---

### 팀원 C — Temporal Decision, Scenario Labeling & Evaluation (정유진)

#### 담당 업무

- V2 state machine 구현
- motion energy 기반 상태 전이 판단
- slow drift 탐지 로직 구현
- drift evidence 누적 로직 구현
- recovery 조건
- cooldown
- PostureFeedback 생성
- alert message 생성
- guideline 표시 조건 결정
- scenario labeling 도구
- test session 진행용 타이머/시나리오 도구
- replay evaluator 구현
- 공식 지표 자동 계산
    - 시간당 오탐 수
    - 지속 drift 탐지율
    - 평균 탐지 지연
- V1과 V2 비교
- Docker evaluator 선택 구현

#### 담당 산출물

```
DetectionEventPostureFeedbackScenarioLabelReplayEvaluatorMetricsReport
```

#### 핵심 기술 문제

> 일시적인 움직임, 갑작스러운 자세 drift, 시간이 지나며 서서히 무너지는 자세를 시간 흐름에서 어떻게 구분하고, 오탐과 탐지 지연 사이의 균형을 어떻게 설정할 것인가?
> 

#### 부담 조정 포인트

C는 **feature 계산이나 profile 생성은 맡지 않는다.**

C는 B가 만든 `DriftObservation`을 받아서 최종적으로 이렇게 판단한다.

```
지금 바로 경고할 것인가?
기다릴 것인가?
일시적인 움직임으로 볼 것인가?
서서히 무너지는 자세로 볼 것인가?
recovery로 볼 것인가?
```

---

### 공동 작업

- 시스템 구조 및 인터페이스 설계
- 코드 리뷰
- 통합 테스트
- 데이터 수집
- 실패 사례 분석
- 최소 UI 구성
- README 작성
- 발표와 데모 준비
- CI/CD 워크플로우 초기 세팅
    - lint
    - typecheck
    - build

CI/CD는 특정 한 명에게 몰지 않는 게 좋아.

Day 1에 세 명이 같이 기본 세팅을 하고, 이후 각자 PR 또는 merge 전에 통과시키는 방식으로 두면 부담이 적어.

---

### 역할 간 연결 구조

이렇게 연결되면 병렬 작업이 쉬워져.

```
A
Camera / MediaPipe / Feature
        ↓
FrameFeature, CameraRawFeature
        ↓
B
Profile / Drift Score / Camera Assessment
        ↓
DriftObservation, CameraAssessment
        ↓
C
Temporal State / Feedback / Evaluation
        ↓
DetectionEvent, MetricsReport
```

각자 초반에는 mock data로 개발할 수 있어.

```
A는 실제 camera 입력으로 FrameFeature 생성
B는 sample FrameFeature로 V0/V1 개발
C는 sample DriftObservation으로 state machine/evaluator 개발
```

이렇게 하면 A가 끝날 때까지 B와 C가 기다릴 필요가 없어.

---

## 23. 6일 개발 일정

### Day 1 — 프로젝트 구조 고정 + 각자 개발 가능한 뼈대 만들기

### 공동 목표

첫날에는 기능을 많이 만들기보다 **세 명이 병렬 개발할 수 있는 구조**를 먼저 고정해야 해.

```
Camera / Landmark
   ↓
FrameFeature
   ↓
UserProfile / DriftObservation
   ↓
DetectionEvent / PostureFeedback
   ↓
Replay Evaluator
```

### 공동 작업

- GitHub repo 세팅
- Vite + TypeScript 프로젝트 생성
- 폴더 구조 생성
- ESLint, typecheck, build 스크립트 설정
- CI/CD 초기 세팅
   * package.json 스크립트 작성
      * lint: eslint . --ext .ts
      * typecheck: tsc --noEmit
      * build: vite build
   * .github/workflows/ci.yml 작성 (push/PR 시 lint → typecheck → build 순으로 자동 실행)
   * GitHub Actions 탭에서 통과(초록불) 확인
- 핵심 interface 정의
- sample JSON 로그 형식 정의
- mock 데이터 생성

### 팀원 A

- MediaPipe 연결
- 웹캠 권한 요청
- 카메라 화면 출력
- landmark 추출 테스트
- skeleton overlay 초안 구현
- `FrameFeature` 초안 생성

### 팀원 B

- `UserProfile`, `CameraProfile`, `DriftObservation` interface 정의
- sample feature를 이용한 V0 baseline 함수 뼈대 작성
- calibration profile 생성 로직 초안 작성
- IndexedDB 저장 구조 조사 및 wrapper 초안 작성

### 팀원 C

- `DetectionEvent`, `PostureFeedback`, `ScenarioLabel` interface 정의
- sample `DriftObservation`을 이용한 state machine 뼈대 작성
- replay evaluator 구조 설계
- 평가 지표 계산 함수 뼈대 작성

### Day 1 완료 기준

```
A: 카메라에서 landmark를 뽑을 수 있음
B: sample feature로 baseline/profile 함수를 실행할 수 있음
C: sample drift score로 state machine을 실행할 수 있음
공통: npm run lint / typecheck / build 통과
```

---

### Day 2 — A는 feature 안정화, B는 V0 완성, C는 recorder/evaluator 시작

### Day 2 핵심 목표

**논문형 고정 임계값 baseline인 V0를 먼저 완성**하고, 저장된 로그를 replay할 수 있게 만든다.

### 팀원 A

- landmark confidence filter 구현
- 얼굴·양쪽 어깨가 화면 안에 있는지 판정
- 좌표 정규화 구현
    - 어깨 중심 기준
    - 어깨 너비 기준 scale
- posture feature 계산
    - shoulder tilt
    - headXOffset
    - headYOffset
    - bodyScale
    - torsoLean 후보
- motion energy 계산에 필요한 직전 frame 차이값 제공
- camera raw feature 계산
    - shoulderWidth
    - faceCenter
    - shoulderCenter
    - faceToShoulderRatio

### 팀원 B

- V0 Fixed Threshold Baseline 완성
- calibration 평균값 계산
- 고정 threshold 적용
- `BAD` 상태 1.5초 지속 시 alert 발생
- V0 결과를 `DetectionEvent` 형식으로 출력
- V0 threshold 후보값 정리

### 팀원 C

- recording 시작/종료 기능 구현
- feature sequence를 JSON/JSONL로 저장
- scenario label 형식 구현
- replay evaluator에서 V0 실행 가능하게 연결
- false alert episode 계산 로직 초안 작성

### 공동 작업

- 팀원 3명이 짧은 development session 기록
- 저장된 로그에 V0 실행
- V0 threshold 1차 조정
- V0의 문제점 기록

### Day 2 완료 기준

```
실시간 카메라 → feature log 저장
저장된 log → V0 replay
V0 alert 시각 자동 출력

mock `DriftObservation` 입력 시 기대한 `DetectionEvent`가 나오는지 확인하는 단위 테스트 1~2개를 CI에 추가
```

---

### Day 3 — B 중심으로 V1 완성, A는 입력 품질 개선, C는 V0/V1 비교

## Day 3 핵심 목표

**개인화된 drift score인 V1을 완성**하고, V0보다 무엇이 좋아졌는지 비교할 수 있게 만든다.

### 팀원 A

- feature 흔들림 줄이기
- 낮은 confidence frame 제외 처리
- 갑작스러운 landmark jump 제거
- 사람이 화면 밖으로 나간 경우 `NO_PERSON` 처리
- 골반 landmark가 불안정할 때 torso feature 비활성화
- A의 feature 출력이 B/C에서 안정적으로 쓰이는지 확인

### 팀원 B

- Original Reference Profile 생성
- Adaptive Profile 생성
- median/MAD 또는 mean/std 방식 비교
- 개인별 정상 변동 폭 계산
- V1 drift score 구현
- dominant feature 계산
- CameraProfile 생성
- IndexedDB 저장/불러오기 구현

### 팀원 C

- V0와 V1을 같은 로그에서 replay
- false alerts per hour 계산
- sustained drift detection rate 계산 초안
- average detection delay 계산
- 결과 테이블 출력
- V1에서 발생하는 실패 사례 기록

### 공동 작업

- 팀원별 calibration 수행
- 정상 작업 짧은 샘플 기록
- drift 시나리오 짧은 샘플 기록
- V0와 V1 비교

### Day 3 완료 기준

```
Calibration
→ UserProfile 생성
→ V1 drift score 실시간 출력
→ 저장된 로그에서 V0/V1 비교 가능

- V0·V1 replay 비교 스크립트를 CI에서도 동일하게 실행되도록 연결
```

---

### Day 4 — C 중심으로 V2 완성, slow drift와 feedback 통합

## Day 4 핵심 목표

**V2의 시간 상태 머신을 완성**하고, 일시 행동과 지속 drift를 구분하게 만든다.

### 팀원 A

- 실시간 feature pipeline 안정화
- skeleton overlay 개선
- guideline 표시용 reference skeleton 데이터 제공
- camera raw feature 안정화
- camera 변화 상황 테스트 지원

### 팀원 B

- CameraAssessment 구현
    - `VALID`
    - `ADJUSTED`
    - `RECALIBRATION_REQUIRED`
- 작은 camera 변화 보정 기준 구현
- 큰 camera 변화 시 posture alert가 아니라 recalibration 요청으로 분기
- adaptive update 후보 판정 구현
- 사용자 확인 기반 adaptive profile update 구현
- V1 score threshold 정리

### 팀원 C

- V2 state machine 구현
- 상태 추가
    - `STABLE`
    - `MOVING`
    - `SETTLING`
    - `SLOW_DRIFT_WATCH`
    - `DRIFT_SUSPECTED`
    - `SUSTAINED_DRIFT`
    - `ALERTED`
    - `RECOVERED`
- motion energy 기반 `MOVING` 판정
- short-window / long-window drift 평균 계산
- drift trend 계산
- drift evidence 누적 로직 구현
- recovery 조건 구현
- cooldown 구현
- `PostureFeedback` 생성
- guideline 표시 조건 구현

### 공동 테스트 시나리오

- 물 마시기
- 키보드 잠깐 보기
- 옆 모니터 보기
- 갑자기 앞으로 숙인 채 유지
- 서서히 앞으로 무너지는 자세
- 노트북 화면 각도 조금 변경
- 카메라 위치 크게 변경

### Day 4 완료 기준

```
물 마시기 / 키보드 보기
→ MOVING 또는 SETTLING 후 STABLE 복귀
→ 알림 없음

갑자기 숙인 자세 유지
→ SUSTAINED_DRIFT
→ ALERTED

서서히 자세 무너짐
→ SLOW_DRIFT_WATCH
→ DRIFT_SUSPECTED
→ ALERTED

큰 카메라 변화
→ RECALIBRATION_REQUIRED
→ 자세 경고 없음

- "일시 행동 mock 입력 → 알림 없이 복귀" 케이스를 단위 테스트로 남겨 이후 파라미터 조정 시 회귀를 방지
```

---

### Day 5 — 최종 Test Session 수집 + V0/V1/V2 정량 비교

## Day 5 핵심 목표

이날부터는 **알고리즘과 threshold를 고정**하고 최종 평가를 진행한다.

### 시작 전 공동 원칙

- V0 threshold 고정
- V1 drift score threshold 고정
- V2 state transition 시간 고정
- camera 보정 기준 고정
- adaptive update 비활성화
- test session 결과를 보고 파라미터 수정 금지

### 팀원 A

- 각 참가자의 카메라 입력 상태 확인
- landmark confidence 문제 기록
- camera issue 발생 구간 기록
- feature log 품질 확인
- 입력 문제로 인한 실패 사례 분류

### 팀원 B

- 각 참가자의 calibration profile 생성
- UserProfile 저장 확인
- CameraProfile 저장 확인
- V0/V1 결과 분석
- 개인화가 오탐 감소에 기여한 정도 분석

### 팀원 C

- test session 타이머/시나리오 진행
- ground-truth label 기록
- V0/V1/V2 replay 실행
- 공식 지표 계산
    - 시간당 오탐 수
    - 지속 drift 탐지율
- 보조 지표 계산
    - 평균 탐지 지연
- 결과표 생성

### 참가자별 Test Session

```
1. Calibration 30초

2. 정상 작업 10분
   - 타이핑
   - 마우스 사용
   - 키보드 잠시 보기
   - 물 마시기
   - 옆 모니터 보기
   - 기지개 켜기
   - 의자 위치 조정

3. Drift scenario
   - 앞으로 숙이기 15초 × 3회
   - 왼쪽 기대기 15초 × 3회
   - 오른쪽 기대기 15초 × 3회
   - 카메라 가까이 가기 15초 × 3회
```

### Day 5 완료 기준

```
팀원 3명 test session 완료
정상 작업 총 30분 이상
drift 이벤트 총 36개 이상
V0/V1/V2 비교표 생성
실패 사례 분류 완료

- 이 replay 비교 과정을 CI 워크플로우 안에 편입해, 이후 커밋에서 지표가 나빠지면 자동으로 감지되도록 함 (별도 신규 작업이 아니라 Day 5에 이미 하는 작업을 CI가 자동 실행하도록 옮기는 것)
```

예상 결과표 형식:

| 버전 | 시간당 오탐 수 | 지속 Drift 탐지율 | 평균 탐지 지연 |
| --- | --- | --- | --- |
| V0 | 측정값 | 측정값 | 측정값 |
| V1 | 측정값 | 측정값 | 측정값 |
| V2 | 측정값 | 측정값 | 측정값 |

---

### Day 6 — 결과 정리, 문서화, 데모 준비

## Day 6 핵심 목표

기능 추가보다는 **결과를 설득력 있게 보여주는 것**에 집중한다.

### 팀원 A

- vision pipeline 설명 정리
- landmark reliability 처리 설명 정리
- camera profile raw feature 설명 정리
- 입력 예외 처리 사례 정리
- skeleton/guideline demo 화면 정리

### 팀원 B

- V0와 V1 차이 정리
- calibration profile 설명 정리
- personalization이 오탐을 줄인 사례 정리
- CameraProfile과 recalibration 분기 설명 정리
- adaptive update는 MVP에서는 user-confirm 기반이라는 점 문서화

### 팀원 C

- V1과 V2 차이 정리
- state machine 설명 정리
- slow drift detection 설명 정리
- replay evaluation 결과 정리
- metric 표와 그래프 정리
- Docker evaluator를 구현했다면 실행법 정리

### 공동 작업

- README 작성
- 실행 방법 작성
- 평가 방법 작성
- 팀원별 기여도 작성
- 발표 자료 작성
- 데모 시나리오 확정
- 백업 시연 영상 촬영
- GitHub repo 정리
- 최종 build 확인

### Day 6 완료 기준

```
1. 웹앱 실행 가능
2. calibration 가능
3. V0/V1/V2 비교 가능
4. 최종 결과표 있음
5. 데모 영상 있음
6. README 있음
7. 발표에서 각 팀원의 core 기여를 설명할 수 있음
```

---

# 전체 일정 요약표

| 날짜 | 공동 목표 | A | B | C |
| --- | --- | --- | --- | --- |
| Day 1 | 구조·인터페이스 고정 | MediaPipe 연결 | profile/baseline 뼈대 | state/evaluator 뼈대 |
| Day 2 | V0 baseline 완성 | feature pipeline | fixed threshold | recorder/replay |
| Day 3 | V1 개인화 완성 | feature 안정화 | profile/drift score | V0/V1 비교 |
| Day 4 | V2 시간 판정 완성 | overlay/input 안정화 | camera/adaptive | state machine/feedback |
| Day 5 | 최종 평가 | 입력 실패 분석 | V0/V1 분석 | V0/V1/V2 metric |
| Day 6 | 발표·문서화 | vision 설명 | personalization 설명 | evaluation 설명 |

---

# 병렬 진행을 위한 핵심 규칙

가장 중요한 건 **각 팀원이 서로 기다리지 않게 mock data를 먼저 쓰는 것**이야.

```
A가 실제 FrameFeature를 완성하기 전
→ B는 sample FrameFeature로 V0/V1 개발

B가 실제 DriftObservation을 완성하기 전
→ C는 sample DriftObservation으로 V2 개발

실제 데이터가 연결되면
→ mock을 실제 pipeline으로 교체
```

그래서 Day 1에 interface와 sample log를 반드시 고정해야 해.

---

# 발표에서 보여줄 역할 흐름

발표에서는 이렇게 연결하면 깔끔해.

```
A:
카메라 영상에서 신뢰 가능한 자세 feature를 만들었다.

B:
그 feature를 사용자별 기준 자세와 비교해 개인화된 drift score를 만들었다.

C:
drift score의 시간 흐름을 분석해 일시 행동과 지속 drift를 구분하고,
동일 로그에서 V0/V1/V2를 비교 평가했다.
```

이 일정이면 세 명 모두 코어에 참여하면서도, 각자의 책임 범위가 명확하고 부담도 비교적 균등하게 나뉘어.

---

## 24. 기술 스택

### 웹 MVP

- TypeScript
- Vite
- MediaPipe Tasks Vision
- Web Camera API
- Canvas
- IndexedDB

### 데이터 및 평가

- JSON 또는 JSONL
- TypeScript/Node 기반 replay evaluator
- 필요하면 Python과 Pandas를 결과 분석에 사용
- Docker는 evaluator의 버전과 실행 환경을 통일할 때 선택적으로 사용

### 사용하지 않는 인프라

- 서버 API
- PostgreSQL·MySQL
- 클라우드 사용자 DB
- 사용자 PC에서 실행되는 Docker runtime
- 외부 AI API
- LLM API

---

## 25. 데스크톱 앱 확장 계획

MVP는 웹앱이지만 core와 adapter를 분리해 향후 데스크톱 앱으로 확장할 수 있게 한다.

```
PostureCore Core Engine
   ├─ Web Adapter
   └─ Future Desktop Adapter
```

향후 Electron 또는 Tauri 버전에서 추가할 수 있는 기능:

- PC 로그인 시 자동 실행
- 시스템 트레이 상주
- OS 알림
- 다른 앱 위에 표시되는 guideline overlay
- SQLite 또는 로컬 파일 저장
- 설치 파일 패키징

사용자용 데스크톱 앱은 Docker 없이 독립적으로 실행한다.

Docker는 다음 환경에서만 활용할 수 있다.

- Replay evaluation
- 자동 성능 회귀 테스트
- AI 모델 학습 환경
- 향후 여러 기기 동기화 서버

---

## 26. 기존 논문과의 차별성

기존 MediaPipe 자세 교정 연구는 AI로 landmark를 추출한 뒤 어깨 높이와 머리 위치에 고정 임계값을 적용해 자세를 분류했다.

PostureCore는 다음 차별성을 갖는다.

| 기존 방식 | PostureCore |
| --- | --- |
| 공통 고정 임계값 | 사용자별 정상 자세 분포 |
| 정자세·기울어짐 등 자세 분류 | 개인 기준에서의 지속적인 drift 탐지 |
| 현재 자세와 지속시간 중심 | 움직임·정착·회복 과정 추적 |
| 카메라 환경과 자세 변화를 함께 처리 | Posture Profile과 Camera Profile 분리 |
| Accuracy·Precision 중심 | 실제 작업 중 시간당 오탐 중심 |
| 한 번의 결과 판정 | V0·V1·V2 ablation 비교 |
| 카메라 환경 고정 | 작은 변화 보정, 큰 변화 recalibration |

핵심 차별 문장:

> PostureCore는 자세 종류를 더 많이 분류하는 프로젝트가 아니라, 개인차와 제한적인 카메라 변화가 존재하는 실제 작업 환경에서 일시적인 움직임은 제외하고 지속적인 자세 drift만 감지하는 코어를 개발하고 평가하는 프로젝트다.
> 

---

## 27. 최종 산출물

```
posture-core/
├── src/
│   ├── core/
│   │   ├── landmark-reliability
│   │   ├── camera-profile
│   │   ├── feature-normalizer
│   │   ├── profile-builder
│   │   ├── fixed-threshold-detector
│   │   ├── personalized-detector
│   │   ├── temporal-state-machine
│   │   └── feedback-generator
│   ├── web/
│   │   ├── camera-adapter
│   │   ├── canvas-overlay
│   │   ├── indexeddb-storage
│   │   └── app
│   └── evaluation/
│       ├── recorder
│       ├── scenario-labeler
│       ├── replay-evaluator
│       └── metrics
├── sample-data/
├── docs/
├── Dockerfile.evaluator
└── README.md
```

`Dockerfile.evaluator`는 선택 산출물이며, 실시간 웹앱의 필수 실행 요소는 아니다.

---

## 28. 최종 발표 핵심 문장

> 기존 자세 감지 시스템은 AI로 신체 landmark를 추출한 뒤 공통 고정 임계값으로 자세를 분류하기 때문에 개인차, 일시적인 움직임, 카메라 환경 변화를 자세 이상으로 오인할 수 있습니다. 저희는 사용자별 기준 자세와 camera profile을 분리하고, 개인화된 drift score와 시간 상태 머신을 결합했습니다. 또한 동일한 로그에서 V0·V1·V2를 replay하여 개인화와 시간 상태 추론이 시간당 오탐 수와 지속 drift 탐지율에 미치는 영향을 정량적으로 검증합니다.
>
