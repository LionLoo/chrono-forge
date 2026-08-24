# Progress

Last updated: 2026-08-23

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; do not stop at a prototype or partial roadmap.
- Current milestone: M3 autonomous survival, agents, and construction is locally acceptance-complete after two independent reviews and fixes; final closure review and the private PR #4 gate remain.
- Current branch: `feature/autonomous-settlement`; verified M3 implementation checkpoint `00387bf11b65f37136d73fe6780e585b741a3ced` is based on durable M2 documentation commit `8439ec7c1470e0117b77d3339a08cbdf11ac9319`.
- Remote: `https://github.com/LionLoo/chrono-forge` is private. PR #3 replacement run `32409846530` and the durable `main` run `32412473633` passed, including aggregate `Required`.
- Included-usage meter: no read-only weekly allowance value is exposed. Work uses only the included ChatGPT/Codex plan path; no API key, purchased/promotional credit, or account credit is used.
- v1.0 completion: not satisfied. M4-M12 remain release-blocking after M3 merges.

## HARNESS EVALUATION

- Requirements verified versus remaining: M0-M2 are merged. M3 evidence covers autonomous needs/decisions, emergent occupations, physical gather/carry/deposit, survival, construction/site selection/material use, lifecycle transitions, paths, factual events/memories, packed Worker projections, accessibility, v2 persistence/migrations, partition equivalence, representative-session feedback, and multi-seed viability. M4-M12 remain mandatory.
- Build/test/CI: the final permission-correct `npm run ci` passes format, lint, strict type checking, 34 files/158 covered TypeScript tests, 19 Rust tests, production browser E2E, native restart/SQLite E2E, SBOM, optimized executable/NSIS installer, and production test-capability exclusion. Hosted M3 CI has not run yet.
- Known defects/debt: no confirmed open M3 P0-P2 after fixes; final closure review remains. Non-blocking debt is the existing >500 kB main bundle warning and misleading upstream embedded-WebDriver cleanup diagnostics. M8 scale budgets, signing credentials, and private-plan branch protection remain future/operational gates.
- Major failures and autonomous recovery: review caught invented dry-tile water, excess repair material charges, permissive impossible v2 states, stale plans, color-only condition, and missing restore evidence; each received a root-cause fix and regression. Legacy migration originally replayed settlement history to the saved tick; it is now factual constant-time founding. Final property CI minimized a 1×1 seed-zero world that forced a second structure onto the occupied shelter tile; site selection now defers when no physical site exists and the minimized/property suites pass. The first native rerun failed because the sandbox could not write isolated AppData, and the first production bundle retry could not download pinned NSIS; permission-correct reruns passed without product changes.
- Review/subagent findings: Terra/high acceptance work added 18 focused simulation tests. Independent core and UI reviews found the defects above and no Worker-authority violation. Closure review found one additional P2 factual-memory mismatch, which is fixed with a checksummed regression; its final verdict has no P0-P3 finding.
- Demonstrated scale/performance: three deterministic seeds retain all six founders and viable settlements through 60,000 and 1,000,000 ticks; 100 arbitrary partition cases and 100 seeded snapshot cases pass. The 15,000-36,000 window yields a few factual founding-scale changes without later societal progression. M8 population/latency/heap targets are not claimed.
- Buildable/runnable: yes. Production Chromium and the actual app surface show six agents, operational construction, factual events, stores, and accessible structure condition. A manual 5,000-tick save/advance/reload restored the exact visible settlement with no console errors. Native SQLite restart flow and Windows installer pass; production excludes WDIO/test capabilities.
- Fresh-root recoverability: yes. This repository records the active branch/base, completed M3 behavior/evidence, remaining review/PR gates, known limitations, and exact next action without relying on chat history.

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
- Hosted status: PR #3 and durable M2 `main` run `32412473633` are green. M3 PR #4 is not open yet.

## Active risks and blockers

- No genuine external blocker. Remaining included weekly usage is not readable through available tools.
- Private-plan branch protection returned HTTP 403; operational policy remains independent review plus green `Required` CI before merge.
- Windows signing credentials are not established; the documented private unsigned-installer fallback remains unless existing credentials become available.
- Core product enjoyment is demonstrated only at founding-settlement scale: a representative 15,000-36,000-tick focus window yields a few factual changes while major societal progression remains for M4+. Return-over-many-hours evaluation remains release-blocking.

## Root rotation state

- Same-project root continuation is supported. After M3 PR #4 merges and durable `main` CI is green, spawn a same-directory GPT-5.6 Sol/xhigh successor with the unchanged original goal, contract, authority, billing guardrail, workflow, and stop conditions.
- The successor must reconstruct only from durable repository evidence, verify Git/GitHub/CI, state the exact next task, and affirm root ownership before editing; then the prior root stops.
- When task-title controls are available, the owning root chat is titled `INPROGRESS` and the relinquished root is retitled `RETIRED` after successful transfer. If the UI cannot mutate titles, record that limitation at rotation; the repository handoff remains authoritative.

## Exact next action

Push `feature/autonomous-settlement`, open private PR #4 from the verified M3 checkpoint, and require green hosted CI before merge.
