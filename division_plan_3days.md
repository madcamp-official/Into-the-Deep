# PostureCore 3일 병렬 개발 계획

## 목표

3일 안에 웹 MVP에서 `Baseline(V0)`과 `Proposed(V2)`를 완성하고 동일한 Test Session에서 비교한다.

- V0: 상대 자세 feature + 공통 fixed threshold
- V2: 상대 자세 feature + 온라인 MAD 개인화 + 카메라 변화 처리 + 시간 상태 판단
- V2는 Development/적응 구간에서 사용자별 MAD를 만든 뒤 Test Session에서는 해당 MAD를 고정한다.
- ground-truth label은 평가에만 사용하며 detector나 MAD 업데이트에는 전달하지 않는다.

## 현재 구현 상태

| 영역 | 구현됨 | 변경·추가 필요 |
| --- | --- | --- |
| A: 입력/feature | 웹캠, MediaPipe, skeleton, confidence·화면 이탈·jump 검사, 기본 정규화 feature, camera raw feature | 상대 자세 feature 확정, 자세/환경 feature 분리, 작은 카메라 변화 추정 |
| B: profile/score | Calibration median/MAD, V0 fixed detector, 개인화 score, CameraProfile, IndexedDB 저장·복원 | Adaptive Profile 삭제, 공통 초기 MAD와 온라인 updater, V1 코드를 V2 score 내부로 정리, CameraAssessment |
| C: 시간/평가 | state machine 인터페이스, JSONL recorder, marker, 자동 Development Session, replay, 공식 metric, threshold sweep | V2 state machine 완성, V0/V2 비교로 전환, MAD 변화 기록·분석, Test Session 결과표 |
| 공통 | Vite+TypeScript, Vitest, CI lint/typecheck/test/build, 실시간 UI | 새 타입 계약 통합, 최종 UI·README·발표 자료 |

현재 `adaptiveCenters`, Calibration MAD, V0/V1 비교 코드는 새 설계로 교체하거나 V2 내부 로직으로 재사용한다. CameraProfile은 저장되지만 실제 `VALID / ADJUSTED / RECALIBRATION_REQUIRED` 판정은 아직 없다.

## 충돌 방지 기준

| 담당 | 주 소유 경로 |
| --- | --- |
| A | `feature-normalizer`, `landmark-reliability`, `camera-adapter`, `canvas-overlay`, camera raw 계산 |
| B | `profile-builder`, `fixed-threshold-detector`, V2 score/MAD updater, `indexeddb-storage`, camera 판정 |
| C | `temporal-state-machine`, `evaluation/*`, feedback/metric |
| 공용 | `types.ts`, `main.ts`, `README.md`, CI |

공용 타입은 1일차 시작에 세 명이 함께 확정한다. 이후 각자 mock 입력으로 개발하고, 공용 파일 통합은 담당자를 한 명 정해 하루 마지막에 진행한다.

## 1일차: 새 코어 병렬 구현

### 공동

- `FrameFeature`, `UserProfile`, `MADProfile`, `CameraAssessment`, `DriftObservation`, `DetectionEvent` 계약 확정
- 자세 feature와 환경 feature 이름·단위 확정
- Adaptive Profile과 별도 V1을 새 설계에서 제거

### A: 상대 feature

- shoulder angle, head X/Y ratio, head-shoulder distance ratio 구현
- face-shoulder ratio, pitch/yaw proxy 정리
- body scale·화면 중심·framing을 환경 feature로 분리
- 의자 이동 시 상대 feature가 유지되는 단위 테스트 추가

### B: 고정 중심 + 온라인 MAD

- Calibration은 Original Reference median만 생성하도록 변경
- feature별 공통 초기 MAD, min/max 설정 구조 구현
- 안정 구간 rolling window 기반 MAD updater 구현
- 기존 개인화 detector를 Original center + 현재 MAD 기반 V2 score로 재구성

### C: V2 시간 상태

- `STABLE → MOVING → SETTLING → DRIFT_SUSPECTED → ALERTED → RECOVERED` 구현
- motion energy, recovery, cooldown 조건 구현
- mock score로 일시 행동은 복귀하고 지속 drift만 alert하는 테스트 추가

### 1일차 종료 조건

- 세 모듈이 mock 데이터로 각각 실행됨
- `npm run lint`, `typecheck`, `test`, `build` 통과
- 실제 통합에 사용할 interface가 main에 반영됨

## 2일차: 통합·Development Session

### A: 카메라 변화 처리 지원

- 얼굴만 변하는 경우와 얼굴·어깨가 함께 변하는 경우를 구분할 feature 제공
- 작은 translation, scale, roll 변화 추정
- 큰 변화·landmark 불안정은 보정하지 않고 판정 보류

### B: V0/V2 판정 통합

- V0를 상대 자세 feature의 공통 fixed threshold 기준으로 변경
- `VALID / ADJUSTED / RECALIBRATION_REQUIRED` 구현
- V2 MAD updater가 안정 구간에서만 동작하도록 상태 머신과 연결
- Original Profile, 현재 MAD, CameraProfile 저장·복원 및 로그 metadata 반영

### C: replay와 평가 전환

- 기존 V0/V1 replay를 V0/V2 비교로 변경
- JSONL에 V0/V2 상태, MAD 변화, camera state 기록
- 자동 session을 새 시나리오와 feature에 맞게 수정
- 시간당 오탐, 지속 drift 탐지율, 탐지 지연, 자연 행동 오탐 출력

### 공동 Development Session

- 정상 작업, 자연 행동, 지속 drift, 의자 이동, 작은·큰 카메라 변화 기록
- V0 threshold와 V2의 초기 MAD·min/max·업데이트 규칙 조정
- 정상 적응 구간에서 사용자별 MAD를 업데이트하고 최종 MAD 저장
- 2일차 종료 후 파라미터, 업데이트 규칙, 저장된 MAD는 변경하지 않음

### 2일차 종료 조건

- 실시간 카메라에서 V0/V2 동시 출력
- V2가 정상 구간에서 MAD를 업데이트하고 drift 구간에서는 멈춤
- 동일 JSONL에서 V0/V2 결과표 생성 가능

## 3일차: Test Session·문서·발표

### 오전: 최종 Test Session

- 새로운 session에서 V0/V2 동시 실행
- V2는 2일차에 저장한 사용자별 MAD를 불러오고 Test Session 중 updater를 비활성화
- 결과를 보고 알고리즘 파라미터를 다시 바꾸지 않음
- 오탐, 탐지율, 지연, 사용자별 고정 MAD, 카메라 실패 사례 정리

### 오후: README와 발표용 Notion

| 담당 | README·Notion 작성 내용 |
| --- | --- |
| A | 카메라→landmark→상대/환경 feature 흐름, 지원 카메라 범위, 데모 화면 |
| B | V0/V2 차이, Original Reference와 온라인 MAD, CameraAssessment, 핵심 결과 해석 |
| C | state machine, Test Session 절차, metric 표·그래프, 실행·replay 방법 |

C가 문서 구조와 용어를 최종 통일하고, 세 명이 함께 데모 시나리오와 발표 순서를 검토한다.

### 3일차 종료 조건

- README에 설치·실행·Calibration·평가 방법이 있음
- 발표용 Notion에 문제, 설계, V0/V2 비교표, 실패 사례, 역할이 있음
- GitHub Actions 통과, 최종 웹 데모와 백업 영상 준비

## 선택안 A: 데스크톱 확장 안 함

권장안이다. 3일을 코어 안정화와 V0/V2 비교에 모두 사용한다.

- 산출물: Chrome 웹앱, JSONL replay, 결과표, README, Notion
- 장점: 상대 feature·MAD·시간 상태 검증에 충분한 시간 확보
- Day 3 추가 확인: Chrome 새 프로필에서 권한, IndexedDB 복원, 로그 다운로드 smoke test
- 데스크톱 앱은 향후 확장 구조와 예상 기술만 문서화

## 선택안 B: 데스크톱 배포·다중 OS 포함

웹 코어가 2일차 오전까지 통합된 경우에만 진행한다. 기존 Vite 코드를 재사용하기 쉬운 Electron + Electron Forge를 사용한다.

### 추가 분업

| 담당 | 추가 작업 |
| --- | --- |
| A | Electron shell, webcam 권한, 웹 UI 실행 연결 |
| B | IndexedDB/profile 저장이 packaged app에서 유지되는지 확인, Windows 실기기 smoke test |
| C | Forge packaging, Windows/macOS/Linux CI build matrix, artifact 실행법 문서화 |

### 현실적인 완료 범위

- 하나의 JS/TS 코드베이스로 Windows·macOS·Linux package 설정
- GitHub Actions에서 OS별 unsigned artifact 생성
- 팀이 보유한 OS에서는 카메라·저장·로그 다운로드 실기기 확인
- 보유하지 않은 OS는 build 성공까지만 지원으로 표기
- 코드 서명, 앱스토어 등록, 자동 업데이트는 제외

Electron은 웹 기술로 Windows·macOS·Linux 앱을 만들 수 있고 Electron Forge가 packaging을 지원한다. 다만 실제 배포에는 OS별 코드 서명과 실행 검증이 별도로 필요하므로, 이 안을 선택하면 Development/Test Session 반복 횟수가 줄어드는 것을 감수해야 한다.

## 최종 선택 기준

- 2일차 오전까지 V2 온라인 MAD와 state machine이 통합되지 않음: 선택안 A
- 코어 통합·Test Session 예행연습까지 완료되고 패키징 담당 여력이 있음: 선택안 B
