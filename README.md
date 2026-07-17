# Into-the-Deep
몰입캠프 26s-w3-c3-06 프로젝트 repository

PostureCore 기획은 [plan.md](./plan.md) 참고.

## Getting Started

```
npm install
npm run dev        # Vite dev server
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + vite build
```

## 폴더 구조

```
src/
├── core/         # 판정 코어 (feature, profile, detector, state machine)
├── web/          # 카메라 입력, canvas overlay, IndexedDB, app 진입점
└── evaluation/   # recorder, scenario labeler, replay evaluator, metrics
sample-data/      # 평가용 샘플 JSONL 로그
docs/             # 설계 노트, 발표/데모 자료
```
