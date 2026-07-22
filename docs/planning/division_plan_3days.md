# PostureCore 3일 병렬 개발 계획

## 목표

3일 안에 `Baseline(V0)`과 `Proposed(V2)`를 같은 자세 규칙과 같은 로그에서 비교할 수 있는 웹 MVP를 완성한다. 이후 웹 버전과 다운로드형 데스크톱 프로그램을 배포하고 README와 발표용 Notion을 작성한다.

- V0: 사용자별 Calibration 중심값 + 공통 MAD + 자세별 Rule
- V2: V0 Rule + 정상 안정 구간의 MAD 개인화 + 카메라 변화 처리 + 시간 상태 판단
- Ground-truth label은 평가에만 사용하고 Detector나 MAD updater에는 전달하지 않는다.
- Development Session에서 파라미터를 조정하고 Test Session에서는 값을 고정한다.
- Adaptive Profile과 별도 V1은 사용하지 않는다.

## 병렬 개발 원칙

세 명이 서로의 구현을 기다리지 않도록 작업 시작 전에 공통 계약과 Mock을 확정한다.

```text
공통 타입·Mock 확정
  ├─ A: 실제 FrameFeature 구현
  ├─ B: Mock FrameFeature로 Profile·Rule·Detector 구현
  └─ C: Mock JSONL로 State·Replay·Threshold 평가 구현

실제 코드 통합
  → Development Posture Session
  → C가 Threshold·판단 로직 추천
  → B가 최종 Rule에 반영
  → 공동 재측정·Replay 검증
```

### 작업 시작 전 공동 확정

- `FrameFeature` 필드명, 단위, 양수·음수 방향
- `UserProfile`, `MADProfile`, `CameraAssessment` 구조
- `PostureRule`의 조건, 필수 landmark, 결과 형식
- `DetectionEvent`의 `postureType`, `matchedFeatures`, `reason`, `score`, `alert`
- 정상·지속 자세·자연 행동·UNKNOWN을 포함한 Mock Frame과 Mock JSONL
- 공통 타입 변경 절차와 파일 소유권

### 파일 소유권

| 담당 | 주 소유 영역 |
| --- | --- |
| A | `feature-normalizer`, `landmark-reliability`, `camera-adapter`, 자세·환경 Feature 계산 |
| B | `profile-builder`, `mad-profile`, `posture-rules`, `posture-rule-detector`, `camera-assessment`, Profile 저장 |
| C | `temporal-state-machine`, `evaluation/*`, Replay, Metric, Threshold Sweep, Confusion 분석 |
| 공용 | `types.ts`, `main.ts`, 배포 설정, README |

C는 Threshold와 판단 로직 변경안을 분석해 추천하고, B가 실제 Rule 파일에 최종 반영한다. 공용 파일은 통합 담당자를 정해 수정한다.

## 현재 구현 상태

| 영역 | 구현됨 | 남은 핵심 작업 |
| --- | --- | --- |
| A | 웹캠·MediaPipe·Skeleton, 기본 Feature, Landmark 신뢰도 검사 | 누락 Feature 추가, 자세·환경 Feature 완전 분리, Camera raw 값 검증 |
| B | Calibration median, 공통 MAD, Rule Detector, V2 MAD updater, IndexedDB 저장·복원 | 일부 Rule의 Feature 연결, CameraAssessment, 최종 Rule·Threshold 반영 |
| C | State Machine, JSONL Recorder, 자동 Development Session, Replay, 기본 Metric, Threshold Sweep | V0/V2 비교표, Confusion 분석, 전체 Rule 경쟁 상태의 판단 로직 개선 |
| 공통 | Vite·TypeScript·Vitest·CI, V0/V2 실시간 UI | 실제 통합 검증, 배포, README·Notion |

## 1일차: 코어 병렬 완성

### 공동

1. 공통 타입과 Feature 이름·단위를 동결한다.
2. 정상 자세와 대표적인 이상 자세를 포함한 Mock Frame·JSONL을 공유한다.
3. 각 담당자의 파일 소유 경계를 확정한다.

### A: Landmark와 Feature

1. 자세 Rule별로 필요한 Landmark 신뢰도를 검사한다.
2. 자세 Feature의 계산식과 방향을 통일한다.
3. 화면 위치·크기 변화는 환경 Feature로 분리한다.
4. 현재 로그에 없는 `faceToShoulderRatioDelta`, `faceShapeDeformation`, `torsoRotationProxy` 등 필요한 Feature를 구현한다.
5. 의자 이동, 고개 회전, 상체 이동, Landmark 누락에 대한 단위 테스트를 추가한다.
6. 실제 카메라와 JSONL에서 모든 Feature가 출력되는지 확인한다.

**산출물:** 완성된 `FrameFeature`, Feature 로그, 단위 테스트

### B: Profile과 자세 Rule

1. Calibration 5초 동안 신뢰 가능한 Frame의 Feature median으로 Original Reference를 생성한다.
2. 공통 초기 MAD, Feature별 min/max, 현재 MAD, 업데이트 횟수를 관리한다.
3. V2 MAD updater가 정상·안정 구간에서만 작동하도록 API를 정리한다.
4. 자세별 `PostureRule`의 필수 조건, 보조 조건, 필수 Landmark, 알림 이유를 정의한다.
5. Detector가 `postureType`, `matchedFeatures`, `reason`, `score`를 반환하도록 한다.
6. V0와 V2가 동일한 Rule을 사용하고 서로 다른 MAD 정책만 적용하도록 한다.
7. Original Profile, MADProfile, CameraProfile 저장·복원을 확인한다.

**산출물:** V0/V2 판정 API, 자세별 Rule, 저장 가능한 Profile

### C: 시간 상태와 평가·최적화

1. `STABLE → MOVING → SETTLING → DRIFT_SUSPECTED → ALERTED → RECOVERED` 흐름을 검증한다.
2. 자연 행동 중 판단 보류, 지속 자세의 Alert, 복귀와 Cooldown을 테스트한다.
3. 같은 JSONL을 V0와 V2로 Replay하는 비교 흐름을 완성한다.
4. 자세별 Threshold 후보를 자동 실행하고 Precision, Recall, F1, 오탐, 탐지 지연을 계산한다.
5. 실제 자세와 탐지 자세의 Confusion Matrix를 만든다.
6. 여러 Rule이 동시에 매칭될 때 우선순위, 배제 조건, `UNKNOWN` 처리 개선안을 출력한다.

**산출물:** Replay 결과표, 자세별 일치율, Threshold·판단 로직 추천표

### 1일차 통합

1. A의 실제 `FrameFeature`를 B의 Detector에 연결한다.
2. B의 `DetectionEvent`를 C의 State Machine과 Logger에 연결한다.
3. Development Posture Session을 한 번 실행한다.
4. C의 분석 결과를 검토하고 B가 합의된 Rule과 Threshold를 반영한다.
5. `lint`, `typecheck`, `test`, `build`를 통과시킨다.

### 1일차 종료 조건

- 실제 카메라에서 V0/V2 자세명이 동시에 출력된다.
- 자세명, 위반 Feature, 판단 이유가 UI와 JSONL에 기록된다.
- JSONL Replay로 자세별 일치율과 추천 Threshold를 출력할 수 있다.
- 2일차 배포 작업을 시작할 수 있는 통합 상태가 된다.

## 2일차: 남은 기능·검증·배포

### 오전: 남은 기능과 Development Session

| 담당 | 작업 |
| --- | --- |
| A | 누락·불안정 Feature 수정, Camera raw Feature 검증, 실제 카메라 환경 테스트 |
| B | CameraAssessment 완성, V2 MAD updater 상태 연결, C 추천값을 Rule에 반영 |
| C | 여러 로그의 Threshold Sweep, Confusion Matrix, V0/V2 비교표와 실패 사례 출력 |

공동으로 정상 작업, 자연 행동, 대표 지속 자세를 다시 기록한다. 잘못 수행했거나 늦게 수행한 Scenario는 Threshold 산정에서 제외한다. 최종 후보값을 반영한 뒤 별도의 확인 로그로 재검증한다.

### 오후: 웹 배포

- Production build를 생성한다.
- HTTPS를 제공하는 정적 호스팅에 웹 버전을 배포한다.
- 배포 주소에서 카메라 권한, Calibration, IndexedDB 복원, JSONL 다운로드를 확인한다.
- 배포 환경의 제한과 지원 브라우저를 기록한다.

### 오후: 다운로드형 데스크톱 배포

현재 Vite·TypeScript 코드를 재사용하기 위해 Electron 기반으로 패키징한다.

| 담당 | 작업 |
| --- | --- |
| A | Electron 화면에서 카메라 권한과 실시간 Feature 동작 확인 |
| B | Packaged app에서 IndexedDB Profile 복원과 JSONL 다운로드 확인 |
| C | Electron packaging, OS별 GitHub Actions build, Release artifact 구성 |

배포 범위:

- Windows: `.exe` 생성 후 실제 실행 검증
- macOS: `.dmg` 또는 `.zip` 생성
- Linux: `.AppImage` 또는 `.deb` 생성
- GitHub Releases에서 OS별 파일을 내려받는 방식
- 앱스토어 등록, 코드 서명, 자동 업데이트는 제외
- 팀이 보유하지 않은 OS는 Build 성공까지만 지원으로 표기

### 2일차 종료 조건

- 웹 배포 주소에서 핵심 흐름이 동작한다.
- Windows 데스크톱 프로그램을 다운로드해 실행할 수 있다.
- macOS·Linux용 unsigned artifact가 생성된다.
- V0/V2 비교 결과와 주요 실패 사례가 정리된다.

## 3일차: Test Session·문서·발표

### 오전: 최종 Test Session

- Development Session과 다른 새로운 Session을 사용한다.
- V0/V2의 Rule과 Threshold를 변경하지 않는다.
- V2는 Development 단계에서 저장한 MAD를 불러오며 Test 도중 updater는 비활성화한다.
- 탐지율, 시간당 오탐, 탐지 지연, 자세별 일치율과 Confusion Matrix를 계산한다.
- 실패 사례와 지원하지 못하는 자세·카메라 환경을 기록한다.

### 오후: README와 발표용 Notion

| 담당 | 작성 내용 |
| --- | --- |
| A | Camera → Landmark → 자세·환경 Feature 흐름, Feature 계산과 지원 환경 |
| B | Calibration, 공통 MAD, V0/V2 차이, 자세 Rule, CameraAssessment |
| C | State Machine, Development/Test Session, 평가 지표·그래프, Replay·배포 방법 |

C가 전체 문서 구조와 용어를 통일하고 세 명이 함께 데모와 발표 순서를 확인한다.

### 3일차 종료 조건

- README에 설치, 웹 실행, 데스크톱 실행, Calibration, 로그와 Replay 방법이 있다.
- 발표용 Notion에 문제 정의, 시스템 구조, V0/V2 비교, 평가 결과, 실패 사례, 역할이 있다.
- GitHub Actions와 최종 웹 데모가 정상 동작한다.
- Windows 실기기와 팀이 보유한 다른 OS에서 가능한 범위까지 실행을 확인한다.

## 관련 구조도

- `docs/diagrams/today_parallel_plan.png`: 오늘 분업표
- `docs/diagrams/today_parallel_plan_mermaid.png`: 병렬 개발·통합 구조도
- `docs/diagrams/today_parallel_plan.html`: 수정 가능한 분업표 원본
- `docs/diagrams/today_parallel_plan.mmd`: 수정 가능한 Mermaid 원본

## 일정 위험 관리

- 1일차 종료 시 실제 Feature와 Detector가 연결되지 않으면 데스크톱 배포보다 코어 통합을 우선한다.
- Feature가 생성되지 않는 Rule은 Threshold를 낮춰 억지로 활성화하지 않는다.
- 한 사용자의 한 번의 Session만으로 공통 Threshold를 확정하지 않는다.
- 코드 서명이 없는 데스크톱 프로그램에서는 Windows Defender와 macOS Gatekeeper 경고가 발생할 수 있음을 문서화한다.
