# Chrono Forge agent guide

## Mission and source of truth

Deliver the complete v1.0 contract. Read `PROGRESS.md`, `PLAN.md`, `ARCHITECTURE.md`, and affected tests before editing. `PLAN.md` is ordered and release-blocking; do not move an explicit v1 requirement to `ROADMAP.md`. Keep `PROGRESS.md` concise and current after every checkpoint.

## Architecture invariants

- `src/simulation` is authoritative pure TypeScript: no React, Pixi, Tauri, DOM, wall clock, locale ordering, `Math.random`, or unordered async results.
- Advance state with integer fixed ticks, explicit system order, deterministic RNG streams, total tie-breakers, fixed work quotas, canonical snapshots, and stable IDs.
- The simulation Worker owns mutable world state. React and Pixi consume read-only typed projections.
- Camera state may change rendering detail, never authoritative simulation LOD or outcomes.
- Rust owns native capabilities and SQLite behind narrow typed commands. Do not expose general SQL or broad filesystem permissions to the WebView.
- Recaps and biographies may summarize only actual referenced simulation events.

## Workflow

For each milestone: lock observable acceptance criteria; add failing tests where reasonable; implement the smallest coherent vertical slice; run focused checks; run the complete applicable gate; launch and inspect the actual app for UI/gameplay changes; use deterministic accelerated worlds for long-horizon behavior; obtain independent review; fix all confirmed correctness, regression, performance, accessibility, and coverage findings; rerun; then commit, push, open/update one PR, wait for green CI, and merge sequentially.

The primary orchestrator is GPT-5.6 Sol at xhigh reasoning and retains architecture, product decisions, integration, milestone selection, final review, and the v1.0 completion decision. Use subagents only for one bounded independent exploration, implementation, testing, documentation, browser QA, or review assignment. Every spawn must explicitly select `gpt-5.6-terra` with high reasoning; do not rely only on inheritance. Do not let parallel agents edit the same files. An implementer is never the only reviewer of its own work. Workers and reviewers never merge PRs. The user has authorized the Sol root integrator to create the private repository, push branches, open PRs, merge them after independent review and green CI, manage tags, and publish the private release.

Every worker return must include: a concise summary; files created or modified; validation commands executed; exact results; and remaining risks, uncertainties, or follow-up work. Workers do not make independent product or architecture decisions and must escalate them to Sol.

Use only included ChatGPT/Codex plan allowance. Never use an API key, purchased credits, promotional credits, or the owner's credit balance. Before a new milestone, check remaining included usage when a read-only meter is available. If included weekly usage is exhausted or nearly exhausted, finish only the current safe checkpoint, update `PROGRESS.md`, commit valid verified work, and pause before the next milestone.

## Harness evaluation

At every major checkpoint, keep a concise `HARNESS EVALUATION` section in `PROGRESS.md` that records requirements verified versus remaining, build/test/CI state, known defects and technical debt, significant failures and autonomous recovery, review/subagent findings, demonstrated scale/performance, and whether the repository is buildable and runnable. This is evidence and handoff context; it never replaces or weakens product acceptance criteria.

A checkpoint is not durable until a fresh Sol root agent, given only the repository and its durable documents, can identify the completed work, current branch/milestone, exact validation evidence, unresolved risks, and correct next action without conversation history.

## Autonomous root rotation

Treat root chat context as disposable and repository state as authoritative. After a major checkpoint, after context compaction, or when root context is large or stale, finish the current coherent checkpoint; validate it; update `PROGRESS.md`, affected plans/decisions, exact branch/HEAD and CI state, blockers, and exact next task; verify the repository-only handoff; and commit valid checkpoint work before rotating.

Create a same-directory peer task for this saved Chrono Forge checkout when the desktop task API supports it, then explicitly set GPT-5.6 Sol with xhigh reasoning. Transfer the unchanged original Chrono Forge goal, harness, full v1 requirements and completion contract, authority, workflows, stop conditions, billing guardrail, and root responsibilities. The successor must ignore prior chat as authority, reconstruct and verify state from durable documents plus Git/GitHub/CI, state the exact next task, and affirm root ownership before editing. Once that acknowledgement is received, the prior root stops all project work. Never run two root controllers against the shared checkout concurrently.

If true same-project root creation or ownership transfer is unavailable, record the limitation in `PROGRESS.md` and perform a logical repo-based reset: discard chat-derived assumptions, reread every source-of-truth document, recheck Git/GitHub/CI and validation evidence, and continue only from the persisted exact next task.

## Commands

- Install: `npm ci`
- Dev: `npm run dev` or `npm run tauri dev`
- Full local gate: `npm run ci`
- Web E2E: `npm run test:e2e:web`
- Long simulation: `npm run test:sim:long`
- Benchmark: `npm run bench`
- Release build: `npm run build:desktop`

Do not weaken a legitimate test. Change a test only when its expectation is demonstrably wrong or the specification intentionally changed, and document why. At every milestone end: run required validation; obtain independent review; fix findings; update affected persistent-memory documents and the exact next action in `PROGRESS.md`; commit the verified checkpoint; then continue unless blocked, allowance-guarded, or v1 is fully satisfied. Stage only checkpoint-owned paths; never use broad `git add .`/`-A`.

## Code review rules

- Flag any path that makes identical inputs produce different authoritative state.
- Flag impossible resources/ownership/references, dead-agent actions, invalid placement, non-finite state, or recaps without source events.
- Flag UI state that bypasses the worker and mutates world authority.
- Flag persistence that can overwrite the last valid generation or corrupt a save during interruption.
- Flag camera-dependent history, unbounded offline/accelerated loops, or performance work measured by elapsed milliseconds inside the kernel.
- Flag inaccessible primary controls, motion that ignores reduced-motion settings, and information conveyed by color alone.
