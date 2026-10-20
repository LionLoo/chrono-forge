# Chrono Forge v1.0.0 release notes

Chrono Forge is a private, local-first Windows focus timer and autonomous civilization simulator. A real focus session advances one deterministic persistent world while its people gather, build, form families and societies, respond to crises, develop contextually, establish multiple settlements and civilizations, and eventually enter a factual system view with missions, colonies, exchange, and alien contact.

## Highlights

- Calm focus sessions with pause, completion, optional breaks, notifications, and factual before/after recaps grounded only in recorded simulation events.
- One 256×192 shared homeworld for new saves, with autonomous people, households, cultures, settlements, polities, development, disasters, conflict, recovery, population scaling, and gradual long-term progression.
- Accessible Surface and System views with keyboard and pointer navigation, independent presentation cameras, factual inspectors, patterned non-color overlays, 100-200% text support, reduced effects, calm mode, and optional local procedural sound.
- Explicit **Create new world**, **Duplicate current world**, and same-slot **Reset active world** flows with visible reproducible seeds and fail-closed persistence ordering.
- Multiple local SQLite save slots, immutable recovery generations, manual save, import/export, bounded offline progression, corruption fallback, and cold-relaunch continuity.
- Deterministic factual history, biographies, relationships, family life, development provenance, civilization records, space missions, colonies, communications, and discovered-alien relations across save/reload.

## Supported release target

- Windows 10 or Windows 11, x64.
- Microsoft WebView2 Runtime is required.
- The v1.0.0 installer is a current-user NSIS package.
- macOS and Linux are not supported release targets for v1.0.0.

## Install and trust

This private v1.0.0 build is unsigned because no Windows signing credential is established. Obtain the installer, its `.sha256` file, the CycloneDX SBOM, and the release manifest from the same trusted private GitHub release. The manifest binds the exact source commit to the immutable installer and SBOM hashes. Verify the manifest and SHA-256 checksum before running the installer. Windows may show **Unknown publisher** or Microsoft Defender SmartScreen; proceed only when the filename and checksum match the trusted release.

Chrono Forge requires no account or online service. Saves, settings, and focus history remain in local application data. Uninstalling the application intentionally leaves that local archive in place so reinstalling can recover it; export important worlds before manually deleting local data.

## Verification boundary

The release candidate freezes snapshot, engine, and content version 14 plus Worker protocol version 11. Its clean-checkout gate covers formatting, zero-warning lint, type checking, covered tests, long deterministic simulations, Rust tests, browser E2E, installed native/SQLite recovery, SBOM generation, production test-code exclusion, and Windows x64 NSIS packaging. Final M11 evidence additionally covers silent install, installed product review, uninstall/reinstall continuity, accessibility, 120-minute browser and installed performance profiles, installer checksum, and independent final code/product review. The tag workflow first creates an unpublished draft, downloads the exact four release assets, verifies and stages their bytes against the source-bound manifest and checksum, completes the installed/uninstall/reinstall smoke from that download, and publishes only after those checks pass.

## Known non-blocking limitations

- Windows code signing is not available for this private release, so publisher warnings are expected.
- The System view is a factual read-only projection of saved celestial bodies, routes, missions, craft, colonies, communications, and discovered aliens. V1 does not simulate a separate tile terrain map for every body and does not call the procedural homeworld Earth unless saved authority says so.
- Focus history is retained locally without an automatic total-row expiry, and SQLite files may retain previously allocated disk pages after logical generation pruning.
- Dense production web bundles can emit a build-time chunk-size warning; measured browser and installed runtime budgets remain release-blocking and are recorded separately.
- There is no anonymous telemetry, cloud sync, multiplayer, mandatory login, or automatic updater.

## Private release contents

- Usable Windows x64 NSIS installer.
- Installer SHA-256 checksum file.
- CycloneDX JSON SBOM covering npm and Cargo components.
- Atomic release manifest binding the exact source commit, package version, installer, and SBOM hashes.
- Repository evidence for the clean release-candidate and exact tagged-release gates.
