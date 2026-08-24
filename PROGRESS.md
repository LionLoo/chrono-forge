# Progress

Last updated: 2026-08-23

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; do not stop at a prototype or partial roadmap.
- Current milestone: M4 economy, generations, society, culture, and factual history is active; its observable acceptance matrix and architecture decisions are locked before implementation.
- Current branch: `feature/living-societies`, created from clean synchronized `main` at durable handoff `6b5b37aa5b485ca51cd9d3b69df00705b0b0c9cb`.
- Remote: `https://github.com/LionLoo/chrono-forge` is private. PR #4 merged after replacement run `32684735423` passed web, Windows, installer, and aggregate `Required`; `main` run `32685404763` started from the merge and may be superseded by this handoff update.
- Included-usage meter: no read-only weekly allowance value is exposed. Work uses only the included ChatGPT/Codex plan path; no API key, purchased/promotional credit, or account credit is used.
- v1.0 completion: not satisfied. M4-M12 remain release-blocking.

## HARNESS EVALUATION

- Requirements verified versus remaining: M0-M3 are merged. M4 acceptance is locked with exact seeds/horizons, normal versus accelerated calendar pacing, household economy, multi-generation/culture/social evidence, typed factual history, v3 recovery, UI/accessibility, determinism, long-run, and intermediate performance gates. The isolated deterministic society core, fixed scenario catalogue, and accessible read-only inspector are implemented; authoritative world/Worker/persistence integration and the full M4 gates remain, followed by M5-M12.
- Build/test/CI: the durable M3 `main` gate remains green. The M4 foundation passes strict type checking, scoped ESLint, and 2 focused files/14 tests for society logic and the inspector. Full M4 CI is not claimed until integration is complete.
- Known defects/debt: no confirmed open M3 P0-P2 after fixes and closure review. The new society state is intentionally not yet connected to World authority, snapshots, Worker projections, or App UI; that is the active implementation boundary, not accepted M4 behavior. Existing non-blocking debt is the >500 kB main bundle warning and misleading upstream embedded-WebDriver cleanup diagnostics. M8 scale budgets, signing credentials, and private-plan branch protection remain future/operational gates.
- Major failures and autonomous recovery: review caught invented dry-tile water, excess repair material charges, permissive impossible v2 states, stale plans, color-only condition, and missing restore evidence; each received a root-cause fix and regression. Legacy migration originally replayed settlement history to the saved tick; it is now factual constant-time founding. Final property CI minimized a 1×1 seed-zero world that forced a second structure onto the occupied shelter tile; site selection now defers when no physical site exists and the minimized/property suites pass. The first native rerun failed because the sandbox could not write isolated AppData, and the first production bundle retry could not download pinned NSIS; permission-correct reruns passed without product changes. Hosted PR CI then showed the second million-tick parity test still used Vitest's five-second default; it now receives the same 30-second bound as its sibling without weakening assertions.
- Review/subagent findings: M4 Terra/high acceptance review exposed calendar, scenario, factual-biography, migration, and history-working-set gaps; Sol locked them before implementation. Root review then caught over-frequent social/economic events and unrelated birth households in the isolated kernel; quarter-year cadence, parent household linkage, role-gated production, tool exchange, and stronger graph invariants are fixed with focused tests. The presentation worker kept the inspector read-only and source-event-labeled.
- Demonstrated scale/performance: the M3 evidence remains three deterministic seeds through 60,000 and 1,000,000 ticks plus 100 partition and 100 snapshot cases. The isolated M4 core caps residents at 64 and gates normal economy/social events to 25,000-tick quarters; integrated scenario-scale and timing evidence is still required. M8 population/latency/heap targets are not claimed.
- Buildable/runnable: yes. Production Chromium and the actual app surface show six agents, operational construction, factual events, stores, and accessible structure condition. A manual 5,000-tick save/advance/reload restored the exact visible settlement with no console errors. Native SQLite restart flow and Windows installer pass; production excludes WDIO/test capabilities.
- Fresh-root recoverability: yes. This repository records the verified M3 baseline, active M4 branch, locked M4 decisions/evidence, and exact implementation entry action without relying on chat history.

## M3 delivered

- Six stable founders with explicit bounded needs, health/age, traits/skills, relationships, knowledge, goals, plans/routes, factual memories, RNG streams, activity, and emergent occupation.
- Autonomous utility/goal decisions vary by geography, traits, social context, needs, stores, skills, and deterministic randomness; no routine build/job controls exist.
- Physical food/water/timber/stone gathering, carrying/deposit, renewable/depleting resources, storage, survival consumption, construction materials, and conservation regressions.
- Deterministic site selection and shelter/storehouse planning, construction, condition decay, repair, expansion, repurpose, abandonment, and demolition with travel-demand paths.
- Canonical v2 civilization saves, strict semantic rehydration, constant-time factual v0/v1 founding migration, continuation parity, and real-Worker/browser restore projection evidence.
- Packed transferable agent/structure projections, separate Pixi layers, factual event batches, settlement totals, accessible per-structure status/progress/condition, and non-color condition markers.

## M2 delivered

- Versioned injected-clock focus state machine with presets/custom durations, optional breaks, pause/resume/complete/cancel, backward-clock safety, sleep recovery, exact integer tick remainder, and collision-resistant session IDs.
- Accessible local-first focus/archive UI with calm mode, completion notifications/sound, per-world history/statistics/recaps, explicit local-data copy, numeric validation, and OS reduced-motion support.
- Canonical world envelopes/migrations, strict semantic rehydration, UTF-8 size limits, worker save/load/offline operations, confirmed-versus-projected rollback, and authoritative event replacement.
- SQLite WAL/FULL persistence with typed commands, multiple slots, immutable SHA-256 generations, schema v3 migration, last-active-slot recovery, import/export, retained fallback material, and bounded logged offline catch-up.
- Each generation carries its exact optional focus checkpoint. World, focus state/history, and head update atomically; corrupt fallback and retention operate on complete recoverable pairs, so focus ticks cannot be replayed or lost through mismatched recovery.
- Separate feature-gated native E2E build exercises start, pause, manual save, process reload, resume, completion, factual recap, and exact-generation checkpoint assertions through real IPC. Automated scans prove the test bridge/plugins are excluded from production.

## Validation evidence

- Final permission-correct `npm run ci`: passed after all review and property fixes. Its earlier native attempt correctly failed under read-only sandbox AppData; no product change was required for the permission-correct path.
- Vitest coverage: 34 files / 158 tests; 89.10% statements, 81.92% branches, 94.91% functions, 90.73% lines.
- Rust: 19 passed, 0 failed; formatting and Clippy `-D warnings` passed.
- M3 focused acceptance: 18 simulation tests passed; 3 seeds × 60,000/1,000,000 ticks, 100 partition cases, and 100 v2 snapshot cases pass.
- Production Chromium E2E: 1 passed with the real module Worker, Pixi renderer, structure semantics, and save/advance/reload continuity.
- Native desktop E2E: 1 passed; real SQLite start/pause/save/reload/resume/complete and paired checkpoint assertions.
- SBOM: generated with 770 npm and 281 Cargo components; full and production npm audits report zero vulnerabilities.
- Production build: `chrono-forge.exe` and `Chrono Forge_0.1.0_x64-setup.exe` built; exclusion scan passed.
- Independent review: core and Worker/UI reviews completed; all two P1 and four P2 findings are fixed with regressions. Closure review then found and verified the additional P2 memory/source-event fix; final 3-file/15-test review passed with no P0-P3 finding. Its narrow re-review of the deferred-site property fix passed 3 files/6 tests with no P0-P3 finding.
- Production visual QA: the built web surface passed polished full-page inspection, 5,000-tick settlement development, exact save/advance/reload, semantic structure condition/progress, and zero console warnings/errors.
- Hosted status: M3 PR #4 merged as `f6db7452f976b0dffe5c12a6e77a50b98f64d59f`. Its initial run `32684312568` exposed the five-second timeout; independently reviewed fix `8248d9e16da2681faddf26c7efd5f23627697f24` preserved assertions, and replacement run `32684735423` passed all jobs plus aggregate `Required`.

## Active risks and blockers

- No genuine external blocker. Remaining included weekly usage is not readable through available tools.
- Private-plan branch protection returned HTTP 403; operational policy remains independent review plus green `Required` CI before merge.
- Windows signing credentials are not established; the documented private unsigned-installer fallback remains unless existing credentials become available.
- Core product enjoyment is demonstrated only at founding-settlement scale: a representative 15,000-36,000-tick focus window yields a few factual changes while major societal progression remains for M4+. Return-over-many-hours evaluation remains release-blocking.

## Root rotation state

- Same-project root continuation is supported. After this M3 handoff commit has green durable `main` CI, spawn a same-directory GPT-5.6 Sol/xhigh successor with the unchanged original goal, contract, authority, billing guardrail, workflow, and stop conditions.
- The successor must reconstruct only from durable repository evidence, verify Git/GitHub/CI, state the exact next task, and affirm root ownership before editing; then the prior root stops.
- When task-title controls are available, the owning root chat is titled `INPROGRESS` and the relinquished root is retitled `RETIRED` after successful transfer. If the UI cannot mutate titles, record that limitation at rotation; the repository handoff remains authoritative.

## Exact next action

Integrate the tested society state into `CivilizationState` and the fixed World pulse order, add typed immutable factual World events and cross-graph invariants, then lock that authority with deterministic integration tests before snapshot v3 work.
