# Progress

Last updated: 2026-09-08

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; never stop at a prototype or partial roadmap.
- Current milestone: M0-M8 are merged, independently reviewed, and hosted-verified on `main`. M9 planetary civilization and space age is acceptance-complete locally on `feature/planetary-space-age` from base `e17bb457bbde484d18a5dc8936e7c3fd4f397d65`; its exact commit, private PR, hosted CI, merge, and durable main checkpoint are next.
- Spending safety: never use an API key, purchased credits, promotional credits, usage-reset credits, or the owner's credit balance. Weekly allowance percentage is informational and never pauses or blocks work.
- v1.0 completion: not satisfied. M9 integration; M10; M10.1 focus-session engagement and return value; M10.2 sound, atmosphere, and game feel; M10.5 UI/graphics overhaul; M10.6 frontend bug hunt; M10.7 backend bug hunt; M10.8 whole-product stabilization; M10.9 world lifecycle/save-slot semantics; M11-M12; clean release verification; tag; artifact; checksums; and private GitHub release remain fully blocking.

## HARNESS EVALUATION

- Requirements completed versus remaining: M9 now has deterministic `SpaceState` authority, snapshot v10, Worker protocol v8, generated bodies, autonomous programs/missions, ships/orbits, colonies, exact resident/resource transfers, due-tick cargo/comms, alien contact/relations, bounded projections, optional inspection, and two locked long scenarios. M0-M8 remain hosted-verified; M9 still needs hosted integration, and every later release gate remains.
- Build/test/CI: the exact local tree passes formatting, zero-warning lint, type checking, 58 covered files/409 tests (88.40% statements, 80.90% branches, 94.43% functions, 90.18% lines), 10 long files/23 tests, Rust 20/20, browser E2E 6/6, native SQLite/desktop E2E 3/3, SBOM generation, production web/Tauri/NSIS build, and production test-code exclusion. The last hosted base checkpoint is `e17bb457bbde484d18a5dc8936e7c3fd4f397d65`, CI `34016240643`, green including aggregate `Required`; M9 hosted CI is pending.
- Known defects/debt: no confirmed M9 correctness or acceptance defect remains. Release-blocking presentation work still includes the stale `Milestone 7` hero label found during native QA and the broader M10.5 overhaul. Other tracked debt is the roughly 768 kB web-chunk warning, irrelevant upstream embedded-driver cleanup diagnostics after passing native specs, and absent Windows signing credentials.
- Major failures and autonomous recovery: independent review found cross-authority cargo/colony ownership errors and later an abandoned-colony duplicate identity; root corrected authority/lifecycle rules and added regression coverage. Coverage instrumentation exceeded several wall-clock-only test cutoffs, so bounded timeout headroom was added without changing semantic, hash, operation, or performance assertions. Native E2E initially reused stale WebView/save status; explicit refresh, authoritative session/save waits, and slot activation made all three cases pass together. Elevated Windows Git provenance checks reported dubious ownership; repository-scoped `safe.directory` arguments removed the environment warning without changing provenance semantics.
- Review/subagent findings: Terra/high independent review and exact-tree follow-ups are clean after fixes. The final follow-up verified timeout/native-harness changes and separately confirmed the two safe-directory test edits preserve every performance and provenance assertion. Reviewers modified no files and did not merge.
- Demonstrated scale/performance: `concord-orbit` exact hashes are `6fd1de9c`, `a9f64693`, `caef75c2`, and `6af71a3f`, with 1,324,645 total measured operations; `contested-frontier` hashes are `fa6c9fd4`, `cb6bafbb`, `8b761a19`, and `12e9a783`, with 1,569,920 operations. M8's real 100,000-person cohort evidence, bounded LOD/path queues, delta budgets, and soak proof remain unchanged. Candidate scans are bounded to 16 per cohort plus a 100,000-person proxy.
- Buildable/runnable: yes. The production x64 NSIS installer builds at `src-tauri/target/release/bundle/nsis/Chrono Forge_0.1.0_x64-setup.exe`. Native visual QA on the production executable verified a legible world, non-color cues, focus archive, optional society and M9 space inspection, explicit pre-spaceflight prerequisites, no horizontal clipping, and accessible controls.
- Fresh-root recoverability: yes. Repository documents record the exact branch/base, M9 authority, validation evidence, resolved failures, remaining risks, and next Git/GitHub action without relying on conversation history.

## Release-plan amendment

- User-directed gates M10.1, M10.2, and M10.5-M10.9 are release-blocking after M10 and before M11. M10.1 makes the factual focus-session feedback loop, pacing, and long-term return value a deliberate product gate rather than an assumed outcome. M10.2 adds a calm, optional, factual soundscape and feedback layer for game feel. M10.5 is a release-quality explorable-civilization, game-art-direction overhaul, not a dashboard reskin: it explicitly replaces circle-only people and generic/debug-like presentation with polished factual characters, homes, buildings, terrain, settlements, map navigation at wide and close scales, UI, and focus-session visuals. M10.6-M10.8 add dedicated frontend, backend, and whole-product bug hunts; M10.9 adds explicit New World / Duplicate Current World / Reset World semantics. None replaces ongoing fixes or final release verification.
- M10.8 explicitly owns the reported long-focus freeze in which timer, controls, and world advancement can stall, plus comparable cross-layer responsiveness failures.

## M9 verified scope

- `SpaceState` resolves after M6 annual civilization work and owns stable bodies, programs, ships, missions, colonies, cargo/comms, contact, and space relations. Fixed quotas, total ordering, stable IDs, named RNG streams, and due-tick queues keep outcomes partition-independent and bounded.
- Resident and resource movement is exact across terrestrial, transit, and colony authority. Abandoned-colony residents remain disjoint from terrestrial authority; hidden civilizations cannot leak through pre-contact relation validation or projection.
- Snapshot v10 migrates canonical v9 and older states without fabricated space history. Worker v8 and read-only projections expose bounded factual state; `SpacePanel` remains closed during normal focus use and explains prerequisites or actual missions/contact when inspected.
- `concord-orbit` and `contested-frontier` prove long-horizon autonomous space development, crises, interworld exchange, contact, loss/abandonment, save/load, partition equivalence, canonical hashes, bounded work, and preserved M4.5 family/social identity.

## Validation evidence

- Covered suite: 58 files/409 tests; 88.40% statements, 80.90% branches, 94.43% functions, and 90.18% lines.
- Complete long catalogue: 10 files/23 tests green in 1,846.46 seconds; the final two performance/provenance files also pass 5/5 in 23.20 seconds after the environment-only Git invocation change.
- Rust: 20/20. Browser E2E: 6/6 in 37.6 seconds. Native E2E: baseline 1/1 and full three-case group 3/3 in 10 seconds after the harness-state repair.
- SBOM: 770 npm and 281 Cargo components. Production web/Tauri/unsigned x64 NSIS build and test-code exclusion verifier are green.
- Independent exact-current review: clean; no release-relevant finding remains.

## Active risks and blockers

- The private-repository plan cannot enforce branch protection (HTTP 403), so root must enforce independent review plus green aggregate `Required` CI before every merge.
- M9-M12 and all M10.x gates remain release-blocking. Local M9 evidence is not hosted integration or a v1 release.
- Windows signing credentials are not established. Do not invent, purchase, or expose credentials; use the documented private unsigned fallback unless authorized credentials already exist by release time.

## Root rotation state

- This Sol/xhigh root owns task `INPROGRESS`; prior roots are retired and no second root may edit this checkout.
- Repository state is authoritative. The active branch is `feature/planetary-space-age` from verified base `e17bb457bbde484d18a5dc8936e7c3fd4f397d65`.

## Exact next action

Run final diff hygiene, stage only M9-owned paths, commit the verified feature checkpoint, recheck live GitHub auth, push and open the private M9 PR, require green aggregate `Required` CI, merge sequentially, then persist and verify the durable main checkpoint before rotating to a fresh Sol/xhigh root for M10.
