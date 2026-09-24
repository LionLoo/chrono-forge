# Third-party notices

This file is the human-reviewed inventory. Release builds also generate exact dependency license output and software bills of materials from the lockfiles.

| Component                  | License                                             | Use                                                                           |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| React / React DOM          | MIT                                                 | Accessible application UI                                                     |
| Vite                       | MIT                                                 | Frontend build tool                                                           |
| PixiJS                     | MIT                                                 | WebGL 2D renderer                                                             |
| TypeScript                 | Apache-2.0                                          | Language toolchain                                                            |
| Tauri                      | MIT OR Apache-2.0                                   | Desktop application shell                                                     |
| Rust crates                | Per-crate; audited before release                   | Native integration and persistence                                            |
| SQLite                     | Public domain                                       | Local world and focus-session persistence                                     |
| rusqlite                   | MIT                                                 | Narrow Rust SQLite adapter                                                    |
| xoshiro128** 1.1 reference | Public domain dedication with unrestricted fallback | Deterministic RNG port; source: https://prng.di.unimi.it/xoshiro128starstar.c |

No copyrighted game assets may be copied into this repository. Every font, image, texture, sound, and generated asset must have its source, license, generation method, and permitted distribution recorded here or in `assets/ATTRIBUTION.md` before it enters a release build.

Project-original artwork and its generated packaging variants are inventoried in `assets/ATTRIBUTION.md` and machine-checked against `assets/attribution.json`.

Chrono Forge's M10.2 sound palette and adaptive ambience are project-original code-native Web Audio synthesis implemented in `src/adapters/soundscape.ts`. They distribute no sampled, generated, or third-party binary audio asset and therefore require no additional audio license or attribution.
