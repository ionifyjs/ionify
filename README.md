# Ionify

**The World's First Persistent Build Intelligence Engine.**

Ionify unifies development and production workflows into one persistent pipeline: dependency graph + content-addressable cache + hybrid transforms + analysis-ready architecture.

---

## What is Ionify?

**Ionify changes the game with "Build Persistence":**

- **Unified Intelligence:** The same engine for Dev and Production. No more "works in dev, breaks in build."
- **Rust-Native Performance:** Built on the **OXC** core for brutal speed and **SWC** for bulletproof compatibility.
- **CAS (Content-Addressable Storage):** Version-isolated caching that ensures you never transform the same code twice.

---

## Architecture

- The Persistence Layer
Unlike traditional tools, Ionify maintains a long-lived dependency graph that survives across runs.

- Resolver: High-speed native module resolution.

- Persistent Graph: Saves the entire project structure to a native Rust database (Sled/SQLite).

- Hybrid Transform: Uses a high-performance OXC primary engine with an SWC fallback for 100% resilience.

- CAS: Every transformed module is stored in a version-isolated Content-Addressable Store.

---

### Enterprise Proof

> Ionify has been battle-tested on enterprise projects with **11,000+ modules** and **25,000+ dependencies** with 100% stability.

---

## 🚀 Quick Start (The Fast Track)

The easiest way to start a new high-performance project with Ionify is using our interactive scratchpad:

```bash
pnpm create ionify@latest
```

This will set up a pre-configured environment optimized for the Ionify Persistence Engine.

🛠 Manual Installation

If you want to integrate Ionify into an existing project:

1.Install the core:

```bash
pnpm add -D @ionify/ionify
```

2.Initialize Configuration:


Create an `ionify.config.ts` in your root

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

## What's New

- Fix bug #5: stale dev dependency URLs could survive dependency routing changes and produce `/@deps/*` startup failures. Issue: https://github.com/ionifyjs/ionify/issues/5.

## Project Status

**Core engine:** Stable and production-ready  
**Unified dev + build pipeline:** Stable and production-ready    
**Persistent graph and CAS:** Stable and production-ready    
**Dependency pipeline:** Stable and production-ready   
**Monorepo support:** Ready and stable  
**Microfrontend runtime:** Stable  
**Analyzer:** Stable and production-ready     
**AI layers:** Planned on top of the unified engine

---

## Recent Implemented

- Environment Modes
Ionify loads `.env`, `.env.local`, `.env.<mode>`, and `.env.<mode>.local`.
Use `--mode` to select the app mode while keeping production build semantics:

- **Startup policy seed:** Ionify now records first-route startup observations and persists a startup policy snapshot for dev analysis.
- **Smarter first-hit preloads:** current routed vendor-pack v2 assets are preferred over stale legacy fallback preloads.
- **Route-aware analyzer visibility:** `ionify analyze` now exposes startup-policy signals, eager/deferred visibility, and route-level policy context.
- **Improved cloud push state UX:** clearer dependency snapshot states, cloud snapshot reuse messaging, and more explicit Tier-1/Tier-2 summaries.

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

## Links

- **Website:** [ionify.cloud](https://ionify.cloud)
- **GitHub:** [github.com/ionifyjs/ionify](https://github.com/ionifyjs/ionify)
- **Issues:** [github.com/ionifyjs/ionify/issues](https://github.com/ionifyjs/ionify/issues)
- **Contact:** contact@ionify.cloud

---

## License

MIT © Khaled Salem
