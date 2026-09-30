# M10.6 frontend bug hunt and repair evidence

## Locked contract

- Branch: `release/v1-frontend-bug-hunt` from exact merged and merge-head-green M10.5 main `3efe1a267b5ce71b100b704c468e415b267138a8`.
- Exercise React, Pixi, Worker-frame application, focus/save/recovery controls, camera pointer/wheel/keyboard input, overlays, selection and inspectors, settings, responsive/text-scale/reduced-effects behavior, screen-reader semantics, loading/error states, frame-delta reconstruction, browser interaction, installed desktop interaction, and the complete M9 inspector.
- Reproduce release-blocking defects with focused tests where practical and fix root causes without mutating or bypassing Worker authority.
- Acceptance requires no known critical or high-severity frontend defect, regressions for every discovered release blocker, exact-candidate browser/visual/keyboard/text-scale/reduced-effects/contrast/native evidence, independent review, complete local gates, exact-head hosted CI, sequential merge, and exact merge-head CI.

## Opening inventory

- High: Pixi initialization failure is stored only in `data-render-error`; the application does not present a visible, screen-reader-accessible map failure or recovery path.
- Medium: when a valid new Worker frame removes the selected object, React can retain a stale selection, leaving an invalid controlled-select value and blank selection detail instead of reconciling to no selection.
- Medium coverage gap: native desktop evidence covers framing through the keyboard navigator but does not directly exercise map pointer selection, pointer-anchored wheel zoom, or canvas keyboard navigation in the actual WebView.

## Evidence log

- 2026-09-30: M10.5 PR #17 final head `a48ad72c5c3ed77d4fc17442a562199ed8aa893d` passed workflow `36664539081`, merged sequentially at `3efe1a267b5ce71b100b704c468e415b267138a8`, and exact merge-head workflow `36666968731` passed Web, Windows, and aggregate `Required`. M10.6 began from that exact verified SHA.
- 2026-09-30: Read-only opening triage locked the three findings above. No product change or acceptance credit has been taken yet.
