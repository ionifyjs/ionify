# ⚡ Ionify

**A web infrastructure intelligence engine**

Ionify unifies development and production workflows into one persistent pipeline: dependency graph + content-addressable cache + hybrid transforms + analysis-ready architecture.

---

## What is Ionify?

Ionify is a web infrastructure intelligence engine.

Instead of treating development and production as separate tools, Ionify runs the entire lifecycle through a single persistent engine — from file watching and resolution to transformation, caching, and bundling.

At its core, Ionify maintains a **long-lived dependency graph** and a **content-addressable cache** that survive across runs. This allows the engine to understand how projects evolve over time, not just how they build once.

Ionify combines a high-performance native core with a hybrid transformation strategy:
- **OXC** as the primary engine for parsing and transformation
- **SWC** as a fallback to ensure compatibility and resilience

This unified and persistent design enables something traditional tooling cannot:  
**infrastructure-level insight into the build process itself** — opening the door to analysis, optimization, and future AI-assisted recommendations.

---

## Why This Matters

### What Ionify Unifies

Ionify unifies what is traditionally fragmented across multiple tools:

- Development server and production bundling
- Resolution logic and dependency semantics
- Transformation and caching strategies
- Performance characteristics across environments

By running everything through the same engine, Ionify eliminates an entire class of inconsistencies that appear when dev and build pipelines diverge.

### For Developers

- **Fewer "works in dev, breaks in build" surprises** — same pipeline in both modes
- **Faster iteration** — persistent graph and cache reuse across runs
- **Deterministic behavior** — consistent across environments
- **Foundation for intelligent tooling** — infrastructure that can reason about builds, not just execute them

Ionify is designed to be the layer *below* frameworks and plugins — the infrastructure they can rely on.

---

## Architecture

### Pipeline Overview

```
Source Files
    ↓
  Resolver
    ↓
Persistent Dependency Graph (native)
    ↓
Transform Engine (OXC/SWC hybrid)
    ↓
Content-Addressable Store (.ionify/cas/versionHash/moduleHash/...)
    ↓
Dev Server / Bundler
```

### Hybrid Transformation Engine

Ionify uses a hybrid transformation strategy by design.

**OXC** is used as the primary engine for parsing and transformation, optimized for performance and modern JavaScript syntax. **SWC** acts as a fallback layer to ensure robustness and compatibility across edge cases and evolving ecosystems.

This approach allows Ionify to remain framework-agnostic while balancing speed, correctness, and long-term maintainability.

### Storage

- **Graph persistence** — native Rust implementation
- **Transformed outputs** — stored in version-isolated CAS
- **Automatic invalidation** — via configuration hash

### Why This Enables Intelligence

Because Ionify persists the dependency graph and transformed outputs, the engine can observe patterns over time:
- Which modules change frequently
- Which transformations are expensive
- How dependency structure affects rebuild cost

This data is the basis for future analyzer tooling and AI-assisted optimization.

---

## Quick Start

### Installation

```bash
pnpm add -D ionify
```

### Minimal Configuration

Create `ionify.config.ts`:

```typescript
export default {
  entry: "/src/main.ts",
  outDir: "dist",
};
```

### Development Server

```bash
pnpm ionify dev
```

### Production Build

```bash
pnpm ionify build
```

---

## Project Status

**Core engine:** Stable and production-ready  
**Unified dev + build pipeline:** Implemented  
**Persistent graph and CAS:** In place  
**Dependency pipeline:** Stabilization in progress  
**Plugin system:** Temporarily paused  
**Analyzer and AI layers:** Planned on top of the unified engine

---

## Key Features

### Current

- **Persistent Graph Engine** — dependency graph saved to disk and reused across runs
- **Unified Pipeline** — dev and production share the same core logic
- **Content Addressable Cache (CAS)** — version-isolated, deterministic caching
- **Rust-Powered Performance** — native core for parsing, transformation, and bundling
- **Hybrid Transform Strategy** — OXC primary, SWC fallback
- **Graph-based HMR** — intelligent hot module replacement based on dependency structure

### Planned

- **Analysis Dashboard** — visualize builds, cache hits, and dependency hot paths
- **AI-Assisted Optimization** — auto-tune splits, targets, and bundle strategies
- **Monorepo Support** — native workspace handling
- **Remote Build Cache** — team-level caching infrastructure

---

## Language Stack

| Component               | Technology          |
| ----------------------- | ------------------- |
| Core Engine             | Rust                |
| CLI / SDK / Plugin API  | TypeScript          |
| Graph Persistence       | Native (sled/SQLite)|
| Primary Parser          | OXC                 |
| Fallback Parser         | SWC                 |
| Future Analyzer UI      | React + TypeScript  |

---

## Roadmap

1. ✅ **Core Engine** — parser, graph, CAS, dev server
2. ✅ **Unified Pipeline** — same engine for dev and production
3. ✅ **Persistent Graph + Cache** — version-isolated storage
4. 🔄 **Dependency Pipeline Stabilization** — robust node_modules handling
5. ⏸️ **Plugin System** — paused for pipeline stabilization
6. 📋 **Analyzer UI + Insights** — build visualization and metrics
7. 📋 **AI Optimization Engine** — intelligent build recommendations
8. 📋 **Monorepo / Remote Cache** — team collaboration features

---

## Philosophy

Ionify is designed to be the infrastructure layer that frameworks and plugins rely on — not another framework itself.

By unifying the build pipeline and persisting the dependency graph, Ionify creates a foundation for:
- Smarter tooling that understands your project over time
- Analysis and optimization based on real build patterns
- Future AI-assisted recommendations grounded in actual data

---

## Links

- **Website:** [ionify.cloud](https://ionify.cloud)
- **GitHub:** [github.com/ionifyjs/ionify](https://github.com/ionifyjs/ionify)
- **Issues:** [github.com/ionifyjs/ionify/issues](https://github.com/ionifyjs/ionify/issues)
- **Contact:** contact@ionify.cloud

---

## License

MIT © Khaled Salem
