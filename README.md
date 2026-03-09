# Ionify

**Build once. Reuse forever.**

Ionify is a Rust-powered build engine for modern frontend apps: a persistent dependency graph + CAS-first transforms + few-request vendor packs.

## What Ionify is

Ionify is not a dev server plus a separate bundler.
It is a single persistent engine that keeps development, build, and test aligned through one core pipeline:

```text
source files
  → resolver
  → persistent dependency graph
  → transform engine (OXC first, SWC fallback)
  → content-addressable cache (.ionify/cas/...)
  → dev server / bundler / test hydration
```

That architecture lets Ionify reuse real work across restarts and rebuilds instead of recomputing the world on every run.

## Why it is different

- Persistent graph — restarts do not reset engine knowledge
- CAS-first transforms — warm builds converge toward near-zero work
- Few-request vendor packs — collapse `/@deps/*` waterfalls without breaking correctness
- Workspace-aware state — one shared `.ionify/` across apps in a monorepo
- Unified semantics — dev and build run through the same dependency model and cache boundary
- Rust-native core — parsing, dependency handling, and bundling stay in the native path

## Current reality (March 2026)

Ionify’s unified engine is production-ready at the core level.

### Stable today

- Persistent engine architecture for dev + build
- Rust-native dependency resolution with CJS/ESM interop
- Progressive vendor packs with chunk-group isolation and few-request warm mode
- Usage-driven pack slimming with persistent analysis and CAS-backed slim variants
- Workspace engine with shared Graph/CAS state across apps
- CAS-first hydration across dev, build, and test
- React Fast Refresh, HMR, and TypeScript-first pipeline
- Deterministic production builds with CAS hit/miss visibility
- `ionify analyze` for pack request/byte savings

### Next focus

- Dependency analyzer UI / CLI views
- Bundle bloat detection and lighter-alternative suggestions
- Duplicate package detection across versions
- Telemetry foundation for AI-assisted optimization

## Quick start

### Scaffold a new project

```bash
npm create ionify@latest
# or
pnpm create ionify@latest
# or
yarn create ionify
# or
bunx create-ionify@latest
```

### Manual install

```bash
npm i -D @ionify/ionify
# or
pnpm add -D @ionify/ionify
# or
yarn add -D @ionify/ionify
# or
bun add -d @ionify/ionify
```

Create `ionify.config.ts`:

```ts
import { defineConfig } from "@ionify/ionify";

export default defineConfig({
  entry: "/src/main.tsx",
  optimizeDeps: {
    sharedChunks: "auto",
    vendorPacks: "auto",
    packSlimming: "auto",
  },
});
```

Run Ionify:

```bash
pnpm ionify dev
pnpm ionify build
pnpm ionify analyze
```

## Architecture notes

### Two hashes, one mental model

- `versionHash` partitions Graph + CAS by config-sensitive engine inputs
- `depsHash` partitions optimized dependencies under `.ionify/deps/<depsHash>/`

This is how Ionify stays restart-fast without hidden stale-cache behavior.

### Storage model

- Graph persistence: native Rust
- Transformed outputs: version-isolated CAS
- Dependency artifacts: `.ionify/deps/<depsHash>/`
- Workspace sharing: `.ionify/` lives at the workspace root when applicable

## Philosophy

Ionify is infrastructure, not a framework.

The goal is a lean core with deterministic behavior, persistent knowledge, and clear cache boundaries — so frameworks, plugins, and future analyzer layers can build on top of something stable.

## Links

- Website: [ionify.cloud](https://ionify.cloud)
- Repository: [github.com/ionifyjs/ionify](https://github.com/ionifyjs/ionify)
- Issues: [github.com/ionifyjs/ionify/issues](https://github.com/ionifyjs/ionify/issues)

## License

MIT © 2026 Ionify