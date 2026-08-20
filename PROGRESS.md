# Progress

Last updated: 2026-08-20

## Release state

- Goal: complete the private Chrono Forge v1.0.0 release.
- Current milestone: M1 deterministic world and simulation kernel is complete; M2 focus loop and durable saves is next.
- Current branch: `main` at M1 squash merge `f3560fc`.
- Remote: `https://github.com/LionLoo/chrono-forge` is private; pull request #2 delivered M1.
- Included-usage meter: no read-only ChatGPT/Codex weekly-allowance value is exposed in this harness. Work uses the included plan path only; no API key or purchased, promotional, or account credit is used.
- v1.0 completion: not yet satisfied.

## Completed in this checkpoint

- Added a golden-vector-tested xoshiro128** random generator with independently derived deterministic streams.
- Added the 96x64 chunked dense-array world model, coherent integer-only terrain and climate generation, resources, habitat and hazard fields, plants and animals, a guaranteed connected sanctuary, and a factual initial event.
- Added canonical state hashing, a deterministic spatial grid, and quota-based four-neighbor A* with total tie-breaking.
- Added a versioned, validated module-worker protocol and copied transferable world-frame projections so the UI cannot mutate or detach authoritative state.
- Added the PixiJS world canvas, deterministic palette and overlays, camera pan and zoom, seed and hash evidence, and an accessible React world-lab interface.
- Preserved Tauri's strict CSP with PixiJS's static shader fallback; no `unsafe-eval` policy relaxation was introduced.
- Replaced the placeholder long test with multi-seed million-tick world and worker checkpoints.
- Fixed independent-review findings for A* optimality and malformed worker-message handling, and added regression coverage.
- Added repository-owned LF normalization for reproducible Windows formatting checks.

## Validation evidence

- `npm run ci`: passed the complete local gate, including formatting, linting, strict type checking, covered tests, Rust tests, production browser E2E, SBOM generation, and the optimized desktop/NSIS build.
- `npm run ci:web`: passed; 19 Vitest files and 62 tests passed with 92.31% statements, 81.40% branches, 95.68% functions, and 92.14% lines.
- `npm run test:e2e:web`: passed in production Chromium with the real module worker and Pixi renderer.
- `npm run test:sim:long`: passed; two files and three long-run tests.
- `npm run test:rust`: passed; one Rust test.
- `npm run lint:rust` and `npm run format:check:rust`: passed.
- `npm run generate:sbom`: passed with 334 npm and 257 Cargo components.
- `npm run build:desktop`: passed and produced `chrono-forge.exe` plus `Chrono Forge_0.1.0_x64-setup.exe`.
- Native WebView2 inspection: title and canvas rendered, the resource overlay was readable, tick reached 100, and worker/main hashes both equaled `e2edd0cb`.
- Independent M1 closure review: no release-relevant finding remains.
- Hosted pull request #2 CI run `32344501724`: web quality/tests/E2E passed in 1m41s, Windows native tests/installer passed in 11m18s, and aggregate `Required` passed in 3s.
- Pull request #2 was squash-merged to `main` as `f3560fc2e8afb6c4039e230a2774da9a4a50370a`.
- M0 post-documentation `main` CI run `32317917110`: passed.

## Active risks and blockers

- GitHub returned HTTP 403 for private-repository branch protection because the account plan lacks that feature. Operational policy remains pull request plus green `Required` CI before merge.
- Windows signing credentials are not established; the private unsigned-installer fallback remains documented for release if no existing credential is available.
- Remaining included weekly usage is not readable through the available tools.
- WebdriverIO desktop E2E remains deferred to M2 for the required dependency/security re-audit.

## Exact next action

Commit and push this merged-M1 status checkpoint, verify its hosted `main` CI, check again for an exposed included-usage meter, then create `feature/focus-and-persistence` and lock the M2 implementation slices and acceptance evidence before editing.
