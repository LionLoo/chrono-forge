# M10.9 world lifecycle and save-slot evidence

Last updated: 2026-10-16

## Baseline and scope

- Branch: `release/v1-world-lifecycle-save-slots`.
- Exact baseline: merged and merge-head-green M10.8 main `691e02b08774e54cb83a814c8e7f4014475c3c6d`.
- M10.8 PR #24 final head `651a97964f78ac2e2d74f344bc638352c7247ed7` passed exact-head workflow `38797193065`; merge commit `691e02b` passed exact merge-head workflow `38838394863`. Both workflows passed Web, Windows native/installer, and aggregate `Required`.
- M10.9 owns explicit fresh-world, deliberate duplication, and same-slot reset semantics. It does not pre-accept M11 clean release-candidate verification or M12 tag/private-release delivery.

## Delivered lifecycle semantics

- Worker protocol v11 adds `requestFreshWorldSnapshot(seed, config)`. The simulation Worker alone calls `createInitialWorld`, canonicalizes the tick-zero result, and returns it without changing the active world. React never constructs world authority or disguises the active snapshot as a new world.
- Every full Worker projection carries the exact four-word seed. Frame deltas cannot cross seed or dimension boundaries, and the active seed is shown as four eight-hex groups. The default generator uses Web Crypto; an exact recorded seed can be pasted to reproduce the same initial world within the same content version.
- **Create new world** requires an unused destination slot, commits the Worker-created tick-zero snapshot, loads that exact committed snapshot into the Worker, transfers UI authority, and only then persists the active-slot preference. It inherits no tick, history, people, structures, stockpiles, or other active-world state.
- **Duplicate current world** requests the active canonical snapshot and commits it under a new slot ID. It intentionally preserves the exact current world and progress before adopting the committed copy.
- **Reset active world** requires the active world name as explicit confirmation, retains the exact prior Worker snapshot, loads a Worker-created fresh snapshot, and commits the next immutable generation to the same slot identity. No other slot is written.
- New, Duplicate, slot selection, and import share one FIFO authority queue. Every queued world transition synchronously suspends focus actions and rejects direct tick dispatch. Ordinary archive operations can queue behind an ordinary switch and then resolve against the final Worker-owned slot. Reset may start only when no other world transition is pending, then establishes a stricter exclusive barrier before its first await; this prevents both same-name target drift and same-turn save, export, settings, or lifecycle actions from racing its durable result.

## Persistence and failure recovery

- A new or duplicated slot is inactive until its exact committed snapshot is accepted by the Worker. If that load fails, the prior Worker world and active preference remain selected; the immutable new slot remains safely available rather than being deleted or misreported.
- A failed reset rereads the exact durable slot. If the fresh snapshot actually committed and only its receipt failed, Chrono Forge adopts that generation. Otherwise the Worker rolls back to the durable prior generation, falling back to the retained exact snapshot only when no newer durable head exists.
- If the reset result cannot be reread, Worker rollback fails, or the committed world cannot be synchronized with the archive UI, the shared queue fails closed until restart. Focus actions, tick dispatch, slot mutation, save, export, import, and settings writes remain disabled so ambiguous Worker authority cannot overwrite either possible durable head.
- Active-slot preference failure after a successful world adoption is shown as a persistence error without pretending the Worker still owns the prior world. Existing save loading and focus history remain generation- and slot-bound.

## Regression and review recovery

- Focused coverage proves fresh creation starts at tick zero with the requested seed and leaves the source slot unchanged; duplication preserves the canonical current snapshot; reset keeps the slot identity and leaves other slots untouched; existing saves still load; active preference is ordered after durable adoption; and Worker-generated recovery never clones the faulted world.
- Failure tests cover destination collisions, Worker load rejection, commit failure with verified rollback, a post-commit receipt failure, an unreadable durable result, rollback failure, and post-commit adoption failure. Every ambiguous branch proves the permanent fail-closed control state.
- Independent review first found that ambiguous-reset branches froze only the local callback while remounted/queued controls could continue, then found a same-turn tick gap and a broader in-flight reset race. The parent-owned blocker, synchronous transition counters, direct tick predicate, and exclusive reset barrier closed those findings without discarding the established queued archive semantics.
- Exact-head PR review then found one additional destructive edge: Reset could join the queue behind an ordinary switch and, if the later slot had the same display name, reset that different slot. Reset now refuses synchronously while any world transition is pending and is visibly disabled for that interval. A same-turn identically named two-slot regression proves the switch completes, Reset makes no commit, and neither slot changes.
- Final independent Terra/high re-review reports no P0-P3 finding. It independently passed the 41-test lifecycle suite, the 70-test Worker/protocol/frame/hook/seed suite, TypeScript, zero-warning web lint, web formatting, and diff hygiene.

## Actual UI and complete local gate

- Supervised browser-preview inspection created a fresh `world-2` with seed `[11,13,17,19]` at tick 0, then reset that same slot with seed `[41,43,47,53]` at tick 0 while the other slot remained intact. Both the world header and lifecycle panel displayed the exact active seed. The final production browser journey also asserts the Worker-owned seed is visible.
- Exact corrected product/test tree passed `npm run ci` on 2026-10-16: formatting; zero-warning web/Rust lint; TypeScript; 73 covered files/614 tests in 342.27 seconds with 88.86% statements, 81.53% branches, 94.70% functions, and 90.61% lines; 14 long files/32 tests in 1,192.94 seconds; Rust 43/43; browser 7/7; four installed native phase files/six tests across a true process relaunch; post-exit SQLite `integrity_check=ok`, empty foreign-key violations, three slots, eight generations, and two sessions; SBOM generation with 770 npm and 281 Cargo components; production test-code exclusion; and the unsigned Windows x64 NSIS installer.
- The desktop harness printed its known upstream `tauri-driver not found` diagnostic while successfully using the configured embedded driver, plus post-session mock-store cleanup warnings after each already-passed session. All six native assertions, the cold relaunch, exact SQLite gate, production build, installer, and exclusion scan passed, so those diagnostics are non-failing environment noise rather than accepted product failures.

## Delivery state and exact next action

- M10.9 is locally implemented, independently reviewed, and complete-gate green. It is not delivered until the exact committed PR head passes aggregate `Required`, merges sequentially, and the exact merge head also passes aggregate `Required`.
- Commit only the reviewed M10.9 paths, push `release/v1-world-lifecycle-save-slots`, open one PR, wait for exact-head Web/Windows/aggregate `Required`, merge only when green, then require exact merge-head `Required`. Continue immediately to M11 from that delivered main.
