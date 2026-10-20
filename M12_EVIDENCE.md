# M12 v1.0.0 release evidence

Last updated: 2026-10-20

## Scope and current status

- M12 synchronizes the product, package, Rust crate, Tauri bundle, lockfiles, native identity assertion, release tests, documentation, and installer contract to `1.0.0` on branch `release/v1.0.0` from delivered M11 main `1067cbe16b7c00a5e5c5392547bcb4eaab9c043c`.
- Candidate commit `ec38a1ee59e9ae0ee6fb4d3086f1326970724598` changes the tag workflow to create or refresh a draft, require exactly four release assets, redownload those assets, verify their checksum and manifest binding, install/use/uninstall/reinstall the downloaded candidate, and publish only after that smoke passes. A rerun refuses to mutate an already published release.
- Local M12 acceptance is complete for this commit. Hosted exact-head review/CI, sequential merge, exact merge-head CI, the exact-main `v1.0.0` tag, tag-workflow smoke, and private release publication remain release-blocking and receive no local pre-acceptance.

## Independent review and focused verification

- The reused independent GPT-5.6 Terra/high reviewer inspected the complete M12 delta, including staged, unstaged, and untracked files, without editing it. It reported no P0-P3 finding and specifically confirmed exact version/tag binding, the four-asset contract, canonical path confinement, draft-only reruns, downloaded-byte installed continuity, and smoke-before-publish ordering.
- The review's sole residual risk was execution of the committed and tagged workflow. A later evidence wording check found one P3 contradiction in `PROGRESS.md`; the wording was corrected, and the same reviewer confirmed the finding closed with no new issue.
- Release-script syntax, the version lock, workflow YAML and all embedded PowerShell blocks, TypeScript, zero-warning web lint, formatting, Rust's `1.0.0` identity assertion, the production web build, and diff hygiene passed. The focused release set passed 4 files/25 tests; all unit tests passed 60 files/595 tests.

## Exact clean full gate

- The tracked and untracked source tree was clean at exact candidate commit `ec38a1ee59e9ae0ee6fb4d3086f1326970724598` when `npm run ci` began. The complete uninterrupted host-access gate passed end to end.
- Formatting, zero-warning web/Rust lint, and TypeScript passed. The covered suite passed 77 files/639 tests in 619.76 seconds with 88.86% statements, 81.52% branches, 94.70% functions, and 90.61% lines.
- The deterministic endurance suite passed 14 files/32 tests in 2,732.70 seconds. A read-only process check during its buffered run confirmed that Vitest workers were exiting and being replaced while accumulating CPU; this was slow active computation, not the previously documented near-zero-CPU host stall.
- Rust passed 43/43 tests. Browser E2E passed 7/7 in 1.3 minutes, including Worker authority, delayed-request responsiveness, reduced motion, 200% text, keyboard accessibility, relationship-rich save/reload, mid-flight space persistence, and contacted-civilization facts.
- Four native phase files passed all six installed Tauri/SQLite tests across distinct sessions. Post-exit database checks reported `integrity_check=ok` and `foreign_key_check=ok`. Upstream driver-discovery and mock-store teardown diagnostics remained non-blocking after each spec had passed.
- The release build generated a CycloneDX 1.5 SBOM with 1,051 components (770 npm and 281 Cargo), rebuilt the optimized app and unsigned x64 NSIS installer, wrote the atomic manifest for the exact commit, and confirmed that no WDIO bridge, test capability, fault hook, or global Tauri API exists in production.

## Exact artifacts and downloaded-byte continuity

- Installer: `Chrono Forge_1.0.0_x64-setup.exe`, 3,176,227 bytes, SHA-256 `7cee04f50c3068d6c059907475b991c29019e5eb02628f8c6c5be5f0aac2632a`.
- CycloneDX SBOM: `chrono-forge.cdx.json`, 1,016,818 bytes, SHA-256 `827f7cbb1422719c37ef7449df2bd3d2d5977080c3e29d22684baa40f73d58bd`.
- Manifest: `release-manifest.json`, 575 bytes, SHA-256 `13a7a88673ddd2224d71cb8b23e32944558d8d4b88f47e5322acf883ea2e27c9`. It binds package `1.0.0`, commit `ec38a1e`, and the installer/SBOM byte counts and hashes above.
- A flat simulated GitHub download contained exactly the installer, its 100-byte GNU-style SHA-256 file, the SBOM, and the manifest. `npm run stage:downloaded-release -- test-results/m12-release-download test-results/m12-release-staged` rejected no contract and restaged the exact bytes into their manifest-declared logical paths. The staging report independently matched every hash, byte count, version, and commit.
- With `CHRONO_FORGE_RC_ARTIFACT_ROOT=test-results/m12-release-staged` and `CHRONO_FORGE_RC_OUTPUT=test-results/m12-release-download-smoke`, `npm run verify:installed-release-candidate` passed install, live-use capture, save/persistence exercise, uninstall, reinstall, continuity inspection, final uninstall, and isolated cleanup from the staged downloaded bytes.
- The smoke captured 11 installed-product observations. Before uninstall, the isolated archive held five slots, one completed session, and nine immutable generations with SQLite integrity `ok`. Reinstall preserved every prior generation identity/checksum, reopened `M9 contacted world`, added only the permitted active-world offline checkpoint for ten total generations, and presented tick 25,055 on a 12 x 8 world. `profilePreservedAcrossUninstall` is true.
- Installed executable: 11,631,104 bytes, SHA-256 `787688842b9a7b5b180f3b4cb16d51883299e3ca9ccb622622a39798aace135c`. Smoke report: `test-results/m12-release-download-smoke/installed-release-candidate.json`, 6,025 bytes, SHA-256 `386ab502d41ba710ec4655e50926a7f6d33c8f3417f27fef9323aee62653f774`.

## Exact next action

PR #27 exact head `98947a5d33a0353c2f505e642ca64c1f29c77287` passed workflow `39387235495` with Web, Windows native/installer, and aggregate `Required`, then merged sequentially at `67c4c42177104b3b00eb9a063d0793a20fbcb11e`. Exact merge-head workflow `39390099439` passed the same three jobs. The annotated `v1.0.0` tag was created on that exact green main commit.

First tag workflow `39395214524` passed tag/commit/version verification and the complete release gate, generated the checksum, and created unpublished draft release ID `418240643`. It then failed closed before download or smoke because GitHub normalized spaces in the two installer asset basenames to dots: `Chrono Forge_1.0.0_x64-setup.exe` became `Chrono.Forge_1.0.0_x64-setup.exe`, contradicting the workflow's exact-name contract. The draft contains exactly four uploaded assets, remains unpublished, and no failed smoke receives acceptance credit.

The recovery slice canonicalizes Tauri's generated installer to the GitHub-safe `chrono-forge-1.0.0-x64-setup.exe` before the manifest and checksum are written, and the manifest validator now rejects non-canonical installer paths. Focused rename, path-rejection, downloaded-staging, and checksum regressions lock the boundary.

Script syntax, TypeScript, zero-warning web lint, formatting, and diff hygiene pass. The first focused Vitest attempt executed zero tests because Windows denied its sandbox cache rename; the unchanged host run passed 4 files/27 tests in 4.44 seconds. Independent recovery review then found one P2: a canonical-looking installer filename could declare a different package version than the manifest. The validator now derives one exact path from the declared package version during both creation and loading, and the regression set passes 4 files/28 tests. The same independent reviewer confirmed the P2 closed with no remaining actionable finding. A real production Tauri build generated the original spaced installer, after which the production canonicalizer left exactly `chrono-forge-1.0.0-x64-setup.exe`, 3,176,156 bytes, SHA-256 `0ce225aefd1f94e211169c4cfbf83bc0219c9811b6015e96fb2cf6fec8028463`. This proves the repair against the actual build output; final clean-commit artifact identity will be regenerated after commit.

Commit and deliver the independently reviewed recovery through a replacement exact-head and exact merge-head `Required` sequence. Because the original tag workflow is immutable at the failed tag commit, replace the unpublished `v1.0.0` tag only after the corrected main commit is green, then require the rerun tag workflow to refresh the existing draft, prune the dotted assets, upload exactly the canonical four, redownload and verify them, pass installed smoke, and only then publish. Record the final tag, workflow, release, asset, and URL evidence afterward.
