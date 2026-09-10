# Progress

Last updated: 2026-09-09

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; never stop at a prototype, partial roadmap, or milestone gate.
- Current milestone: M10 content hardening is active on `release/v1-content-hardening`. M0-M9 are merged and hosted-verified on `main` at durable checkpoint `cd2f7485e0e7c40883b1ddc90efdd129b1e74fb8`. The first independently reviewed M10 product checkpoint is `ebae3df9a6d117edac8d9fcb211a6f17767649fc`.
- Checkpoint scope: 25 deterministic 60-year worlds, release-quality generated person/culture/belief/tradition/architecture/celestial vocabularies, complete runtime-asset attribution enforcement, canonical snapshot v11, and exact v10-to-v11 name-only migration for legacy `Body-N` celestial placeholders.
- Spending safety: never use an API key, purchased credits, promotional credits, usage-reset credits, or the owner's credit balance. Weekly allowance percentage is informational and never pauses or blocks work.
- v1.0 completion: not satisfied. M10 still has explicit product gaps below; M10.1, M10.2, M10.5-M10.9, M11, M12, clean release verification, tag, checksums, artifacts, and private GitHub release all remain release-blocking.

## HARNESS EVALUATION

- Requirements verified versus remaining: the first M10 checkpoint locks 25 unique seeds at years 5, 25, and 60; deterministic canonical hashes and operation totals; continued autonomous work; bounded populations/history; cultural, knowledge, relationship, multi-generation, crisis-recovery, and multi-settlement evidence; canonical round trips; broad generated content; exact asset ownership; and preservation of the dedicated M9 240-year space proof. M10 is not complete: settlement evolution through advanced cities, full relationship lifecycle semantics, true collapse-to-recovery evidence, expanded factual event descriptions, integrated advanced-city/space semantics, and player-facing controls/rules/limitations/troubleshooting documentation remain.
- Build/test/CI: exact product commit `ebae3df9a6d117edac8d9fcb211a6f17767649fc` passes the complete local gate: formatting; zero-warning web and Rust lint; type checking; 60 covered files/415 tests; 11 long files/25 tests; Rust 20/20; browser E2E 6/6; native SQLite/desktop E2E 3/3; SBOM generation; production web/Tauri/NSIS build; and production test-code exclusion. Hosted CI has not run because M10 remains active and no PR has been opened.
- Known defects and technical debt: no confirmed correctness defect remains in this checkpoint. M10's product gaps remain release blockers, especially the authoritative model currently exposing only shelter/storehouse rather than village/town/city/advanced-city development. Tracked non-blocking debt is the roughly 771 kB production web chunk warning, upstream embedded-driver cleanup diagnostics after passing native specs, lack of native UI automation attachment in the current computer-use runtime, and absent Windows signing credentials.
- Significant failures and autonomous recovery: initial red gates exposed the missing attribution manifest and insufficient generated breadth; implementation closed both. Independent review found legacy v10 saves retaining `Body-N`, an overstated event-description claim, and an incomplete asset scanner; snapshot v11 migration, truthful scope, broader scanning, and regression coverage closed all three. The native executable was first locked by an earlier process and sandboxed app data was read-only; the exact process was stopped and the authorized live-host native suite passed. A final lint failure from an unused destructure was corrected without weakening the semantic comparison, then the full gate passed.
- Review/subagent findings: a Terra/high independent reviewer reported one high and two medium findings, all corrected. A fresh exact-tree follow-up reviewed the fixes and passed 4 focused files/51 tests in 13.92 seconds plus `git diff --check`, with no remaining finding. A separate M10 audit identified the still-blocking settlement, collapse, relationship, event-description, space-integration, and documentation gaps; reviewers modified no files and did not merge.
- Demonstrated scale/performance: 25 fixed four-word seeds each run 300,000 production ticks (60 civil years at 5,000 ticks/year), with semantic checkpoints at years 5, 25, and 60 and exact per-system operation totals in `tests/fixtures/m10-scenarios.ts`. The complete serial long catalogue passed 11 files/25 tests in 1,323.84 seconds, including 1,308.74 seconds of test work. Earlier M8 100,000-person scale evidence and M9 240-year space evidence remain unchanged.
- Buildable/runnable: yes. The unsigned production x64 NSIS installer builds at `src-tauri/target/release/bundle/nsis/Chrono Forge_0.1.0_x64-setup.exe`. Real native SQLite relaunch/migration flows pass. Production browser inspection verified varied generated people and cultures, named home bodies, factual construction feedback, and no browser warning/error; the current UI tool could not attach to the native surface, so that limitation is retained for later native visual QA rather than treated as evidence.
- Fresh-root recoverability: yes after this document commit. Repository documents identify the immutable product checkpoint, exact validation and review evidence, incomplete M10 rows, current branch, risks, and exact next action without conversation history.

## M10 checkpoint scope

- `M10_EVIDENCE.md` maps every explicit `PRODUCT_SPEC.md` area to existing evidence, this milestone's acceptance work, and later release gates. It explicitly makes no completion claim for unfinished rows.
- `tests/fixtures/m10-scenarios.ts` and `tests/long/m10-content-catalogue.long.test.ts` own the 25-seed/60-year deterministic catalogue, semantic assertions, canonical hashes, bounded work totals, and save/reload subset.
- `src/simulation/content/index.ts` supplies project-original versioned generated vocabularies while preserving deterministic draw boundaries. The breadth test covers 64 initial worlds.
- `assets/attribution.json` is the single exact ownership manifest for runtime and packaging media. The integration gate scans asset-bearing source/package paths and fails on missing, duplicate, dangling, or incomplete attribution.
- Snapshot/current engine/content format is v11. Strict v10 parsing remains only to migrate exact celestial placeholders through an isolated deterministic naming stream; all non-name body fields and event history remain byte-for-byte canonical, and current snapshots reject placeholders.

## Validation evidence

- Covered suite: 60 files/415 tests in 232.18 seconds; 88.33% statements, 80.85% branches, 94.45% functions, and 90.11% lines.
- Complete long catalogue: 11 files/25 tests in 1,323.84 seconds; 1,308.74 seconds of test work.
- Rust: 20/20. Browser E2E: 6/6 in 22.5 seconds. Native SQLite/desktop E2E: 3/3 in 10.2 seconds, one spec green in 13 seconds.
- SBOM: 770 npm and 281 Cargo components. Production web/Tauri/unsigned x64 NSIS build and production test-code exclusion are green.
- Independent exact-current review: clean after the three reported findings were fixed; no checkpoint-relevant finding remains.

## Active risks and blockers

- M10 cannot close until its remaining explicit semantic and documentation gaps are implemented and independently reviewed. A broad long-run smoke assertion is not a substitute for controlled evidence of collapse/recovery or relationship lifecycle outcomes.
- The private repository cannot enforce branch protection (HTTP 403), so root must continue enforcing independent review plus green aggregate `Required` CI before every merge.
- M10.1, M10.2, M10.5-M10.9, M11, and M12 remain independently blocking. This checkpoint does not pre-accept enjoyment, sound, art direction, bug hunts, stabilization, world lifecycle, release-candidate, or release requirements.
- Windows signing credentials are not established. Do not invent, purchase, or expose credentials; use the documented private unsigned fallback unless authorized credentials already exist at release time.

## Root rotation state

- This Sol/xhigh root owns task `INPROGRESS` while it records and pushes the checkpoint. No second root may edit this checkout concurrently.
- The active branch is `release/v1-content-hardening`; immutable product checkpoint is `ebae3df9a6d117edac8d9fcb211a6f17767649fc`. A following documentation commit records this handoff evidence; the branch must be pushed before ownership transfer.
- After push, create a fresh same-project Sol/xhigh `INPROGRESS` root. It must ignore chat history as authority, reconstruct and verify repository/GitHub/CI state, state the exact next task, and affirm sole root ownership before editing. This root then becomes `RETIRED` and stops all project work.

## Exact next action

Lock observable acceptance and add failing tests for an authoritative, persisted settlement-development stage covering `founding`, `village`, `town`, `city`, and `advanced-city`. The stage must be earned or lost only from real population, operational structures/infrastructure, contextual knowledge, and stability; migration must derive an initial stage without fabricating history; later changes must be factual events; and the Worker projection plus optional inspector must expose it read-only. Implement the smallest coherent vertical slice, then require the 25-seed M10 catalogue to demonstrate at least one factual advanced city while preserving determinism, save/load, bounded work, and existing authority invariants. In the same active M10 milestone, follow with controlled collapse-to-recovery and relationship-lifecycle evidence, retained M9 physical-space integration, factual event-description breadth, and the missing user documentation; do not move any requirement to a later roadmap gate.
