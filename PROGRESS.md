# Progress

Last updated: 2026-08-20

## Release state

- Goal: build, verify, package, and privately release the complete Chrono Forge v1.0.0 contract; do not stop at a prototype or partial roadmap.
- Current milestone: M2 focus loop and durable saves is in progress after a verified core checkpoint.
- Current branch: `feature/focus-and-persistence`.
- Verified M2 core commit: `6f4f33c` (`feat: establish M2 focus and persistence core`), based on M1 `main` checkpoint `5cf8e3b`.
- Remote: `https://github.com/LionLoo/chrono-forge` is private. The M2 branch/core checkpoint is local and not yet pushed; M2 has no pull request yet.
- Included-usage meter: no read-only ChatGPT/Codex weekly-allowance value is exposed. Work uses only the included plan path; no API key, purchased/promotional credit, or account credit is used.
- v1.0 completion: not satisfied. M2 UI/native E2E and M3-M12 remain release-blocking.

## HARNESS EVALUATION

- Requirements verified versus remaining: M0 repository/CI/desktop foundation and M1 deterministic world/worker/Pixi slice are merged. M2 now has a versioned explicit-time focus domain, controlled-clock recovery, exact integer focus-to-simulation accounting, canonical snapshot v0→v1 migration, bounded logged offline catch-up, typed WebView persistence gateway, immutable SQLite generations, semantic fallback, import/export, typed settings, and focus-history integrity. Accessible focus/save/history/settings UI, autosave orchestration, notifications/sound, and native desktop E2E remain in M2; M3-M12 remain untouched.
- Build/test/CI: M2 core full local `npm run ci` passed after the pinned NSIS download was retried with authorized network access. It includes formatting, lint, typecheck, 98 covered tests, 14 Rust tests, production Chromium E2E, SBOM, optimized executable, and NSIS installer. Hosted CI is still the last green M1 `main` run `32345659299`; M2 is not pushed.
- Known defects/debt: no open P0/P1 in the M2 core review. P2 defense-in-depth remains: Rust cross-checks serialized timer summary fields while exhaustive timer-state invariants are enforced by TypeScript `rehydrateFocusState` on the production IPC path. WebdriverIO desktop E2E dependencies/configuration are still pending the M2 audit. Branch protection is unavailable on the private-repository plan; Windows signing is not configured.
- Major failures and autonomous recovery: weighted A*, malformed Worker input, weak long-run coverage, Pixi strict-CSP startup, and Windows index-stat noise were fixed in M1. In M2, coverage initially fell below its 80% branch gate and was restored with boundary/recovery tests. Independent review found four P1 integrity gaps (semantic save fallback, speculative mirror divergence, stale recap events, and syntax-only focus recovery) plus a UTF-8 size defect; all were fixed and re-reviewed. The first desktop build was sandbox-blocked downloading pinned NSIS (`os error 10013`); the authorized retry completed the installer. A sandbox Git dubious-ownership failure staged nothing; repository-scoped `safe.directory` completed the named-path commit.
- Review/subagent findings: bounded Terra/high workers implemented the pure focus domain and Rust persistence, and a third built the typed frontend gateway. Independent Terra closure review reports no new P0/P1 and confirms every prior P1/P2 finding closed on the production path; its only residual is the native timer-validation defense-in-depth item above.
- Demonstrated scale/performance: deterministic 96×64 worlds and Worker checkpoints still pass three-seed one-million-tick tests. M8 target-scale population and latency budgets are not yet implemented or demonstrated.
- Buildable/runnable: this checkpoint builds the production web bundle, `chrono-forge.exe`, and `Chrono Forge_0.1.0_x64-setup.exe`; production browser E2E passes. The current visible app remains the verified M1 world lab until the next M2 UI slice is integrated.
- Fresh-root recoverability: a new Sol root must read `AGENTS.md`, `PRODUCT_SPEC.md`, `PLAN.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `README.md`, and this file; verify branch/HEAD/status plus remote CI; then continue only from the exact task below. Conversation history is neither required nor authoritative.

## M2 core checkpoint

- Added the explicit-time focus state machine with custom durations, optional breaks, pause/resume/complete/cancel, backward-clock safety, sleep-sized recovery, partition invariance, exact tick remainder, strict state rehydration, and property tests.
- Added canonical world snapshot envelopes, a checked-in v0 migration fixture, exact schema/range/reference validation, future-version rejection, UTF-8 byte limits, load/save Worker requests, and bounded deterministic offline catch-up with factual events.
- Extended the React Worker hook with Promise-based save/load/offline operations, confirmed-versus-projected mirror state, fault rollback, authoritative event replacement on load, and stale-event/fault regressions.
- Added bundled SQLite persistence in Rust with WAL/FULL/foreign keys/busy timeout, schema migration, multiple slots, immutable SHA-256 generations, atomic verified head updates, retained fallback generations, import/export, focus history, and typed settings.
- Recovery is two-stage: Rust returns checksum-verified candidates head-first/newest-first; TypeScript accepts only a canonically migrated semantic world and exports that exact generation. Corrupt evidence is not deleted.
- Added strict Tauri result validation and a clearly non-durable in-memory browser/test gateway. Focus summaries must match canonical rehydrated timer state, and recap IDs must exist in the authoritative source world.
- Added the permanent HARNESS EVALUATION and AUTONOMOUS ROOT ROTATION protocols without changing any v1.0 acceptance criterion.

## Validation evidence

- `npm run ci`: passed through format, ESLint, strict TypeScript, covered Vitest, Rust, production Playwright, SBOM, and desktop packaging; the NSIS packaging substep succeeded on its authorized retry.
- Vitest coverage: 25 files / 98 tests; 90.23% statements, 80.03% branches, 97.45% functions, 90.84% lines.
- `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`: 14 passed, 0 failed.
- Rust format and Clippy with `-D warnings`: passed.
- Production browser E2E: 1 passed with the real module Worker and Pixi renderer.
- Determinism/property/long suites: passed; the long suite retains multi-seed one-million-tick world/Worker coverage.
- SBOM: generated with 334 npm and 271 Cargo components.
- Desktop build: produced `src-tauri/target/release/chrono-forge.exe` and `src-tauri/target/release/bundle/nsis/Chrono Forge_0.1.0_x64-setup.exe`.
- Independent closure review: no unresolved P0/P1; prior integrity findings closed with regressions.
- Hosted M1 evidence: PR #2 run `32344501724` and post-checkpoint `main` run `32345659299` passed; M1 squash merge is `f3560fc2e8afb6c4039e230a2774da9a4a50370a`.

## Active risks and blockers

- No genuine external blocker. Remaining included weekly usage is not readable through available tools.
- GitHub private-repository branch protection returned HTTP 403 on the current account plan; operational policy remains independent review plus green `Required` CI before merge.
- Windows signing credentials are not established; the documented private unsigned-installer fallback remains unless existing credentials become available.
- Full native WebdriverIO flow and actual M2 focus/save UI have not been implemented, so M2 is not acceptance-complete and must not be pushed/merged yet.

## Root rotation state

- Desktop tooling exposes a same-directory task fork, so same-project Sol-root continuation is supported. The rotating root must create a peer task in this exact checkout, explicitly continue with `gpt-5.6-sol` at xhigh, and send the unchanged original goal/contract/authority plus the repository-only reconstruction requirement.
- The successor must verify `feature/focus-and-persistence`, core commit `6f4f33c`, the documentation checkpoint at HEAD, working-tree cleanliness, remote M1 CI, and this exact next task before affirming ownership. Once affirmed, the prior root stops project work.

## Exact next action

On `feature/focus-and-persistence`, wire the production Tauri gateway (with the in-memory browser fallback) and explicit-time focus controller into `App`: create/load an initial slot, autosave/manual save, load/import/export, presets/custom duration, start/pause/resume/complete/cancel/optional break, calm mode, settings, factual recap/history/statistics, and sleep/visibility recovery. Add controlled-clock integration/UI tests. Then audit/install isolated WebdriverIO Tauri E2E dependencies, prove the production binary excludes test plugins, implement the required native start-pause-resume-save-exit-reload-complete flow, visually inspect the native app, run the full M2 gate, obtain independent review, fix findings, update durable evidence, and finish the private PR/green-CI merge.
