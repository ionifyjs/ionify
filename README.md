# Ionify

**The World's First Persistent Build Intelligence Engine.**

Ionify is a Rust-powered build engine that replaces disposable execution with persistent build intelligence.

Instead of repeatedly rediscovering dependency behavior, transforming the same modules, and rebuilding the same artifacts, Ionify persists project knowledge and reuses valid work across development, production, CI, and future cloud infrastructure.

---

## Traditional Prebundling Optimizes Dependencies.

## Ionify Publishes Dependency Contracts.

Modern build tools optimize dependencies for faster startup.

Ionify introduces a **Dependency Publication Layer (DPL)** that publishes dependency behavior as reusable infrastructure.

Published dependency contracts include:

* Export ABI Manifests
* Export Surface Hashes
* Singleton Ownership
* Fail-Closed Resolution
* Deterministic Artifact Identity

The result:

**One Dependency.
One Contract.
One Authority.**

---

## What Makes Ionify Different?

### One Graph

A persistent dependency graph that survives:

* Restarts
* Branch switches
* Dev/build transitions
* Workspace boundaries

The graph is treated as infrastructure, not temporary state.

---

### One CAS

Every transformed artifact is stored by identity.

If the inputs have not changed, Ionify reuses existing work instead of repeating it.

Artifacts are immutable.

Valid work is never recomputed.

---

### One Dependency Authority

Dependencies are analyzed once and published as reusable contracts.

The same dependency authority is consumed by:

* Dev Server
* Production Bundler
* Federation
* Vendor Packs
* Future Cloud Infrastructure

No dependency drift.

No multiple realities.

---

### One Pipeline

Traditional tooling often creates:

* Dev Reality
* Build Reality
* CI Reality
* Production Reality

Ionify uses a unified deterministic pipeline:

```text
Resolver
  → Dependency Publication
  → Persistent Graph
  → Transform
  → CAS
  → Planner
  → Output
```

The goal is simple:

Development and production should not disagree.

---

## Architecture

```text
Source Files
      ↓
Native Resolver
      ↓
Dependency Publication Layer
      ↓
Persistent Graph
      ↓
Hybrid Transform Engine
      ↓
Content Addressable Storage
      ↓
Planner
      ↓
Dev Server / Production Build
```

### Rust-Native Core

Ionify performs performance-critical work in Rust:

* Dependency Resolution
* Graph Management
* Artifact Planning
* Bundling
* Persistent Storage

Using:

* OXC (Primary Transform Engine)
* SWC (Compatibility Fallback)
* sled (Persistent Graph Storage)

---

## Build Intelligence Federation

Traditional Module Federation shares runtime code.

Ionify Federation aims to share build intelligence.

A remote can publish:

* Dependency Ownership
* Artifact Identity
* Dependency Contracts
* Startup Knowledge

The long-term goal is:

**Build Intelligence Federation**

Not just runtime code sharing.

---

## Enterprise Validation

Ionify has been validated on applications containing:

* 11,000+ internal modules
* 25,000+ dependencies

while maintaining deterministic behavior and structural reuse.

---

## Quick Start

### Create a New Project

```bash
pnpm create ionify@latest
```

### Install Into an Existing Project

```bash
pnpm add -D @ionify/ionify
```

Create:

```ts
export default {
  entry: "/src/main.ts",
  outDir: "dist",
};
```

Run:

```bash
pnpm ionify dev
```

Build:

```bash
pnpm ionify build
```

---

## Current Status

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
| AI Optimization Layer        | 🚧 Planned     |


---

## Links

Website: https://ionify.cloud

GitHub: https://github.com/ionifyjs/ionify

Issues: https://github.com/ionifyjs/ionify/issues

Contact: [khaledsalem@ionify.cloud](mailto:khaledsalem@ionify.cloud)

---

## License

MIT © Khaled Salem
