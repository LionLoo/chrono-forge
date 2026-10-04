# M10.65 long-session performance, power, and responsiveness evidence

## Locked contract

- Branch: `release/v1-long-session-performance` from exact merged and merge-head-green M10.6 main `7ccdad20e38bb038b4091b35b35d87bddae2e090`.
- Measure real browser and installed Windows desktop behavior across representative founding and large worlds, normal accepted focus, controlled multi-hour focus, paused/idle, reduced effects, save/reload, growing factual history, and a controlled session end.
- Separate deterministic activity counts and fixed-tick fixtures from machine-specific elapsed time, process memory, power, fan, and thermal observations. Wall time, hardware, camera, rendering detail, and measurement results never enter simulation authority or alter outcomes.
- Retain the architecture budgets: 5,000 detailed plus 100,000 aggregate residents at 10 ticks/second; p95 tick below 50 ms and p99 below 100 ms; frame-delta application p95 below 8 ms; payload below 4 MiB; JavaScript heap below 512 MiB; a 50 MiB save committed below one second and loaded/validated below two seconds on the documented reference machine.
- Acceptance additionally requires no avoidable paused/idle Worker or render churn, bounded long-session memory without a monotonic leak, responsive primary controls and timely frames, stable browser and installed-desktop sessions, independent review, the complete local gate, exact-head hosted CI, sequential merge, and exact merge-head CI.

## Reference profiles

### Windows reference machine

- Microsoft Windows 11 Home 10.0.26200, build 26200.
- Intel Core i7-13700H, 14 cores and 20 logical processors.
- 34,070,388,736 physical bytes (31.73 GiB).
- NVIDIA GeForce RTX 4060 Laptop GPU, driver 32.0.15.9621; Intel Iris Xe Graphics, driver 31.0.101.5333.
- Node 24.10.0, npm 11.6.1, Rust 1.97.1.
- Machine-specific power, fan, temperature, process-family working set, and elapsed-time observations are evidence for this profile only. They are never deterministic pass inputs inside `src/simulation`.

### Browser reference

- Playwright 1.62.1 bundled Chromium 151.0.7922.34 using the pinned `Desktop Chrome` profile: 1280×720 viewport, 1920×1080 screen, device scale factor 1, desktop pointer, and no touch.
- Primary runs use 100% text with ordinary effects. Required companion runs use reduced effects and the existing 375×812 through 100%, 150%, and 200% text accessibility path where relevant.
- Browser control latency and frame timing use monotonic presentation-edge clocks after warm-up. Deterministic acceptance uses ordered activity counts and fixed logical ticks instead.

### Installed desktop reference

- Release Tauri/NSIS build using Microsoft Edge WebView2 Runtime 154.0.4258.53 on the Windows reference machine.
- Primary installed measurements use the existing isolated validated `CHRONO_FORGE_PROFILE` boundary and a 1440×900 viewport at 100% text. The required stress companion is 1024×720 at 200% text with reduced effects.
- Persistence scenarios use fresh profile names, real SQLite, save/exit/relaunch/reload continuity, and the exact production-exclusion check. Browser-preview storage never counts as native durability evidence.

## Deterministic activity method

- `src/testing/runtime-activity.ts` owns a test-only ordered recorder. Production supplies no recorder; the module enters product source only through erased type imports.
- The UI boundary records outgoing Worker requests, incoming Worker responses, and a frame application only after a ready frame or ordered delta applies successfully. Tests can derive request-to-response or request-to-applied-frame sequence distance and use an injected clock for deterministic latency fixtures.
- The Pixi boundary records explicit on-demand renders as `initial`, `projection`, `view`, or `motion`. Renderer activity remains downstream presentation evidence and cannot feed the Worker or simulation.
- Focus tests use the existing injected clock and fake timers. Idle and paused phases must own no periodic timer and issue no additional simulation ticks.
- Real elapsed latency, process memory, power, and thermals remain separate profile observations. A deterministic test may inject a clock to verify accounting, but no such value becomes authoritative state.

## Evidence log

- 2026-10-04: Repository-only root reconstruction verified the clean pushed branch at `be7df372dfd169a6371332f2e6dd99069f566ec9`, one documentation commit above M10.6 main. GitHub independently confirmed PR #21 merged at `7ccdad20e38bb038b4091b35b35d87bddae2e090`; exact-head workflow `37173672156` and exact merge-head workflow `37191096521` both passed Web, Windows native/installer, and aggregate `Required`.
- 2026-10-04: Read-only runtime exploration confirmed one avoidable paused/idle product defect. Pixi 8.19 defaults `Application` to `autoStart: true`, attaches `Application.render` to its ticker, and the map initialized without overriding that default. The GPU render loop therefore continued while the world and camera were unchanged. The focus controller itself already creates its one-second interval only for running phases and issues no ticks while idle or paused.
- 2026-10-04: The first renderer regression failed against the unchanged product because `Application.init` lacked `autoStart: false`. The correction disables the ticker and explicitly renders once after initialization, once after each projection/view application, and once per still-active agent interpolation frame. Static idle/paused maps schedule no product render loop; camera and rendering remain presentational.
- 2026-10-04: The deterministic activity harness proves exact initialization and one-tick Worker traffic, successful frame application, request-to-response and request-to-frame accounting, complete idle silence after draining the initial messages, and no false applied-frame event after an invalid delta. The Pixi regression proves one initial render, no activity across an injected 60-second idle observation, and exactly one view render after a camera change. The focus regression proves zero timers while idle, one while running, and zero again after pause with no later tick issue.
- 2026-10-04: Focused validation passes 3 files/39 tests across the Worker gateway, Pixi map, and focus scheduler. The added isolation regressions prove throwing observers cannot interrupt Worker delivery, frame application, or successful rendering; a failed Worker dispatch records no outbound activity; and switching to reduced effects cancels an already-pending interpolation frame. Type checking, full zero-warning web lint, formatting, and diff hygiene pass. The expected pre-fix on-demand renderer test failed only because `autoStart: false` was absent; it passed after the product correction.
- 2026-10-04: Live Chromium inspection of the actual local app confirmed the founding map remained complete after on-demand rendering. Camera input changed the displayed X position from 24 to 60 and redrew the map. A real focus run advanced the Worker projection; after Pause, logical tick 66 remained exactly 66 across a later observation. The preview returned to an idle new-session surface afterward.
- 2026-10-04: Independent Terra/high review found two implementation defects: observer exceptions could alter Worker/render lifecycle, and a reduced-effects transition could leave one queued interpolation render. Both were fixed with failure-contained observers, successful-dispatch-only request accounting, and explicit pending-frame cancellation. Re-review requested the successful-dispatch regression; after it was added, final review reported no release-relevant finding. The rebuilt production Chromium suite then passed all 6 scenarios in 45.5 seconds.
- 2026-10-04: The Worker still emits a `metrics` response after each ordinary advance even though the UI uses metrics only to resolve load/offline requests. This is measured normal-focus message overhead, not paused/idle churn. It remains an explicit candidate for the next bounded protocol-consumer audit rather than being changed speculatively in the first renderer slice.

## Current checkpoint boundary

- The deterministic measurement seam and first confirmed idle-render regression are implemented, independently reviewed with every finding closed, and locally verified. They are not yet committed, pushed, or hosted-verified.
- Large-world browser/desktop baselines, long-session memory slopes, installed save/reload and controlled-end evidence, normal-focus metrics-message audit, reduced-effects profile runs, and machine-specific power/thermal observations remain open.
