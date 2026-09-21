# Chrono Forge player guide

Chrono Forge is a local-first focus timer and autonomous civilization simulator. Start or resume focused work to advance one saved world; its people choose their own work, construction, relationships, institutions, research, diplomacy, crisis response, and space activity. You observe, inspect factual history, and may make limited condition-changing interventions.

This guide describes the current private development build. It is not yet the signed v1.0 release.

## Install on Windows

The supported release target is Windows 10/11 x64. The desktop build uses a current-user NSIS installer and Microsoft WebView2.

Current development and release-candidate installers are unsigned. Windows may show **Unknown publisher** or a Microsoft Defender SmartScreen warning.

1. Obtain the installer and its SHA-256 checksum from the same trusted private Chrono Forge release or build handoff. Do not use an installer copied from an unverified source.
2. Verify that the installer's checksum matches the published checksum.
3. Run the installer. If SmartScreen appears, select **More info**, confirm that the filename and checksum are the expected ones, and then select **Run anyway**.
4. Complete the per-user installation and launch Chrono Forge.

If WebView2 is missing, install the Microsoft WebView2 Evergreen Runtime and reopen Chrono Forge. Automatic updates are not enabled for private v1 builds; export important worlds before installing a replacement build.

## Start a focus session

The **Focus forge** shows the active world slot and timer.

1. Choose a 25-, 50-, or 90-minute preset, or enter 1–1,440 custom focus minutes.
2. If optional breaks are enabled, enter a break from 0–240 minutes.
3. Select **Start focus**.
4. Use **Pause** and **Resume** without losing the world or accepted time. **Complete focus** ends the focus phase early and records it as completed; **Cancel** ends it without a completed-session recap. **End break** finishes a running or paused break early.

Only accepted running focus time advances the configured focus-time simulation ticks. Paused time does not. Interruptions are non-punitive: they do not damage or reset the civilization.

When a session completes, its recap shows accepted duration, the exact before/after world ticks, a compact set of factual state comparisons, and at most twelve immutable events recorded after that session's starting event. A quiet interval explicitly says that no major event was recorded; it never borrows older history. When a still-valid person, structure, settlement, route, or ruin is available, **Revisit** opens that exact map subject for deliberate inspection without advancing the world. Focus history and recaps are scoped to the active slot and survive reload. If an older history row no longer has a matching retained world event, its time and tick accounting remain visible but Chrono Forge hides the unverified prose.

## Observe and explore the world

The map and every inspector are read-only views of Worker-owned simulation facts. Moving the camera, zooming, selecting an overlay, opening a panel, or inspecting a person cannot change history.

Pointer controls:

- Drag the map to pan.
- Use the pointer wheel over the map to zoom around that location. Map zoom does not scroll the page.
- Select a visible object to open its factual details.

Keyboard controls:

- Use `Tab` and `Shift+Tab` to reach primary controls and the map.
- With the map focused, use the arrow keys to pan, `+` or `=` to zoom in, and `-` or `_` to zoom out.
- Press `Enter` on the focused map to select the first visible inspectable object.
- The camera arrow, zoom, and **Reset** buttons provide the same movement without map shortcuts.
- **Inspect map object** provides a keyboard-accessible list of visible people, structures, settlements, routes, ruins, and active effects.

Map overlays show terrain, resources, population, trade, technology, danger, and diagnostic world information. Each overlay includes a text legend and a pattern cue; color is not the only status signal.

Select **Open world inspection** when you want detail beyond the calm focus surface. The optional panels expose:

- people, biographies, immediate family, households, and salient relationships;
- cultures and their declared family policy;
- pageable relationship events and the authoritative world timeline;
- settlements, civilizations, residents, migration, routes, diplomacy, conflicts, and ruins;
- contextual knowledge, current research, modeled crisis conditions, and interventions;
- discovered celestial bodies, programs, spacecraft, missions, colonies, cargo, delayed communication, aliens, and space relations.

There is no manual world-advance control in the production interface. Only accepted focus time advances the live world directly; bounded offline progression remains a separate local setting and is clearly reported when applied.

## Optional interventions

An intervention changes a bounded modeled condition; it never selects an exact outcome.

1. Select a map tile.
2. Open **World inspection**, then **Optional intervention**.
3. Choose weather, resource, organism, omen, artifact, protection, disaster, or alien-signal conditions.
4. Choose supportive or challenging polarity and an integer intensity from 1–100.
5. Queue the intervention.

The simulation decides whether and how people, settlements, knowledge, crises, or contact respond. Interventions are recorded as factual input events.

## Save slots and recovery

Durable saves are available in the installed desktop app. The browser development preview is explicitly **not durable**.

- The first desktop launch creates the primary slot if no slot exists.
- **Save now** commits a new immutable generation for the active slot.
- Chrono Forge retains the newest three fully recoverable generations. If the newest checksum-valid generation is semantically invalid, loading falls back to an older valid generation without deleting the failed evidence. The archive shows the loaded generation number.
- **Load local slot** replaces the current world with the selected slot. Slot switching is disabled during an active focus session.
- **Export** creates a text package for the exact accepted generation. Copy it to a separate trusted location for backup.
- **Validate and import** checks the package, version, checksum, and world references before creating/selecting the imported slot. Hand-edited, corrupt, oversized, or future-version packages are rejected without replacing a valid world.

Important current lifecycle limitation: **Create another slot → Save as new slot** duplicates the active world at its current tick under a new slot ID and name. It does not create a fresh world. Separate **New World**, **Duplicate Current World**, and **Reset World** operations remain release-blocking M10.9 work. Until that milestone lands, do not use **Save as new slot** when you intend to start over.

There is no finished player-facing reset/delete-world workflow in the current build. Preserve an export before experimenting with development builds or local data.

## Offline and interrupted-session behavior

**Bounded offline progression** is optional. It is enabled by default with a 24-hour maximum and can be disabled in settings.

- **Maximum offline hours** accepts 0–168 hours.
- On loading a saved slot with no restorable running focus session, Chrono Forge clamps elapsed time to that setting, caps the rate at 1,000 ticks per second of offline time, and caps one catch-up at 1,000,000 ticks.
- A catch-up is simulated through the same deterministic systems, saved as a new generation, and recorded as an `offline-catch-up` event.
- A restorable running focus checkpoint uses the controlled focus clock instead of also applying ordinary offline catch-up, preventing the same elapsed interval from being counted twice.
- Backward wall-clock changes are clamped; they do not create negative or duplicate accepted time.

If you do not want the world to change while Chrono Forge is closed, leave bounded offline progression disabled or set maximum offline hours to 0.

## Simulation rules and determinism

- World authority advances in integer fixed ticks inside one module Worker.
- The displayed 128-bit seed, saved configuration, ordered player inputs, and engine/content version determine the authoritative result. Identical inputs within the same version reproduce identical state and history.
- Random choices use saved deterministic streams. The simulation does not use camera position, rendering frame rate, locale ordering, or wall-clock timing to choose outcomes.
- People autonomously choose ordinary work, buildings, movement, family and household changes, research, settlement growth, politics, conflict, crisis response, and space activity. There are no routine job or building-placement controls.
- Technology depends on persisted prerequisites, materials, pressure, skilled people, institutions, trade, conflict, experimentation, and controlled randomness; it is not one universal ladder.
- Population detail and aggregation are camera-independent and conserve protected named lives, family/relationship facts, residents, and resources.
- Timeline, biography, relationship, recap, civilization, development, and space descriptions quote the same immutable typed source events. Snapshot migration may improve deficient legacy display wording without adding, removing, replaying, or changing the identity of an event.

Determinism does not mean different app versions must have the same final hash. A versioned migration or intentional simulation/content change can produce a new canonical result; the saved version and migration preserve the supported history contract.

## Accessibility and calm use

- Primary focus, archive, map, overlay, settings, and inspection controls are keyboard operable and show focus state.
- Person, family, relationship, and timeline detail use bounded pages so long histories remain navigable.
- Text labels, numeric values, condition words, patterns, and static markers supplement color and animation.
- **Reduce visual effects** suppresses nonessential motion while retaining danger and selection information.
- **Calm focus mode** keeps optional detail out of the primary focus surface.
- The interface is tested at 100%, 150%, and 200% text scaling. Use Windows text scaling or application/browser zoom as appropriate; the current settings panel does not provide a separate text-size slider.
- Completion sound and notifications are optional. Important information also appears in text and is never conveyed by audio alone.
- The map canvas exposes an accessible summary; use **Inspect map object** and the world-inspection controls for exact object facts.

## Local data and privacy

Core gameplay requires no account, cloud sync, analytics service, or runtime network connection. Worlds, immutable save generations, focus history, and settings are stored in the Tauri per-user application-local-data directory in `chrono-forge.sqlite3`. Windows and Tauri choose the exact base directory for the current user.

Exports contain the world seed, complete saved simulation state, and recorded history for that slot. Treat them as private files if names, focus history, or world history are sensitive. Sharing an export is an explicit action.

The browser preview uses a non-durable preview adapter and should not be used as a backup. Uninstalling or replacing a development build is not a backup operation; export important slots first. Do not delete or hand-edit the SQLite database while Chrono Forge is running.

## Troubleshooting

### Windows blocks the installer

Confirm that the installer came from the trusted private handoff and that its SHA-256 checksum matches. Only then use **More info → Run anyway** for the expected unsigned build. If either value differs, stop and obtain a clean artifact.

### The app opens but remains on “Generating seeded terrain”

Close every Chrono Forge window and reopen the app. If the issue repeats, preserve any export and record the build version, active slot name, and exact status message. Do not delete the local database as a first recovery step.

### A save does not load

Chrono Forge automatically tries older immutable generations. Note the recovered generation shown in **World archive**. If no valid generation remains, keep the database and rejected export intact for diagnosis; importing or deleting files cannot reconstruct missing authority.

### An import is rejected

Use the complete export text without edits or truncation. Packages from a future unsupported version, with a mismatched checksum, invalid references, or excessive size are intentionally rejected. Keep the original package and error text.

### The timer or controls stop responding

Pause if the control still responds, then use **Save now**. If the UI is unresponsive, close and reopen the app so it can restore the last atomic world/timer checkpoint. Preserve the slot and report the session length, whether the machine slept, and whether autosave or offline catch-up was active. Long-duration freeze and cross-layer responsiveness are explicit M10.8 release blockers; do not treat a repeated freeze as expected behavior.

### Sound or notifications do not appear

Check **Completion sound**, **Completion notifications**, and **Volume percent**, then check Windows notification and volume settings. Audio/notification failure should not block completion or hide the text recap.

### Map motion is uncomfortable or performance is poor

Enable **Reduce visual effects**, use **Reset** to restore the camera, and close optional world inspection when it is not needed. Record the world tick, population, selected overlay, text scale, and whether the problem persists after restart.

### The database is reported busy or locked

Close other Chrono Forge instances and retry. Do not copy, replace, or edit the live SQLite/WAL files. Use the in-app export after the archive becomes available.

## Current release constraints

- The current package version is a private `0.1.0` development build, not the final v1.0.0 release.
- Only Windows 10/11 x64 is a supported native target for v1.
- Current installers are unsigned and use manual trusted distribution; there is no embedded private-repository token or anonymous auto-updater.
- **Save as new slot** currently duplicates a world; fresh-world and reset semantics remain M10.9 work.
- The existing sound is a completion tone, not the final M10.2 atmosphere and soundscape.
- The M10.5 release-quality game-graphics/UI overhaul, dedicated frontend/backend/whole-product stabilization gates, clean release-candidate verification, signing/release packaging, tag, and private GitHub v1.0.0 release are not complete.
- macOS and Linux may be architecturally possible but are not supported or release-verified.

For development and exact validation commands, see [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [PLAN.md](PLAN.md). The current evidence and known blockers are in [PROGRESS.md](PROGRESS.md).
