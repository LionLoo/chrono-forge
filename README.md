# Chrono Forge

> Focus on your work while another world builds itself.

Chrono Forge is a local-first desktop focus timer and autonomous civilization simulator. A focus session advances a seeded world whose inhabitants independently survive, build, form societies, discover contextual technologies, respond to crises, and eventually reach other worlds. The player observes history and can make limited interventions; ordinary buildings, jobs, and research paths are not manually assigned.

## Status

Chrono Forge is under active v1.0 development. M0-M4.5 are merged, independently reviewed, and acceptance-complete. The app now follows typed friendships, rivalries, mentorships, partnerships, estrangement/reconciliation and widowhood over time; maintains evolving family bonds and dynamic household histories; grounds child arrival in recorded cultural and relationship evidence; applies bonds to person-level choices; and provides optional family, relationship, and shared-event inspection. M5-M12 remain release-blocking, so this is not yet the complete civilization game or a v1 release. [PRODUCT_SPEC.md](PRODUCT_SPEC.md) is the authoritative v1 contract, [ROADMAP.md](ROADMAP.md) is its ordered milestone view, [PLAN.md](PLAN.md) is the decision-complete execution contract, and [PROGRESS.md](PROGRESS.md) is the durable status record.

The current app generates a coherent 96×64 seeded world in a dedicated module Worker, publishes bounded read-only settlement/society/relationship projections, renders terrain/resources/habitability/hazards and visible settlement activity through PixiJS, and exposes keyboard-operable pan, zoom, overlays, focus controls, biographies, family and relationship details, cultures, timeline pages, structure details, and local archives. Canonical v4 saves restore the exact authoritative civilization and sparse social graph; v3 relationship migration is conservative and invents no past social meaning, while older terrain-only saves still receive a factual constant-time founding migration.

## Supported release target

The first signed-off v1.0 artifact targets Windows 10/11 x64 using Tauri and WebView2. The TypeScript frontend and simulation architecture remain portable to macOS and Linux, but those platforms are not claimed as supported until their native packaging and QA gates pass.

## Stack

- React 19.2 for accessible application UI
- PixiJS 8.19 for the animated 2D world
- A pure TypeScript deterministic simulation in a dedicated Web Worker
- Tauri 2.11 and Rust for the desktop shell, SQLite persistence, notifications, and packaging
- Vitest, fast-check, Playwright, and an isolated feature-gated WebdriverIO/Tauri native persistence smoke

Exact versions are pinned in the npm and Cargo lockfiles. Major choices and their evidence are recorded in [DECISIONS.md](DECISIONS.md).

## Local development

Prerequisites:

- Node.js 24 LTS (the repository pin is in `.nvmrc`)
- Rust from `rust-toolchain.toml`
- On Windows, Visual Studio 2022 Build Tools with Desktop development with C++ and WebView2 Evergreen Runtime

```powershell
npm ci
npm run dev
```

Run the native shell:

```powershell
npm run tauri dev
```

Run the main local gate:

```powershell
npm run ci
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full command map.

## Privacy

Core gameplay requires no account and no online service. Worlds, focus history, settings, and generated history remain in the local application data directory. Import/export is explicit. The private GitHub repository and development tooling are not runtime dependencies.

## License

Project code is MIT licensed. Third-party software and all visual/audio assets are inventoried in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); generated release bundles will include machine-generated license notices and an SBOM.
