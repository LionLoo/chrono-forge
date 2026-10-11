# M10.8 whole-product stabilization evidence

Last updated: 2026-10-10

## Baseline and scope

- Branch: `release/v1-whole-product-stabilization`.
- Exact baseline: merged and merge-head-green M10.7 main `95ac97ec14b8f1b2d772f87dba6750a511e51e6b`.
- M10.7 PR #23 final head `6aca10501c08c1ad4bebe63aa623e03a7c88af69` passed exact-head workflow `38102776945`; merge commit `95ac97e` passed exact merge-head workflow `38104990166`. Both workflows passed Web, Windows native/installer, and aggregate `Required`.
- M10.8 is active and release-blocking. It owns cross-system player-flow, long-session responsiveness, Worker/UI/native integration, installed reopening, installer, and end-to-end stabilization. M10.9 world-lifecycle semantics remain separate and are not pre-accepted here.

## Campaign 1 — long focus-session freeze

Known release-blocking symptom: during a long focus session, the visible timer can stop, controls can stop accepting input, and authoritative world progression can halt.

Locked observable acceptance before product edits:

- A controlled clock can advance an active long-duration focus session across repeated scheduling, Worker frame, autosave/checkpoint, and render boundaries without relying on wall-clock sleeps for authority.
- The visible timer remains monotonic and consistent with the active session; pause/resume and at least one unrelated primary control continue to accept keyboard and pointer input.
- Worker request/response correlation remains bounded and makes progress; accepted focus ticks advance the authoritative world exactly once, and delayed or failed work cannot leave the UI silently waiting forever.
- Autosave/checkpoint work cannot block timer cadence, control input, render updates, or later Worker progress. A recoverable failure recovers explicitly; a fatal failure suspends safely and visibly without corrupting or duplicating the session/world.
- Browser and installed-native coverage exercise the same player-observable contract. Installed evidence includes real SQLite persistence and a later reopen with the active/completed focus session and authoritative world mutually consistent.
- Any reproduced defect receives the narrowest appropriate deterministic regression before its root-cause fix. No threshold, timeout, retry classifier, or factual assertion is weakened merely to make the campaign pass.

## Evidence state

- No M10.8 product or test change has been made yet.
- Documentation formatting and diff hygiene pass for the branch bootstrap.
- Exact next action: audit the controlled focus clock, Worker advance/request correlation, autosave/checkpoint scheduling, React render cadence, browser E2E, installed-native phase harness, and long-session profiling coverage; then add the smallest deterministic regression that reproduces a silent timer/control/world stall.
