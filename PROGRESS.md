# Progress

Last updated: 2026-09-22

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; never stop at a prototype, partial roadmap, or milestone gate.
- Current milestone: M10.2 sound, atmosphere, and game feel is locally complete on `release/v1-sound-atmosphere-game-feel` from exact merged M10.1 main `7768d782100e38043115e1a8fe84c090326873e2`.
- Delivery state: M10.1 is delivered. M10.2 implementation, product QA, independent review, and the complete local exact-tree gate are green. Commit, push, one PR, exact-head hosted aggregate `Required`, merge, and merge-head aggregate `Required` remain open.
- Spending safety: never use an API key, purchased credits, promotional credits, usage-reset credits, or the owner's credit balance. Weekly allowance percentage is informational and never pauses or blocks work.
- v1.0 completion: not satisfied. M10.2, M10.5-M10.9, M11, M12, clean installed-artifact verification, tag, checksums, final artifacts, and private GitHub release remain independently release-blocking.

## HARNESS EVALUATION

- Requirements verified versus remaining: M10.2 now supplies a project-original procedural cue palette, five atmosphere scenes derived only from Worker facts, persisted master/ambience/effects/mute settings, quiet defaults, calm/reduced suppression, redundant visual/text feedback, silent audio-failure containment, and explicit authorship/licensing evidence. Browser review covers the settings and fallback experience; automated browser and installed-desktop evidence cover representative factual routing and SQLite relaunch persistence. Hosted exact-head and merge-head gates remain required before delivery.
- Build/test/CI: the final continuous local `npm run ci` exact-tree chain passes formatting, zero-warning web/Rust lint, type checking, 64 covered files/449 tests in 279.69 seconds, Rust 23/23, browser E2E 6/6 in 31.2 seconds, native SQLite/desktop E2E 3/3 in 27.5 seconds, and the complete 14-file/31-test long catalogue in 1,258.28 seconds. Coverage is 88.08% statements, 80.83% branches, 93.71% functions, and 89.82% lines. The same chain generated the 1,051-component SBOM, rebuilt the unsigned x64 NSIS installer, and verified the production exclusion boundary. M10.2 hosted CI is not yet run.
- Known defects and technical debt: no confirmed M10.2 correctness, determinism, persistence, performance, accessibility, coverage, or documentation defect remains after rereview. Non-blocking debt is the roughly 811 kB web chunk warning, upstream desktop-driver diagnostics after passing native specs, lack of native visual-automation attachment in the current computer-use runtime, unbounded total focus-history row retention inherited from M2, and absent Windows signing credentials.
- Significant failures and autonomous recovery: independent review found that changing audio settings replayed the last factual event batch; a one-shot event hook with a live settings reference and regression test closed it. Full-load Windows hybrid-core scheduling then caused wall-clock timeouts and an isolated p95 miss despite unchanged deterministic results. Per-core evidence identified logical CPU 9 as the stable path; the unchanged benchmark and final continuous gate passed with that affinity. No assertion, operation budget, performance threshold, deterministic hash, or product requirement was weakened; only explicit wall-clock allowances for already-heavy deterministic fixtures were widened.
- Review/subagent findings: the Terra/high reviewer found the stale-event replay defect and stale README milestone status, accepted both fixes, and reported no further release-relevant finding after focused hook/Worker tests, type checking, and diff review. Final focused review accepted the exact tree for commit after 3 affected files/17 tests passed in 23.43 seconds; it confirmed that the wall-clock changes preserve every assertion, deterministic hash, operation/performance threshold, and product requirement, and that the recorded gate evidence is exact.
- Demonstrated scale/performance: the exact final tree passes all 14 long files/31 tests in 1,258.28 seconds with 1,237.50 seconds of test work on the verified stable CPU affinity, including 25-seed 300,000-tick coverage, the 600,000-tick collapse/recovery world, relationship lifecycle evidence, consecutive focus worlds, and both 240-year M9 worlds. The locked performance benchmark passes without a threshold or operation-budget change; existing one-million-owned-tile/32-settlement and 100,000-person M8 evidence remains green.
- Buildable/runnable: yes. Browser production review verified readable audio controls, mute behavior, optional ambience, and redundant preview/status copy. The real desktop schema-v7 SQLite flow persisted master 34%, ambience 18%, effects 27%, and ambience enablement through relaunch while retaining focus, M9 mid-flight, and post-contact evidence. The exact-tree gate rebuilt the unsigned x64 NSIS installer at 3,112,991 bytes; SHA-256 `E1F1977ED38F91A6A1DA665AE84B1DDB73EBA1FA90561CC327CADD3BCCFA8037`. This is checkpoint evidence, not the final v1 release artifact.
- Fresh-root recoverability: yes. This root performed the documented repository-only logical reset because desktop task rules do not permit autonomously creating a second user-owned root task. It reread `PROGRESS.md`, `PLAN.md`, `PRODUCT_SPEC.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `README.md`, verified Git/GitHub/CI, accepted ownership, and continued from the durable exact next task.

## M10 delivered checkpoint

- `src/simulation/events/index.ts` owns the closed player-visible event-kind catalogue and factual-summary rules. All world, settlement, society, relationship, development, civilization, and space producers emit bounded source-specific descriptions with typed participant references; every registered kind is exercised through production admission.
- M10 delivered snapshot/current engine/content format v13 with Worker protocol v9. V12 and older migration upgrades only deficient event display summaries plus matching bounded memory/focus-recap copies; it preserves IDs, kinds, ticks, references, amounts, structured child evidence, RNG, and all other simulation authority and never adds, removes, or replays an event. M10.1 advances only the transport protocol to v10; snapshot/content remain v13.
- `src/adapters/persistence.ts` preserves legacy checkpoint-bound focus recaps only after exact raw-source equality and migrated-authority equality. Archive prose is active-slot/source-bound and indexed once per refresh; detached or inconsistent rows keep duration, issued-tick accounting, and event IDs but present no unverified narrative.
- `src/simulation/civilizations/index.ts` owns factual adjacent settlement stages through `advanced-city`; the 25-seed, controlled collapse/recovery, relationship/biography, M4-M6, and M9 golden catalogues retain semantic and operation-count assertions beside renewed v13 canonical hashes.
- `USER_GUIDE.md`, `README.md`, `ARCHITECTURE.md`, ADR-038, and `M10_EVIDENCE.md` document current controls, deterministic rules, offline/save behavior, privacy, accessibility, unsigned installation, known pre-release constraints, and the v13 provenance contract. They explicitly leave New/Duplicate/Reset World to M10.9 and do not pre-accept later sound, graphics, stabilization, release-candidate, or release gates.

## M10.1 delivered checkpoint

- `src/focus/session-review.ts` owns bounded version-1 moments, exact post-baseline event copies, deterministic revisit selection, and strict structural validation. Worker protocol v10 returns that projection with its canonical snapshot from one authoritative state.
- TypeScript and Rust persistence bind the review tick span to issued focus ticks, require recap/revisit provenance after the fixed baseline, require the after moment to match the exact saved-world tick, preserve deep-copy isolation, and accept legacy rows without inventing a review. SQLite schema v6 stores nullable review JSON and a generation-bound checksummed authority copy so factual history remains available across later saves while tampered copies fail closed.
- The focus surface names the active persistent world and stage, shows exact accepted duration/ticks and factual comparisons, uses explicit quiet copy, and offers a keyboard-operable revisit into the existing read-only inspector. Production observation no longer issues ticks.
- Deterministic evidence covers consecutive 25-minute early sessions, canonical middle reload plus a simulated multi-day gap and consecutive 50-minute sessions, and consecutive 60-minute sessions after the locked 240-year space checkpoint.

## M10.2 local checkpoint

- `src/adapters/soundscape.ts` owns the local presentation-only procedural cue palette, factual event classification, restrained priority reduction, five derived atmosphere scenes, gain composition, browser gesture unlock, silent failure containment, and cleanup. Audio never mutates Worker authority or timing.
- `useWorldSimulation` exposes only newly recorded post-advance event batches for feedback; initialization and loaded history are excluded. `useFactualEventSound` consumes each batch once while consulting current settings, so setting changes cannot replay stale facts.
- TypeScript and Rust schema-v7 settings persist master, ambience, effects, and mute alongside existing sound, calm, and reduced-effects controls. Browser and native tests cover defaults, bounds, v6 migration, round trips, active use, and desktop relaunch.
- Focus actions, selection, progress, danger, discovery, and major factual events retain visible or textual state. Ambience is off by default; mute, calm mode, reduced effects, zero gains, unavailable Web Audio, suspended contexts, playback failure, and cleanup failure all preserve a usable focus/game experience.
- `M10_2_EVIDENCE.md`, `USER_GUIDE.md`, `README.md`, `ARCHITECTURE.md`, ADR-040, and `THIRD_PARTY_NOTICES.md` document current behavior, authorship, settings, accessibility, and the no-binary-audio-asset inventory.

## Prior M10 validation evidence

- Complete exact-tree local gate: passed.
- Covered suite: 61 files/432 tests in 194.17 seconds; 88.42% statements, 80.87% branches, 94.50% functions, and 90.19% lines.
- Complete long catalogue: 13 files/29 tests in 1,108.63 seconds; 1,094.73 seconds of test work.
- Rust: 20/20. Browser E2E: 6/6 in 19.7 seconds. Native SQLite/desktop E2E: 3/3 in 10.5 seconds, one spec green in 15 seconds.
- SBOM: 770 npm and 281 Cargo components. Production web/Tauri/unsigned x64 NSIS build and production test-code exclusion are green.
- Independent final product review: no remaining release-relevant finding after exact legacy recap migration, provenance binding, one-index history bounds, slot-switch preservation, full registered-kind admission, all-family v12 migration coverage, long golden renewal, and documentation review. The final focused review passed 4 files/77 tests in 16.67 seconds plus typecheck, formatting, and diff check.

## Active risks and blockers

- M10.1 is closed: PR #15 passed independent review, had no unresolved review threads, passed final-head and merge-head aggregate `Required`, and merged at `7768d782100e38043115e1a8fe84c090326873e2`.
- Live `gh auth status -h github.com` on 2026-09-21 still reports the saved `LionLoo` CLI token invalid. Host Git transport succeeds, and root used the same host credential non-interactively to open PR #15 without exposing it. The invalid CLI token is no longer a delivery blocker, but GitHub API operations must continue through the stored host credential unless CLI authentication is repaired.
- The private repository cannot enforce branch protection (HTTP 403), so root must manually enforce independent review plus green aggregate `Required` CI before every merge.
- M10.2 is locally accepted but not delivered until its exact commit passes hosted final-head review/CI, merges sequentially, and passes merge-head aggregate `Required`. M10.5-M10.9, M11, and M12 remain independently blocking; this checkpoint does not pre-accept release-quality graphics, bug hunts/stabilization, world lifecycle, release-candidate, or release requirements.
- Windows signing credentials are not established. Do not invent, purchase, or expose credentials; use the documented private unsigned fallback unless authorized credentials already exist at release time.

## Root rotation state

- This Sol/xhigh root owns task `INPROGRESS` and branch `release/v1-sound-atmosphere-game-feel`; no second root may edit this checkout concurrently.
- The branch starts exactly at merged and merge-head-green M10.1 main `7768d782100e38043115e1a8fe84c090326873e2`. Repository-only reconstruction is complete and root ownership is accepted.
- Rotate again after a coherent M10.2 checkpoint or context compaction. If same-project root transfer remains unavailable under desktop task rules, repeat the documented logical reset rather than running two roots against this checkout.

## Exact next action

Commit the exact reviewed M10.2 tree, push, open one PR, and enforce final-head aggregate `Required`, sequential merge, and merge-head aggregate `Required` before starting M10.5.
