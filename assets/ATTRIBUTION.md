# Chrono Forge asset attribution

The machine-checked source of truth is `assets/attribution.json`. Dependency licenses are generated separately from the npm and Cargo lockfiles and included in the release SBOM/notices.

| Asset group             | Files                          | Source and creation                                                                 | License and distribution                         |
| ----------------------- | ------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| Chrono Forge brand mark | `public/chrono-forge-mark.svg` | Original project artwork, hand-authored from geometric SVG shapes                   | MIT; bundled and redistributed with Chrono Forge |
| Application icons       | `src-tauri/icons/**`           | Tauri-generated platform variants derived from the original Chrono Forge brand mark | MIT; bundled and redistributed with Chrono Forge |

No third-party visual or audio work is currently shipped. Every future runtime image, icon, font, texture, sound, or music file must be added to the JSON manifest before it can pass the release gate.
