# Contributing

## Working agreement

Start from `main`, create a narrowly named feature branch, and keep a substantive milestone behind one pull request. Do not merge failing work or weaken a valid test to make a gate pass. The implementer is not the sole reviewer; every milestone needs an independent review and fixes for all confirmed release-relevant findings.

## Setup

```powershell
npm ci
npm run tauri dev
```

## Validation commands

| Concern                   | Command                 |
| ------------------------- | ----------------------- |
| Complete local gate       | `npm run ci`            |
| Format                    | `npm run format:check`  |
| TypeScript lint           | `npm run lint:web`      |
| Rust lint                 | `npm run lint:rust`     |
| Type checking             | `npm run typecheck`     |
| Unit/integration coverage | `npm test`              |
| Rust tests                | `npm run test:rust`     |
| Web E2E and visual checks | `npm run test:e2e:web`  |
| Long simulation           | `npm run test:sim:long` |
| Benchmarks                | `npm run bench`         |
| Web production build      | `npm run build:web`     |
| Desktop installer         | `npm run build:desktop` |
| Combined CycloneDX SBOM   | `npm run generate:sbom` |

Run focused tests during implementation and `npm run ci` before each milestone commit. The complete gate includes web and Rust quality checks, unit/integration/invariant coverage, Chromium E2E, combined npm/Cargo SBOM generation, and the Windows desktop installer. UI, animation, desktop integration, and gameplay changes also require launching and interacting with the real application.

## Determinism rules

Authoritative simulation code must not read wall time, locale state, `Math.random`, DOM APIs, rendering state, or unordered asynchronous results. Use integer logical ticks, deterministic RNG streams, total ordering, canonical snapshots, and fixed operation quotas. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Pull requests

Every PR description must include observable behavior, acceptance criteria, tests run, visual evidence when applicable, performance impact, migration impact, and reviewer findings. CI must be green before merge. Only the project owner or an explicitly authorized root integrator merges.
