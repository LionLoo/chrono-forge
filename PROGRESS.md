# Progress

Last updated: 2026-09-11

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; never stop at a prototype, partial roadmap, or milestone gate.
- Current milestone: M10 content hardening is active on `release/v1-content-hardening`. M0-M9 are merged and hosted-verified on `main` at durable checkpoint `cd2f7485e0e7c40883b1ddc90efdd129b1e74fb8`. The latest independently reviewed M10 product checkpoint is `8a6e0710d206dae6f45c4caffb463ae791ad8812`; prior settlement-stage product checkpoint is `ca101aaaf700bb786d109e3570da6c995e81b65d`.
- Checkpoint scope: the existing release-quality generated content, attribution, snapshot-v12 settlement stages, Worker protocol v9, advanced-city space gate, and 25-seed catalogue now include a dedicated controlled same-world collapse-to-autonomous-recovery golden scenario with factual chronology, four decline/rebound dimensions, no M5/M6 shortcut, and canonical low-point reload.
- Spending safety: never use an API key, purchased credits, promotional credits, usage-reset credits, or the owner's credit balance. Weekly allowance percentage is informational and never pauses or blocks work.
- v1.0 completion: not satisfied. M10 still has explicit relationship-lifecycle, event-description, and user-documentation gaps below; M10.1, M10.2, M10.5-M10.9, M11, M12, clean release verification, tag, checksums, artifacts, and private GitHub release all remain release-blocking.

## HARNESS EVALUATION

- Requirements verified versus remaining: the 25-seed catalogue still locks years 5, 25, and 60, canonical hashes, operation totals, bounded authority, broad content, canonical round trips, and an observed factual advanced city. Dedicated cooperative-profile seed `[1,2,3,4]` now proves true collapse from 17 living residents to zero, bounded-window production 923 to zero, shelter integrity 2,732 to a 2,105 trough, stability 100 to zero, factual recovery at tick 160,000, and long-horizon rebound without intervention, M5 crisis, M6 conquest/refugee/territory shortcut, reset, invalid authority, or reload divergence. M10 is not complete: full relationship-lifecycle semantics, expanded factual event descriptions, and player-facing controls/rules/limitations/troubleshooting documentation remain.
- Build/test/CI: exact product commit `8a6e0710d206dae6f45c4caffb463ae791ad8812` passes the complete local gate: formatting; zero-warning web and Rust lint; type checking; 60 covered files/422 tests; 12 long files/26 tests; Rust 20/20; browser E2E 6/6; native SQLite/desktop E2E 3/3; SBOM generation; production web/Tauri/NSIS build; and production test-code exclusion. Hosted CI has not run because M10 remains active and no PR has been opened.
- Known defects and technical debt: no confirmed correctness defect remains in this checkpoint. Tracked non-blocking debt is the roughly 786 kB production web chunk warning, upstream embedded-driver diagnostics before and after passing native specs, lack of native UI automation attachment in the current computer-use runtime, and absent Windows signing credentials. The three unfinished M10 semantic/documentation areas remain release blockers.
- Significant failures and autonomous recovery: the first cooperative collapse shock boundary coincided with an unrelated flood, so the controlled checkpoint moved earlier without altering production behavior. Binary operational capacity did not represent the authoritative shelter damage because the structure remained usable; the evidence now measures total shelter condition and separately locks every dimension's trough. Strict lint then caught two redundant non-null assertions and independent review found that the no-pending-intervention claim was checked only at the initial shock; both test defects were fixed, the reviewer re-cleared the exact diff, and the complete gate was rerun. Earlier advanced-city, stale-golden, million-tile rescan, native sandbox, and Windows Git-provenance failures remain durably resolved.
- Review/subagent findings: a Terra/high read-only explorer found the M4 recovery baseline insufficient for M10's dedicated evidence and identified the missing decline, full-shortcut, low-point-reload, and M10-owned checkpoint assertions. A fresh Terra/high independent reviewer found one low evidence mismatch: pending interventions were initially excluded only at shock time. The queue is now asserted empty at every fixed window through the final horizon; focused validation passed and the reviewer re-reviewed the fix clean. No correctness, determinism, persistence, performance, accessibility, or coverage finding remains. Reviewers modified no files and did not merge.
- Demonstrated scale/performance: 25 fixed four-word seeds each run 300,000 production ticks (60 civil years at 5,000 ticks/year), with semantic checkpoints at years 5, 25, and 60, exact per-system operation totals, and at least one event-backed advanced city. The complete serial long catalogue now passes 12 files/26 tests in 1,152.33 seconds, including 1,139.22 seconds of test work and the dedicated 600,000-tick collapse/recovery world. The settlement fact collector remains proven to scan 1,000,000 owned tiles once for 32 settlements. Earlier M8 100,000-person scale evidence and M9 240-year physical/alien evidence remain green.
- Buildable/runnable: yes. The unsigned production x64 NSIS installer builds at `src-tauri/target/release/bundle/nsis/Chrono Forge_0.1.0_x64-setup.exe`. Real native SQLite relaunch/migration flows pass. Actual browser inspection verified the optional inspector exposes `Development`, change tick, and provenance read-only; keyboard selection, layout, and browser warning/error logs were clean. The current UI tool still cannot attach to the native surface, so that limitation remains for later native visual QA rather than being treated as evidence.
- Fresh-root recoverability: yes after this handoff commit. Repository documents identify the immutable product checkpoint, exact validation and review evidence, incomplete M10 rows, current branch, risks, and exact next action without conversation history.

## M10 checkpoint scope

- `src/simulation/civilizations/index.ts` owns `founding`, `village`, `town`, `city`, and `advanced-city`, plus the last-change tick and `initial`/`v11-migration`/`observed` provenance. Annual evaluation uses stable settlement order and permits only one adjacent hysteretic transition.
- `src/simulation/world/index.ts` derives facts from real population, stability, operational structures, knowledge, owned tiles, routes, trade volume, and member settlements. A single deterministic tile histogram prevents settlement-count multiplication at scale; observed changes append factual events with validated backlinks.
- Snapshot/current engine/content format is v12 and Worker protocol is v9. v11 and older saves derive the highest fact-supported stage at their saved tick without inventing history; strict current snapshots validate stage, provenance, and event linkage.
- `src/simulation/space/index.ts` requires an advanced settlement before final spaceflight-program completion while preserving advanced-energy and planetary-engineering as separate prerequisites.
- `tests/fixtures/m10-scenarios.ts` and `tests/long/m10-content-catalogue.long.test.ts` retain the 25-seed/60-year deterministic catalogue and now require an active observed advanced city with a factual source event. Worker, panel, migration, invariant, scale, and native relaunch tests cover the vertical slice.
- `tests/fixtures/m10-collapse-recovery.ts` and `tests/long/m10-collapse-recovery.long.test.ts` own the severity-100 tick-150,000 controlled shock, exact pre-shock/low/recovery/final hashes and per-system operations, fixed-window metrics and troughs, event order, shortcut exclusions, invariants, and canonical low-point reload-to-recovery equivalence.
- `M10_EVIDENCE.md`, the generated-content system, and the attribution manifest retain the earlier content/asset checkpoint and explicitly make no completion claim for unfinished M10 rows.

## Validation evidence

- Covered suite: 60 files/422 tests in 191.40 seconds; 88.34% statements, 80.97% branches, 94.51% functions, and 90.10% lines.
- Complete long catalogue: 12 files/26 tests in 1,152.33 seconds; 1,139.22 seconds of test work.
- Rust: 20/20. Browser E2E: 6/6 in 18.3 seconds. Native SQLite/desktop E2E: 3/3 in 10.1 seconds, one spec green in 13 seconds.
- SBOM: 770 npm and 281 Cargo components. Production web/Tauri/unsigned x64 NSIS build and production test-code exclusion are green.
- Independent exact-product review: the M10 collapse/recovery diff is clean after one low test-evidence finding was fixed and re-reviewed. The dedicated corrected scenario passes 1 file/1 test in 56.31 seconds; the complete exact-tree gate above is green after that fix.

## Active risks and blockers

- M10 cannot close until its remaining explicit semantic and documentation gaps are implemented and independently reviewed. Broad relationship activity is not a substitute for every required lifecycle outcome.
- The private repository cannot enforce branch protection (HTTP 403), so root must continue enforcing independent review plus green aggregate `Required` CI before every merge.
- M10.1, M10.2, M10.5-M10.9, M11, and M12 remain independently blocking. This checkpoint does not pre-accept enjoyment, sound, art direction, bug hunts, stabilization, world lifecycle, release-candidate, or release requirements.
- Windows signing credentials are not established. Do not invent, purchase, or expose credentials; use the documented private unsigned fallback unless authorized credentials already exist at release time.

## Root rotation state

- This Sol/xhigh root owns task `INPROGRESS` while it records and pushes the checkpoint. No second root may edit this checkout concurrently.
- The active branch is `release/v1-content-hardening`; immutable product checkpoint is `8a6e0710d206dae6f45c4caffb463ae791ad8812`. A following documentation commit records this exact evidence and handoff; the branch must be pushed before ownership transfer.
- After push, create a fresh same-project Sol/xhigh `INPROGRESS` root. It must ignore chat history as authority, reconstruct and verify repository/GitHub/CI state, state the exact next task, and affirm sole root ownership before editing. This root then becomes `RETIRED` and stops all project work.

## Exact next action

Audit the production relationship and biography evidence against every remaining M10 lifecycle outcome, then lock the smallest dedicated deterministic catalogue that closes real gaps: multi-decade persistent friendship and grudge, partnership, household change, estrangement and reconciliation, bereavement, and multi-generation lineage/child provenance. Each outcome must arise through normal bounded relationship/society systems, retain valid living/dead/household/genealogy references and chronology, survive canonical save/reload, appear only in factual source-backed biography/history text, and keep the sparse graph within caps; do not satisfy acceptance by directly fabricating final relationship state or events. Preserve the retained M9 physical-space integration, then continue with factual event-description breadth and missing user documentation; do not move any M10 requirement to a later gate.
