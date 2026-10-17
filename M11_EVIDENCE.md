# M11 release candidate and clean verification evidence

Last updated: 2026-10-16

## Baseline and frozen contract

- Branch: `release/v1.0.0-rc`.
- Exact baseline: delivered M10.9 main `d7fbb74f1ff55e331ccfc80a28e53ec76059699d`.
- M10.9 PR #25 final head `39b42db96a0c421e1136f136ed2542eec99ea8f5` passed exact-head workflow `38944274911`; merge commit `d7fbb74` passed exact merge-head workflow `38948993359`. Both workflows passed Web, Windows native/installer, and aggregate `Required`.
- Candidate authority is frozen at snapshot/engine/content version 14 and Worker protocol version 11 unless a confirmed release blocker requires an explicit reviewed migration or protocol correction.
- M11 owns clean-checkout reproduction, installed-artifact product verification, final accessibility/performance evidence, checksum/SBOM evidence, release notes, and independent final code/product review. It does not pre-accept the M12 version synchronization, exact `v1.0.0` tag, tag-built artifacts, downloaded-artifact smoke, or private GitHub release.

## Acceptance matrix

- [ ] Clean isolated checkout installs locked dependencies and passes the complete validation suite.
- [ ] Windows x64 NSIS candidate builds, installs, launches, and preserves intended local data through uninstall/reinstall verification.
- [ ] Installed candidate creates a fresh world and completes an accelerated focus session with factual recap.
- [ ] Installed candidate visibly demonstrates autonomous gathering/construction and save-exit-reload continuity.
- [ ] Deterministic evidence demonstrates a factual multi-decade relationship/family biography across save/reload.
- [ ] Deterministic evidence demonstrates eras, disaster/recovery, multiple settlements, divergent seeds, and planetary/space progression.
- [ ] Final keyboard, 100-200% text, reduced-motion/effects, color/non-color, and visual-product inspection passes.
- [ ] Browser and installed 120-minute scale/performance profiles pass every locked budget.
- [ ] Exact candidate installer SHA-256 checksum and CycloneDX SBOM are produced and verified.
- [ ] Release notes, installation steps, supported platform, privacy, limitations, and unsigned-distribution guidance are complete.
- [ ] Independent final code/product review reports no unresolved release blocker; every confirmed fix is revalidated.
- [ ] One M11 PR passes exact-head Web, Windows native/installer, and aggregate `Required`, merges sequentially, and exact merge-head aggregate `Required` passes.

## Evidence log

### Release-contract and installed-verifier procedure checkpoint

- `tests/unit/release-contract.test.ts` locks snapshot/engine/content version 14 and Worker protocol version 11, and requires the release notes to retain the supported Windows boundary, unsigned/private trust guidance, checksum/SBOM instructions, local-data uninstall behavior, privacy statement, and known limitations. `RELEASE_NOTES.md` records those disclosures without pre-accepting M12 version synchronization or publication.
- `npm run typecheck`, `npm run lint:web`, `npm run format:check:web`, `node --check scripts/run-installed-release-candidate.mjs`, and `git diff --check` passed. After independent-review fixes, `npx vitest run tests/unit/installed-release-candidate.test.ts tests/unit/release-contract.test.ts --reporter=verbose` passed 2 files/12 tests in 4.04 seconds, including a never-resolving CDP request and a successful response whose JSON body never resolves; both reached their deadline and ran cleanup.
- `npm run verify:installed-release-candidate`, with `CHRONO_FORGE_RC_OUTPUT=test-results\m11-rc-cdp-body-fix`, silently installed the existing x64 NSIS candidate into an enforced direct child of the workspace `test-results` root, launched it with generated isolated profile `m11-rc-85268eec8e4f69a2`, captured 11 installed-product observations, exercised keyboard/pointer controls, 100-200% text, reduced effects, focus completion, manual save, multiple world imports, and the contacted System state, then uninstalled, reinstalled, and reopened the same active `M9 contacted world` at tick 25,045. SQLite integrity and foreign-key checks passed before and after reinstall; every saved snapshot was freshly SHA-256 hashed and matched its stored digest, and all five slots, one focus session, and all nine pre-uninstall immutable generation identities/checksums remained exact. Reopen intentionally applied bounded offline progression and added only `m9-contacted` generation 3, bringing the total to ten. Each complete CDP request and response-body parse is bounded by the remaining overall readiness deadline, and every normal or forced process stop must return success and confirm child exit. Final uninstall preserved the archive, while successful harness cleanup removed the generated profile and installed executable/uninstaller.
- The verifier wrote `test-results/m11-rc-cdp-body-fix/installed-release-candidate.json`, `reinstalled-continuity.png`, 11 review images plus `observations.json`, and checksum `9a1bad5645e0d491a2412327b38561ca6e2e1e3188bf79b4fae6464d250fe812` for the 3,177,172-byte `Chrono Forge_0.1.0_x64-setup.exe`. The installed executable was 11,631,104 bytes with SHA-256 `c40bf6273e72018deda8a820f16d46b9dbd576f347fd77a5981af32718e26fe4`.
- Failure and recovery were fail-closed. The first development run proved that an imported legacy archive is canonically rewritten on reopen; the verifier now explicitly saves the Worker-owned contacted world before uninstall. The second run proved that exact head-generation equality contradicts the intentional startup offline-catch-up commit. Read-only database inspection and the product startup code confirmed the cause; the verifier now rejects any changed or missing prior checksum, slot/session drift, inactive-world advance, or more than the single expected new active-world generation. Focused regressions cover checksum mutation and wrong-slot addition. Exact generated failed-run profiles and ignored outputs were removed only after validated absolute-path checks; no normal user archive was touched.
- Independent Terra/high review reported one P1 and two P2 findings: continuity trusted stored checksums without hashing snapshot bytes, failed CDP readiness could leak the launched process, and the configurable output root contradicted the workspace-only claim. Fresh snapshot hashing and physical/direct-child output enforcement closed the P1 and path P2. First re-review found that cleanup errors were still suppressed and forced termination was not confirmed; cleanup now preserves both readiness and cleanup failures, requires successful `taskkill`, and confirms exit afterward. Branch review then found that a CDP `fetch`, and later its response-body parse, could outlive the surrounding deadline. The complete probe now has one independent remaining-time bound that aborts the request, while the readiness wrapper still requires cleanup. Regressions cover stale checksums, stalled request, stalled response body, readiness cleanup failure, nonzero force-kill, a still-live post-kill process, external output, and nested output. The strengthened full installed cycle passed and the final independent closure is recorded below.
- Final Terra/high closure review inspected the full delta from M10.9 main, including every untracked M11 file, and reported no P0-P3 release-relevant finding. It independently passed diff check, script syntax, typecheck, and 2 files/12 focused tests in 4.13 seconds. Clean-checkout, exact-artifact, performance, final whole-product, and hosted M11 gates remain open.
- This checkpoint validates the procedure, not final M11 acceptance: the exercised installer predates the uncommitted verifier/release-contract slice. Final credit requires a committed exact clean-checkout build, complete gate, rerun of this verifier against that exact artifact, both 120-minute profiles, independent final review, and hosted exact-head/merge-head `Required` evidence.

## Exact next action

Commit this reviewed verifier/release-contract slice, then reproduce the exact commit from a clean isolated checkout with `npm ci` and the complete gate before rerunning installed verification against that exact artifact.
