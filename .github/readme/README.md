# README / Continuum

Original, code-rendered artwork for Ionify’s README. The Continuum logo is the existing Ionify identity, not a new mark. These images explain the concept; they are not captured benchmark traces.

## Files

| File | Purpose |
| --- | --- |
| `continuum.gif` | 72-frame 3D hero, 5.76-second loop, 1200 × 640 |
| `continuum-still.png` | First-frame and reduced-motion alternative |
| `reported-builds.png` | Developer-reported numbers, with equivalent text/table in the README |
| `memory-stack.png` | Conceptual isometric graph / CAS / authority stack |
| `ionify-lockup-dark.svg` | Canonical vector identity from ionify-sites |
| `ionify-lockup-dark.png` | Rasterized vector input for the artwork renderer |
| `render-assets.py` | Deterministic CPU projection, lighting and image rendering |
| `check-readme.mjs` | Dependency-free README structure / asset checks |

## Regeneration

Use Python 3 with Pillow and NumPy installed. No runtime website dependency is added to the package.

```bash
python3 .github/readme/render-assets.py \
  --output .github/readme \
  --logo .github/readme/ionify-lockup-dark.png
node .github/readme/check-readme.mjs
```

The default font paths are macOS system fonts. On other systems provide `--sans`, `--serif`, and `--mono` paths to locally licensed equivalent fonts. Fonts are not redistributed. `--frames 1` creates a quick static inspection pass; use the default 72 frames for final assets.

The loop uses depth-sorted 3D ring geometry, an extruded Continuum core, moving orbital signal, alternating rotation and a gently expanding assembly. There are no camera cuts, flashes or scrolling effects. Text stays fixed for readability.

## GitHub / package rendering

GitHub strips executable scripts and inline styling from README HTML. The README therefore embeds a GIF, not a live Three.js canvas. The image links to the website’s interactive experience. A `picture` reduced-motion source and an explicit still-image link provide alternatives; GitHub also has its own animated-image accessibility setting. All key information remains in normal Markdown and alt text.

Public image URLs use the repository’s verified default branch, `main`, so they can also resolve outside the repository view (for example, package listings). They will resolve after these assets and the README are pushed to `main`; before that, use a local preview or open the assets directly. Do not publish the README alone without the assets.

## Content review — 2 October 2026

Checked against the Ionify Brain’s North Star, Pain Before Architecture, Vocabulary, Voice and Claim Boundaries, plus the public checkout’s package manifest, config types, environment loader and CLI definitions. The Brain remains private; no private source URLs, project identities or internal control documents are embedded in the public README.

- Lead with the developer’s edit–build–check loop, then reported results, commands and architecture.
- Keep the already supplied 30 ms / 120 ms / 5–6 s / 2.7 s figures together; identify them as developer-reported observations, not an independently reproducible benchmark.
- Remove the unsupported “maximum optimization” label and state the cold-build disadvantage explicitly.
- Avoid claims that competing engines have no persistence, or that a one-file edit always causes a one-file rebuild.
- State local lifecycle evidence separately from Cloud CAS, which remains in progress; Fast First Build remains planned.
- Reconcile with the latest `main` package before publication: 0.1.37, Node.js 22.x or 24.x, and declared macOS/Linux/Windows native packages. Do not present package declarations as proof of passed release tests. Retain the built-in tooling information already on `main`.
- Retain configuration, environment-mode and practical script examples. Fix the malformed code fence in the original README.
- Remove the top-level `outDir` option from the quick-start example to match the package’s exported configuration type.
- Keep correctness, input coverage and compatibility limits explicit without letting them replace the developer-facing reason to try Ionify.

The README-only update does not change native release artifacts, package dependencies or engine behavior.
