# Progress

Last updated: 2026-09-02

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; never stop at a prototype or partial roadmap.
- Current milestone: M8 simulation scale is active on `feature/simulation-scale`. The branch contains verified M7 documentation head `e4827ab1c629ef85121a60d9fb4a9eb994900439`, reviewed save-recovery mainline `8b9e6bb0e1dc36efe992f358ebc8c8273b1051e6` via merge `5f4e230`, foundation commit `33893416fb66d93182ec85703a1ba7e7246d2189`, and the exact integration checkpoint `b69234c8d0100defc89966d3d5928d82faabd58d`. M8 is not complete.
- Included usage: the read-only meter reports the included weekly window 100% used, resetting 2026-09-06 22:27:56 -04:00. One promotional reset is offered but is prohibited by the billing guardrail and was not redeemed. No API key, purchased credit, promotional credit, or account credit was used; work stops after this safe checkpoint.
- v1.0 completion: not satisfied. M8 integration and acceptance, M9-M12, and the private v1.0.0 release remain fully blocking.

## HARNESS EVALUATION

- Requirements completed versus remaining: M0-M7 remain merged and verified, and reviewed PR #11 preserves migrated saves plus map interaction. M8 now persists population-scale and path-cache authority in World/snapshot v8, migrates published v7 explicitly, sends Worker v7 full-frame then ordered deltas, reconstructs those deltas in the UI, and provides a deterministic cached-settlement advancement API. Live World adoption of that cache, scale-performance acceptance, full validation, review, PR/CI, and every M9-M12/release requirement remain blocking.
- Build/test/CI: the M8 integration checkpoint passes repository type checking, focused ESLint, Prettier, `git diff --check`, and 14 focused files/113 tests, including deterministic Worker/World, snapshot migration, scale conservation, cache, delta, long-world, UI reconstruction, and updated intentional canonical-history hashes. The last complete product gate remains M7: 50 files/327 covered tests, 7 files/17 long tests, Rust 20/20, browser E2E 4/4, native save/relaunch/resume E2E 1/1, and production web/desktop/NSIS builds. PR #11 CI `33687776785` and merged-main CI `33689312011` are green including aggregate `Required`; no M8 full gate or hosted CI claim exists.
- Known defects/debt: `stepWorld` still uses legacy direct settlement routing; the persisted cache is not yet the production path and terrain-revision invalidation is not wired. Nonempty population-scale work still needs release-profile batching/performance proof. M8 lacks benchmark/soak/payload/heap evidence, full gate, actual-app QA, independent checkpoint review, and PR/CI. Existing non-blocking debt is the 702 kB web-chunk warning, upstream embedded-Webdriver diagnostic, and absent Windows signing credentials.
- Major failures and recovery: reviewed PR #11 claimed snapshot v7 while M8 foundation had planned the same number; root merged the valid mainline without losing M8 and moved M8 authority to unambiguous snapshot v8 with explicit v7 migration. A Worker-delta Terra assignment then hit the included-plan limit after producing code; root inspected and validated the shared work, confirmed copied transfer buffers preserve the retained full frame, and committed the coherent integration without using credits.
- Review/subagent findings: bounded Terra/high work delivered World/scale/snapshot integration, deterministic settlement cache scheduling, and Worker/UI deltas. Two workers returned full green contracts; the delta worker was interrupted by the usage limit, so root performed its focused validation. No independent M8 checkpoint review was started after exhaustion; this is explicitly not M8 acceptance.
- Demonstrated scale/performance: unit evidence proves the 5,000-detailed/100,000-aggregate bounds, protected named/social records, exact population conservation, partition-equivalent scheduled work, bounded cache queues/eviction/invalidation, v8 persistence, and exact ordered full-frame reconstruction. No release-runner timing, heap, payload/application-budget, 500-application, or soak claim exists yet.
- Buildable/runnable: yes. The branch typechecks and its coherent integration passes focused tests; the actual app remains last fully validated at M7 plus reviewed PR #11 because M8 actual-app QA is pending.
- Fresh-root recoverability: yes. Repository docs identify the exact branch/commits, verified scope, validation evidence, usage stop, known incomplete production seams, and next action without conversation history.

## M8 integration checkpoint

- `PLAN.md` locks one reference runner/profile, deterministic `[8080,5000,100000,7]` scale evidence, conservation/reference invariants, snapshot v8/Worker v7 gates, cache behavior, delta reconstruction, payload/application budgets, and heap soak. Snapshot v8 supersedes the foundation's original v7 label because reviewed PR #11 established v7 before M8 integration.
- ADR-033 keeps M4.5-significant people detailed, aggregates only ordinary residents into bounded stable-ID cohorts, and requires camera-independent schedules, revisioned caches, and ordered base-checked Worker deltas.
- World authority now carries population-scale and path-cache state; canonical snapshot v8 round-trips both and explicitly migrates reviewed v7 plus the older chain. Named Society residents and M4.5 relationship/family references remain protected detailed records, while settlement totals are conserved across detailed residents and cohorts.
- Deterministic cached settlement advancement coalesces stable-ID requests, processes a fixed quota, records operations, and moves only on later cache hits. It remains an isolated production-ready API until `stepWorld` adopts it with terrain-revision invalidation.
- Worker v7 emits one full ready frame and then ordered base-tick-checked deltas with copied transferable buffers and payload accounting; the React hook reconstructs immutable frames and rejects stale deltas. Focused Worker, partition, long-world, and UI tests are green.

## Active risks and blockers

- Included weekly plan usage is 100% consumed; pause before more M8 work and never redeem the promotional reset or switch to credits/API access.
- The integration lacks independent review, full CI, live cached-routing adoption, actual-app QA, and release-scale evidence; it must not be merged or described as M8-complete.
- GitHub private-plan branch protection returns HTTP 403; later enforce independent review and green aggregate `Required` CI operationally before merge.
- Windows signing credentials are not established; the private unsigned-installer fallback remains unless existing credentials become available.

## Root rotation state

- This Sol/xhigh root reconstructed and accepted M8 ownership in task `INPROGRESS`; the prior task is `RETIRED`, and no second root may edit the checkout.
- The root is pausing at the billing-safe integration checkpoint rather than starting the remaining performance/cache work or rotating. Repository evidence, not chat history, remains authoritative when included allowance becomes available.

## Exact next action

When included weekly allowance is available, verify pushed checkpoint `b69234c8d0100defc89966d3d5928d82faabd58d` on `feature/simulation-scale`, adopt `advanceCivilizationWithPathCache` in `stepWorld` with deterministic terrain-revision invalidation, and optimize/prove bounded nonempty scale scheduling. Then complete the locked benchmark/soak/payload/heap evidence, persistence and partition tests, actual-app QA, full local gate, independent review and fixes, PR/green CI/merge, and durable handoff before M9; do not begin M9 early.
