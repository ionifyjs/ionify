# ⚡ Ionify

**The build engine that doesn't start over.**

One Graph. One CAS. One Authority.

---

Every layer of computing learned to stop redoing work it had already done — CPUs got caches, databases got indexes, compilers got incremental compilation. The build never learned it. Every run rediscovers your dependencies, re-transforms your modules, and rebuilds the same artifacts from zero.

Ionify is a build engine that **remembers**: a persistent dependency graph, a content-addressable store, and a single published authority over every dependency — shared by dev, build, and CI so they can never disagree.

## Quick Start

```bash
pnpm add -D ionify
```

Create `ionify.config.ts`:

```typescript
export default {
  entry: "/src/main.ts",
  outDir: "dist",
  productionArtifactPublishing: "auto",
};
```

```bash
pnpm ionify dev     # development server
pnpm ionify build   # production build
```

## What Ionify Is

Ionify is not a faster bundler — it's a different category. It runs the entire lifecycle through one persistent engine: file watching, resolution, transformation, caching, and bundling. Because the engine *owns* the pipeline, it can persist what it learns:

- **One Graph** — a long-lived dependency graph that survives restarts. The engine understands how your project evolves over time, not just how it builds once.
- **One CAS** — a content-addressable store (`.ionify/cas/versionHash/moduleHash/…`). If content hasn't changed, its work is never done again. Deterministic, version-isolated, automatically invalidated by configuration hash.
- **One Authority** — each dependency's export surface is published once as a content-hashed contract. The dev server, the production bundler, and federation all consume the *same* contract. There is a single, enforced answer to "what does this dependency expose" — so dev and production cannot quietly drift.

That last part kills a whole class of bugs by construction, not by detection: *"works in dev, breaks in build"*, duplicate singletons, phantom exports — they're all the same disease (no single source of truth about a dependency), and they become structurally impossible when the truth has one owner.

## Architecture

```
Source Files
    ↓
  Resolver
    ↓
Persistent Dependency Graph (native)
    ↓
Transform Engine (OXC)
    ↓
Content-Addressable Store (.ionify/cas/versionHash/moduleHash/...)
    ↓
Dev Server / Bundler
```

### Hybrid Transformation Engine

Ionify uses a hybrid transformation strategy by design: **OXC** as the primary engine for parsing and transformation (performance, modern syntax), with **SWC** as a fallback layer for robustness across edge cases and evolving ecosystems. This keeps the engine framework-agnostic while balancing speed, correctness, and long-term maintainability.

### Storage

- **Graph persistence** — native Rust implementation
- **Transformed outputs** — stored in version-isolated CAS
- **Automatic invalidation** — via configuration hash

### Unified Dev + Production

Development and production share the same resolver, the same dependency semantics, the same transforms, and the same caching strategy. Unifying the pipeline eliminates the entire class of inconsistencies that appears when dev and build pipelines diverge.

## Environment Modes

Ionify loads `.env`, `.env.local`, `.env.<mode>`, and `.env.<mode>.local`.
Use `--mode` to select the app mode while keeping production build semantics:

```bash
pnpm ionify dev --mode staging
pnpm ionify build --mode staging
```

Config functions receive the selected mode and loaded env values:

```typescript
import { defineConfig } from "ionify";

export default defineConfig(({ mode, env }) => ({
  cloud: {
    apiUrl: env.IONIFY_CLOUD_API_URL,
    namespace: mode,
  },
}));
```

## Project Status

| Capability                   | Status         |
| ---------------------------- | -------------- |
| Persistent Graph             | ✅ Stable       |
| Content Addressable Storage  | ✅ Stable       |
| Native Dependency Resolver   | ✅ Stable       |
| Dependency Publication Layer | ✅ Stable       |
| One Dependency Authority     | ✅ Stable       |
| Unified Dev + Build Pipeline | ✅ Stable       |
| Federation Foundation        | ✅ Stable       |
| Workspace Engine             | ✅ Stable       |
| Ionify Analyze               | ✅ Stable       |
| Cloud CAS                    | 🚧 In Progress |

## What's New

- Fix bug #5: stale dev dependency URLs could survive dependency routing changes and produce `/@deps/*` startup failures. Issue: https://github.com/ionifyjs/ionify/issues/5.

## Links

Website: https://ionify.cloud
GitHub: https://github.com/ionifyjs/ionify
Issues: https://github.com/ionifyjs/ionify/issues
Contact: [khaledsalem@ionify.cloud](mailto:khaledsalem@ionify.cloud)

## License

MIT © Khaled Salem