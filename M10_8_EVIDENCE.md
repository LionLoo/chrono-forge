# M10.8 whole-product stabilization evidence

Last updated: 2026-10-11

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

- The freeze was reproduced deterministically across the real focus controller and Worker gateway. One accepted timer checkpoint left an advance outstanding; an immediate Pause attempted to issue the remaining elapsed ticks, received ordinary backpressure, and silently left the visible session running. The regression failed on the inherited implementation with 1,000 accepted milliseconds and 10 issued ticks instead of the required paused 2,000 milliseconds and 20 ticks.
- Routine advances remain one-at-a-time. The gateway now admits exactly one separately typed phase-changing focus transition behind an ordinary checkpoint, preserves FIFO base-tick authority, rejects equivalent or third work, and gives every accepted request its own non-renewable 10-second deadline. Partial Worker progress cannot conceal a later starved request. `useFocusController` derives terminal priority only from a real phase change, so natural completion, Pause, Cancel, and explicit completion receive the same bounded path while ordinary checkpoints retain backpressure semantics.
- Unit coverage holds a real runtime's Worker requests, proves Pause commits and the world later reaches the exact 20 ticks once, proves routine duplication and terminal duplication are bounded, proves the second request faults on its original deadline despite a just-in-time first response, and proves one rejected ordinary checkpoint remains available in the later accepted Pause interval. Browser coverage delays outgoing `advanceTicks` requests before the Worker receives them, verifies keyboard Pause plus pointer zoom remain responsive and the paused timer stays frozen, then releases FIFO requests and observes the exact authoritative progress.
- Current working-tree validation passes: 72/72 across the Worker gateway, focus controller, and persistence panel; TypeScript, zero-warning focused ESLint, Prettier, diff hygiene, and production web build pass; all 7/7 production browser journeys pass, including the pre-Worker starvation regression. The final installed build passes four spec files/six tests across two ordered launches with real SQLite pause, reopen, resume, completion, exact Worker reloads, rejected IPC recovery, and post-exit `integrity_check=ok`, `foreign_key_check=ok`, three slots, seven generations, and two sessions.
- Independent review first found a P1 in an earlier 12-request/oldest-deadline design because slow partial progress could renew the deadline until the window saturated. That design was discarded. Per-request deadlines closed the finding. Review of the final one-ordinary/one-terminal design found one P2 coverage gap for explicit and natural completion; controlled-runtime regressions now prove both paths, including natural transition into a configured break, canonical session accounting, FIFO exact world ticks, and terminal-first exclusion. Final re-review reports the P2 closed and no remaining P0-P3 finding.
- A controlled 120-minute browser diagnostic on the earlier working tree reached tick 72,010 with zero violations. Its installed counterpart reached the same tick but failed the locked process-family memory and paused-idle CPU budgets: 2,519,298,048-byte peak, 449,908,736-byte final growth, and 0.1539 paused-idle CPU ratio. It receives no acceptance credit. Because the profiler observes and waits for each logical checkpoint, it did not exercise a multi-request backlog; the failure remains an independent M10.8 installed-performance defect to reproduce on a clean exact checkpoint.
- Campaign 1 is not closed. The reviewed working tree still needs its durable commit; exact-head profiles, the complete gate, hosted CI, and campaign-level acceptance remain outstanding.
- Exact next action after checkpointing this narrow focus correction: reproduce and correct the player-reported deterministic character clumping, where the demo founders currently choose one target/action and traverse the same tiles in lockstep; then continue Campaign 1 installed-performance and whole-flow stabilization without treating either slice as milestone completion.
