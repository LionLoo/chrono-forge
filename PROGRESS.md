# Progress

Last updated: 2026-09-05

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; never stop at a prototype or partial roadmap.
- Current milestone: M8 implementation and local acceptance are complete on `feature/simulation-scale`, based on durable integration head `49dfe10f87a619a4a5c5404f77710126d2ddd432`. The reviewed feature checkpoint, private PR, hosted CI, and merge are next; M9 must not begin before that merge.
- Included usage: the read-only Plus meter reports 8% of the five-hour window and 56% of the included weekly window used (44% weekly remains). It reports no purchased credit balance. Two offered usage resets are prohibited by the billing guardrail and were not redeemed; no API key, purchased, promotional, reset, or account credit was used.
- v1.0 completion: not satisfied. M8 hosted integration, M9-M12, clean release verification, tag, artifact, checksums, and private GitHub release remain fully blocking.

## HARNESS EVALUATION

- Requirements completed versus remaining: M0-M7 remain merged and hosted-verified. M8 now has live camera-independent scale authority, exact conservation and protected M4.5 lives, bounded/fair cohort LOD, production cached routing, snapshot v9 with explicit v8/v7 migration, Worker v7 ordered deltas, and locked scale/delta/soak evidence. M8 PR/CI/merge and all M9-M12 requirements remain.
- Build/test/CI: final-tree local evidence passes formatting, zero-warning lint, type checking, 55 covered files/384 tests (88.26% statements, 80.33% branches, 94.65% functions, 90.00% lines), the complete 9-file/22-test long catalogue, Rust 20/20, browser E2E 4/4, native SQLite save/relaunch/resume E2E 1/1, SBOM generation, production web/desktop/NSIS builds, and production test-code exclusion. Hosted M8 CI is pending.
- Known defects/debt: no confirmed M8 correctness or acceptance defect remains. Non-blocking debt is the roughly 738 kB web-chunk warning, an upstream embedded-WebDriver cleanup diagnostic after its passing spec, and absent Windows signing credentials; release remains private/unsigned unless existing signing credentials are established by M11/M12.
- Major failures and autonomous recovery: exact-current review found v8 aggregate migration rejection, cadence-coupled promotion starvation, synthetic production scale evidence, weak anonymous provenance, an unbounded pending path queue, and a hierarchical-overhead route failure. Root implemented one-way v8 normalization, a persisted fair cursor, real World-side 100,000-person evidence, strict cross-authority checks, 1,000-person cohorts, a 128-request queue, and a next-tick direct fallback that preserves reachability and same-tick partition equivalence. A first immediate-fallback repair caused covered-suite timeouts; root replaced it with persisted staged work and an allocation-light exact coarse route. Accumulated V8 coverage instrumentation still pushed nine unchanged heavy functional checks past wall-clock-only cutoffs, so the harness added bounded functional timeout headroom while retaining every scenario count, assertion, hash, coverage threshold, and dedicated M8 performance budget. The final full long run then exposed a real cache regression: two one-million-tick worlds exceeded their unchanged 30-second case limits and the M8 tree took about 96 seconds versus the M7 baseline's 51 seconds. Profiling isolated repeated full-cache validation and resorting inside each agent request; constant-cost transition guards plus no-copy canonical fast paths restored the four-case file to about 64 seconds without changing any timeout or outcome. Combined-load LOD p95 initially missed by 0.46 ms; removing redundant internal full-state scans reduced p95 to 17.06 ms without changing hash or operations. One M4 recovery hash changed only because v9 persists the new cursor; every semantic/operation assertion passed before the golden was renewed. Native app-data and NSIS network sandbox failures were rerun successfully outside the restricted boundary.
- Review/subagent findings: Terra/high reviews reported migration, fairness, production-evidence, provenance, pending-bound, reachable-routing, and same-tick partition findings. All received focused fixes and regression tests. The final cache hot-path review found no correctness issue; its sole P2 was Prettier formatting in `DECISIONS.md`, which root fixed before rerunning the green formatting gate. Reviewers modified no files and did not merge.
- Demonstrated scale/performance: real World surplus creates exactly 100 cohorts of 1,000 for 100,000 ordinary residents. Across 200 measured LOD pulses every cohort promoted at least two distinct residents; local Node 24 evidence recorded 12.25 ms median, 17.06 ms p95, 18.84 ms p99, about 210 MiB peak heap, hash `51b4a67a`, and 85,576 operations. The 5,000-detail plus 100,000-aggregate run recorded about 547 ticks/s, 2.24 ms p95 per ten-tick batch, bounded 5,100 backlog, and hash `bbb077e3`; the 10,000-tick soak retained hash `1d67d8e6` with 844,160 operations. The final microbenchmark measured 28.91 ms mean per ten ticks and 20.49 ms mean production LOD reconciliation after the full long run; absolute acceptance remains owned by the stable warmed long evidence above. The 500-application delta test reconstructed exact full frames with a 169,191-byte maximum payload and 0.37 ms p95 application time.
- Buildable/runnable: yes. Browser QA exercised overlays, non-color cues, person/family/timeline inspection, and factual focus start/cancel recaps. The native app launches and the automated installed-shell path passes real SQLite persistence; this desktop environment does not expose native windows to CUA, so native visual automation remains an environment limitation rather than a product failure.
- Fresh-root recoverability: yes. The repository records the current branch/base, implementation, acceptance evidence, resolved failures, remaining release work, allowance state, and exact next action without requiring prior chat.

## M8 verified scope

- `PopulationScaleState` owns protected detailed lives plus stable-ID ordinary residents in at most 1,000-person cohorts. Fixed quotas, oldest-due scheduling, persisted member cursors, bounded deltas/backlog, active-settlement provenance, and a non-reusing allocator make LOD deterministic and camera-independent.
- Settlement population remains authoritative: its surplus over named residents materializes into bounded anonymous cohorts, decreases remove only anonymous residents, and save/load/partition tests conserve population and totals. Valid v8 household/oversized cohorts migrate to v9 by remapping ordinary IDs, splitting with exact totals, and adding no factual history.
- Live settlement pulses use a persisted revisioned hierarchical path cache. A guarded corridor gets one fixed tile-search quota; an incomplete restricted corridor persists its exact work and becomes eligible for one full-quota direct fallback on the next logical tick. The derived two-stage bound preserves direct reachability without doubling expensive tile work inside one pulse, and eligible-work selection keeps same-tick partitions identical. Changed terrain invalidates affected paths. Completed and pending collections each cap at 128; repeats coalesce and saturated unique demand retries after fixed 32-request work drains the oldest queue.
- Worker v7 emits one full ready frame then base-tick-checked layer deltas. An independent authoritative expected sequence validates 500 applications, stale/base mismatch rejection, exact buffer/metadata payload accounting, and full-projection reconstruction.

## Validation evidence

- Focused final review gate: 4 files/56 tests; `npm run typecheck`; ESLint; Prettier; `git diff --check` — green.
- Covered suite: 55 files/384 tests; 88.26% statements, 80.33% branches, 94.65% functions, 90.00% lines — green on the final executable tree.
- Complete long catalogue: 9 files/22 tests green in 1,319.65 seconds. Before the cache hot-path repair, two million-tick cases reached unchanged 30-second wall-clock limits with no assertion failure; the exact repaired settlement file is 4/4 green in 64.33 seconds with every per-case timeout unchanged.
- Rust: 20/20. Browser E2E: 4/4. Native E2E: 1/1 after the required Windows app-data boundary was available.
- SBOM: `release-artifacts/chrono-forge.cdx.json`, 770 npm and 281 Cargo components.
- Production: web and Tauri release builds plus unsigned x64 NSIS installer succeeded; verifier found no WDIO bridge, capability, or global Tauri API in the production artifact.
- Independent exact-current review: cache hot-path repair clean for correctness and deterministic boundary safety; the sole formatting P2 was fixed and its exact gate rerun green.

## Active risks and blockers

- No external blocker prevents M8 integration. The private-repository plan cannot enforce branch protection (HTTP 403), so root must continue enforcing independent review plus green aggregate `Required` CI before merge.
- M9-M12 remain release-blocking. M8 scale proof is not evidence that planetary/space systems, content balance, installed release-candidate QA, or the private v1.0.0 release are complete.
- Windows signing credentials are not established. Do not invent, purchase, or expose credentials; use the documented private unsigned fallback unless authorized credentials already exist by release time.

## Root rotation state

- This Sol/xhigh root owns task `INPROGRESS`; prior roots are retired and no second root may edit this checkout.
- Repository state remains authoritative. Rotate only after the durable M8 merge/main-CI checkpoint, then mark this task `RETIRED` after the successor reconstructs state and accepts ownership.

## Exact next action

Commit the verified M8 feature and durable documents using exact path staging, push `feature/simulation-scale`, open/update its private PR, wait for green aggregate `Required` CI, fix any hosted-only failure, and merge only after the clean independent review remains applicable. Then update/verify `main`, record exact PR/merge/CI evidence, check included usage before M9, and rotate to a fresh Sol/xhigh `INPROGRESS` root whose first action is to lock and implement M9 planetary civilization and space-age acceptance without reducing any v1 criterion.
