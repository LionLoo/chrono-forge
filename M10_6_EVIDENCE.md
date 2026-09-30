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
- 2026-09-30: The first repair slice gives Pixi initialization failure a visible `role="alert"` surface and an actionable retry that creates a fresh renderer. Focused `WorldMapCanvas` coverage proves both the failed state and successful retry without leaving the error marker behind.
- 2026-09-30: Application selection now reconciles every current Worker projection against stable authoritative keys before committing map, select, inspector, tile, or frame-control props. A controlled Worker-frame regression removes the selected agent in a valid replacement frame and proves that every selection projection clears together rather than retaining an invalid value or reviving the stale key later.
- 2026-09-30: Focused frontend validation passes 23/23 tests across `WorldMapCanvas.test.tsx` and `App.test.tsx`, plus zero-warning web lint and type checking. `git diff --check` is clean.
- 2026-09-30: Packaged desktop phase 1 passes 1/1 and now covers map selection, pointer-anchored wheel zoom without page scroll, and canvas keyboard pan/selection in the real Tauri WebView; fresh-process phase 2 passes 3/3 with the existing real SQLite recovery/completion and M9 migration assertions. The embedded desktop driver was observed to emit no pointer events from raw pointer actions, so the WebView test dispatches standards-based `PointerEvent`/`WheelEvent` objects on the real canvas/host and retains genuine WebDriver keyboard input. Physical mouse and wheel input remain independently covered by browser E2E.
- 2026-09-30: Live browser inspection at the production viewport confirmed an unclipped map/focus layout, factual person selection and detail, and successful selection framing. The first native regression iteration exposed a camera-settle ordering race, and raw-pointer diagnostics confirmed the desktop-driver limitation above; the test was corrected without weakening product behavior or authoritative assertions.
- 2026-09-30: The final combined `npm run test:e2e:desktop` rebuilt the exact desktop application and passed both ordered launcher-owned workers: phase 1 at 1/1 in 7.1 seconds and phase 2 at 3/3 in 6.1 seconds, with distinct WebDriver session IDs. Existing post-pass Tauri service cleanup diagnostics remain non-failing upstream noise.
- 2026-09-30: Fresh independent Terra/high review reported no release-relevant finding. It verified the late-initialization cleanup and fresh Pixi retry, the synchronous current-frame selection derivation before child commit, the valid replacement-frame regression, and the desktop test's explicit synthetic-pointer/real-keyboard boundary. Its read-only checks passed 23/23 focused tests, web lint, type checking, formatting, scoped diff checking, and native-spec syntax validation.

## Current checkpoint boundary

- The three opening findings are repaired on the working tree with focused regressions and an independent no-finding review. They do not count as delivered until an exact checkpoint commit, the remaining M10.6 campaign, the complete local gate, exact-head hosted CI, sequential merge, and exact merge-head CI are complete.
- M10.6 remains active. The next defect pass must continue across frame-delta reconstruction, loading/runtime errors, overlays and settings, responsive/text-scale/reduced-effects behavior, contrast and screen-reader semantics, focus/save/recovery controls, and the complete M9 inspector.
