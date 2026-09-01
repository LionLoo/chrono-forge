# Progress

Last updated: 2026-08-31

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; never stop at a prototype or partial roadmap.
- Current milestone: M6 multiple settlements, civilizations, diplomacy, and conflict is acceptance-complete and locally release-gated on `feature/multiple-civilizations`, based on durable M5 documentation head `6eff694f46b886e5d3be5d4ac76e6092cce28e4f`; private PR/main integration remains.
- Included usage: no read-only weekly allowance meter is exposed. Only the included ChatGPT/Codex plan path is used; no API key or purchased, promotional, or account credit is used.
- v1.0 completion: not satisfied. M6-M12 and the private v1.0.0 release remain fully blocking.

## HARNESS EVALUATION

- Requirements completed versus remaining: M0-M5 are merged and verified. M6 implements its locked authority, persistence/Worker v6, markets, utility-driven geopolitics, succession invariants, relationship consequences, four semantic long worlds, and deliberate inspection; independent corrective review and the complete local gate are clean. PR/CI/main integration, M7-M12, and release remain blocking.
- Build/test/CI: every `npm run ci` stage is green at this source state. Formatting, lint, type checking, and `git diff --check` pass; Vitest passed 55 files/319 tests with 89.73% statements, 82.67% branches, 96.55% functions, and 91.41% lines; Rust passed 19/19; browser E2E passed 3/3; native SQLite save/relaunch/resume E2E passed 1/1; the SBOM contains 770 npm and 281 Cargo components; the production NSIS installer built and contains no WDIO bridge, test capability, or broad global Tauri API. Hosted CI is still the durable M5 run `33360025841`; M6 CI does not exist until the private PR is pushed.
- Known defects/debt: no confirmed M6 correctness or accessibility defect remains. Non-blocking debt is the >500 kB web-chunk warning, the upstream embedded-Webdriver diagnostic, bounded-projection-only residency history pending M8 aggregation hardening, and absent Windows signing credentials for the later release gate.
- Major failures and recovery: independent review found four acceptance blockers: occupied ruins/settlement-less live civilizations, disconnected relationship selectors plus calendar/ID-scripted wars, metadata-only routes with no goods exchange, and non-inspectable residency identities. Root and one bounded market worker added conserved exchange, real relationship/material utility, evacuation/succession/route/territory invariants, controlled-world evidence, and accessible resident inspection. Long validation then exposed refugee transfer into another same-resolution conquered settlement; excluding the whole affected set fixed it. Competing long runs caused a false 120-second timeout; the isolated slowest world passed in 122.33 seconds, so the declared ceiling is 180 seconds. The native E2E initially raced archive bootstrap because it waited on a heading shared by loading and ready states; waiting for the native archive marker made the unchanged SQLite lifecycle pass. The sandbox initially blocked the official NSIS download; the authorized host retry built and verified the installer. Baselines changed only after semantic assertions passed.
- Review/subagent findings: the final Terra/high simulation re-review confirmed all three model blockers corrected and found no new code defect; its focused suite passed 7 files/56 tests. The independent UI re-review found the residency inspection correction clean; its panel suite passed 4/4 plus typecheck/lint/format. Live in-app QA found and fixed stale M5 hero/status copy, verified the M6 read-only panel and factual empty states, and verified calm-mode hide/restore with zero console errors.
- Demonstrated scale/performance: four 120-year/600,000-tick M6 worlds are locked. River ends at `417c61ba` with 384,429 settlement, 37,960 society, 120 development, and 1,455 geopolitical operations (423,964 total); ore `5b54b8c6` with 296,324/27,482/120/985 (324,911); storm `c2f4b3ec` with 271,361/23,136/120/569 (295,186); renewed `f538d979` with 375,309/38,844/120/778 (415,051). They prove two peaceful and two conflict paths, conserved trade/disruption, federation/fragmentation, relationship-selected movement/conflict, conquest/refugees, ruin/succession, exact reload, and fixed quotas. This is bounded M6 evidence, not M8 release-scale proof.
- Buildable/runnable: yes. Production web, native executable, and NSIS installer build at the current feature checkpoint; browser and native E2E plus manual in-app inspection pass.
- Fresh-root recoverability: yes. Repository docs identify the M5 base, active feature branch, completed M6 behavior/review/evidence, remaining final gate/PR steps, known debt, and exact next action without prior chat context.

## M6 delivered

- One annual world-owned `CivilizationsState` owns stable settlements, civilizations, residencies, diplomacy, routes/markets, conflicts, ruins, territory history, RNG, and operation evidence while preserving the M4.5 global named-person and relationship registry.
- Founding/migration, local economies, conserved route exchange/disruption, diplomacy, conflict/refugees, conquest, federation/fragmentation, abandonment, and territory/succession resolve in fixed bounded order from contextual utility; no player command names an outcome.
- Snapshot v6 round-trips canonically and migrates v5 to one provenance-labelled baseline without retroactive M6 history. Worker protocol v6 exposes bounded immutable projections and transferable tile ownership.
- React offers read-only keyboard-operable settlement/civilization/residency/route/diplomacy/conflict/ruin inspection; person names and stable IDs make migration facts cross-referenceable, and calm mode hides the panel.

## Active risks and blockers

- No read-only included-usage meter exists; do not use credits or an API key.
- GitHub private-plan branch protection returns HTTP 403; enforce independent review and green aggregate `Required` CI operationally before merge.
- Windows signing credentials are not established; the private unsigned-installer fallback remains unless existing credentials become available.
- The enjoyment/return-over-many-hours criterion remains release-blocking and must be reevaluated through M7-M10.

## Root rotation state

- This successor Sol/xhigh root reconstructed and accepted the shared checkout; its task is `INPROGRESS`, the prior task is `RETIRED`, and no second root may edit.
- Rotate after the reviewed M6 PR is merged and final main CI/documentation evidence is durable; persist exact Git/CI state and M7 next action first.

## Exact next action

Run the final diff and repository-state audit; commit the verified M6 feature checkpoint; push and open the private PR; require green aggregate `Required` CI; merge and verify final main CI; update this file with exact heads/runs and the M7 next action; then rotate roots.
