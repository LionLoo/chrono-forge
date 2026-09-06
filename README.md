# Chrono Forge

> Focus on your work while another world builds itself.

Chrono Forge is a local-first desktop focus timer and autonomous civilization simulator. A focus session advances a seeded world whose inhabitants independently survive, build, form societies, discover contextual technologies, respond to crises, and eventually reach other worlds. The player observes history and can make limited interventions; ordinary buildings, jobs, and research paths are not manually assigned.

## Status

Chrono Forge is under active v1.0 development. M0-M8 are merged, independently reviewed, and hosted-verified. The app now adds a rich source-gated visual world, eight factual overlays, typed optional inspection, calm and reduced-effects modes, accessible non-color cues, and durable factual focus recaps to autonomous settlements, persistent family life, contextual development, crises, trade, diplomacy, conflict, federation/fragmentation, ruins/history, and camera-independent population scale. M9-M12 and the private release remain blocking, so this is not yet the complete civilization game or a v1 release; M9 is the next active milestone. [PRODUCT_SPEC.md](PRODUCT_SPEC.md) is the authoritative v1 contract, [ROADMAP.md](ROADMAP.md) is its ordered milestone view, [PLAN.md](PLAN.md) is the decision-complete execution contract, and [PROGRESS.md](PROGRESS.md) is the durable status record.

The current app generates a coherent 96×64 seeded world in a dedicated module Worker, publishes bounded read-only settlement/society/relationship/development/civilizations projections as one full frame followed by ordered deltas, and prepares spatially indexed render descriptors for PixiJS so view-only changes inspect visible candidates rather than rescanning every entity. It exposes keyboard-operable pan, zoom, eight patterned overlays, typed map selection, focus controls, biographies, family and relationship details, cultures, timeline pages, development conditions, closed interventions, civilization/settlement/residency/trade/diplomacy/conflict/ruin inspection, structure details, local archives, calm mode, reduced effects, and accessible text scaling. Canonical v9 saves restore the exact authoritative world, sparse social graph, knowledge, crises, geopolitical state, protected named lives, bounded ordinary-population cohorts, revisioned path cache, RNG streams, and checkpoint-bound factual focus recaps; explicit v8/v7 and older migrations preserve valid saves without inventing history.

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
