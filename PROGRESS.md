# Progress

Last updated: 2026-09-02

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; never stop at a prototype or partial roadmap.
- Current milestone: M8 simulation scale is active on `feature/simulation-scale`, based on verified M7 documentation head `e4827ab1c629ef85121a60d9fb4a9eb994900439`; the exact foundation commit is `33893416fb66d93182ec85703a1ba7e7246d2189`. This checkpoint locks M8 evidence and adds isolated scale, path-cache, and Worker-delta foundations; it does not complete M8.
- Included usage: no read-only weekly allowance meter is exposed. A required Terra/high worker then received an included-plan usage-limit response with a 10:24 PM retry time. No API key, purchased credit, promotional credit, or account credit was used; work stops at this safe checkpoint.
- v1.0 completion: not satisfied. M8 integration and acceptance, M9-M12, and the private v1.0.0 release remain fully blocking.

## HARNESS EVALUATION

- Requirements completed versus remaining: M0-M7 remain merged and verified. M8 now has locked deterministic scale/performance evidence plus standalone primitives for protected detail/aggregation, fixed scheduling, revisioned path caching, and ordered projection deltas. These primitives are not yet connected to world authority, persistence, the Worker, or UI; all remaining M8-M12 and release requirements remain blocking.
- Build/test/CI: current foundation files pass repository type checking, focused ESLint, Prettier, and 3 files/20 tests. `git diff --check` passes. The last complete app gate remains the unchanged M7 gate: 50 files/327 covered tests, 7 files/17 long tests, Rust 20/20, browser E2E 4/4, native save/relaunch/resume E2E 1/1, production web/desktop/NSIS builds, PR CI `33532349145`, merge-main CI `33534175572`, and final documentation CI `33561075915`, all green including aggregate `Required`.
- Known defects/debt: no defect is known in the isolated foundations after focused validation, but they have no production integration, snapshot migration, app QA, benchmark/soak evidence, or independent checkpoint review. Production remains Worker/snapshot v6. Existing non-blocking debt is the 702 kB web-chunk warning, upstream embedded-Webdriver diagnostic, and absent Windows signing credentials.
- Major failures and recovery: the path-cache worker was interrupted by the included-plan usage limit after producing valid source/tests, leaving one TypeScript inference failure and a lint cascade. Root preserved the work, repaired the single runtime-array guard cause, and reran the focused gate green without using credits. No broader integration began after the guardrail triggered.
- Review/subagent findings: three bounded Terra/high implementation assignments produced frame-delta, scale-authority, and path-cache foundations. Frame-delta and scale workers returned green results; path-cache was interrupted as described above. No independent final review was started after allowance exhaustion, so this is explicitly not an M8 acceptance checkpoint.
- Demonstrated scale/performance: unit evidence proves bounded 5,000-detailed/100,000-aggregate constants, protected-record rejection, deterministic aggregate/deaggregate conservation, partition-equivalent scheduled work, bounded cache queues/eviction/invalidation, and exact full-frame reconstruction by ordered deltas. No release-profile timing, heap, payload, 500-application, or soak claim exists yet.
- Buildable/runnable: yes at the previously verified M7 product. This branch typechecks and its isolated foundations pass focused tests; because they are deliberately unintegrated, the runnable app remains behaviorally M7 until M8 resumes.
- Fresh-root recoverability: yes. Repository docs identify the verified base, active branch, safe foundation scope, exact validation, usage-limit stop, unverified work still required, and exact resume action without conversation history.

## M8 foundation checkpoint

- `PLAN.md` locks one reference runner/profile, deterministic `[8080,5000,100000,7]` scale evidence, conservation/reference invariants, snapshot/Worker v7 gates, cache behavior, delta reconstruction, payload/application budgets, and heap soak.
- ADR-033 keeps M4.5-significant people detailed, aggregates only ordinary residents into bounded stable-ID cohorts, and requires camera-independent schedules, revisioned caches, and ordered base-checked Worker deltas.
- Pure scale authority models protected detailed residents, conserved cohorts, stable deaggregation, fixed work quotas/backlog, canonical DTOs, and invariants. Pure path-cache authority models stable requests, bounded deterministic processing/eviction, terrain invalidation, hierarchical routes, and flow directions.
- Frame-delta protocol creates/applies immutable typed-layer changes, rejects base mismatches, enumerates transfer buffers, and accounts payload bytes. Production integration is intentionally deferred.

## Active risks and blockers

- Included plan usage is exhausted or nearly exhausted; pause before more M8 work and never switch to credits or an API key.
- The foundation lacks independent review, full CI, live integration, persistence migration, actual-app QA, and release-scale evidence; it must not be merged or described as M8-complete.
- GitHub private-plan branch protection returns HTTP 403; later enforce independent review and green aggregate `Required` CI operationally before merge.
- Windows signing credentials are not established; the private unsigned-installer fallback remains unless existing credentials become available.

## Root rotation state

- This Sol/xhigh root reconstructed and accepted M8 ownership in task `INPROGRESS`; the prior task is `RETIRED`, and no second root may edit the checkout.
- The root is pausing at the billing-safe foundation checkpoint rather than rotating or starting integration. Repository evidence, not chat history, remains authoritative when included allowance becomes available.

## Exact next action

When included plan allowance is available, recheck for a read-only meter, verify the clean pushed `feature/simulation-scale` checkpoint and focused gate, then resume M8 by integrating the foundations into world authority and canonical snapshot v7 with v6 migration, live deterministic cache scheduling, and Worker v7 full-frame/delta reconstruction. Complete the locked benchmark/soak/payload/heap evidence, persistence and partition tests, actual-app QA, full local gate, independent review and fixes, PR/green CI/merge, and durable handoff before M9; do not begin M9 early.
