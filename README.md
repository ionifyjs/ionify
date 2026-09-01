# ⚡ Ionify

**The build engine that doesn't start over.**

**One Graph. One CAS. One Authority.**

Most build tools are designed to execute a build quickly.

Ionify is designed around a different question:

> **Why should the next build rediscover work the previous build already verified?**

Ionify is a Rust-powered build engine that preserves verified build knowledge
across runs.

It maintains a persistent project graph, stores reusable work in a
content-addressable store, and gives build facts a single authority shared
across development and production.

The result is not just caching.

It is a build system designed to **remember**.

---

## Tested at scale

Ionify has been pressure-tested on a large React codebase containing more than:

- **15,000 React components**
- **25,000 dependencies**

On that workload, Vite 8 Maximum optimization build path took approximately:

**2.7 seconds**

Once Ionify had established and verified the project's build knowledge,
the same no-change build completed in approximately:

**30 milliseconds**

**That result begins with the second build.**

The first build still has real work to do: discover the project, establish
identities, transform source, construct the graph, and verify what can safely
be reused.

Ionify does not pretend that work disappears.

It is designed so that verified work does not need to be rediscovered on every
build afterward.

> These numbers come from a private pressure-test project. Project identity and
> source cannot be disclosed, but the workload characteristics and measurements
> are reported here without identifying the codebase.

---

## What's New

### 0.1.37 — Isolated dependency generations

Fixed a browser-cache collision that could reuse incompatible dependency
artifacts when projects installed with different package managers shared the
same local development origin.

Dependency URLs now bind to their exact store generation, and native packages
are produced without private build-machine paths.

### 0.1.36 — Cross-platform native runtime

Fixed #6: Ionify could fail to load its native engine on environments that
didn't match the binary distributed with the package.

Ionify now automatically selects the correct native runtime for supported
macOS, Windows, and Linux environments, with no platform configuration
required.

## Quick Start

Create a new project:

```bash
pnpm create ionify
````

Or add Ionify to an existing project:

```bash
pnpm add -D @ionify/ionify
```

Create `ionify.config.ts`:

```typescript
import { defineConfig } from "@ionify/ionify";

export default defineConfig({
  entry: "/src/main.ts",
  outDir: "dist",
});
```

Then:

```bash
pnpm ionify dev
pnpm ionify build
```

---

## Why Ionify exists

Traditional build pipelines are remarkably good at doing work quickly.

But they still tend to reconstruct knowledge that was already established:

* rediscover the dependency graph;
* reconsider unchanged modules;
* reconstruct dependency state;
* reproduce artifacts that were already verified;
* allow development and production paths to establish overlapping answers.

Ionify treats that as an architectural problem.

Instead of asking only:

> How fast can we rebuild this?

Ionify also asks:

> What has actually changed — and which previously verified facts are still valid?

That distinction is the foundation of the engine.

---

## One Graph

Ionify maintains a persistent dependency graph rather than treating every run
as a new world.

When the project changes, the engine can reason about the affected part of the
graph instead of assuming the entire project has become unknown again.

---

## One CAS

Verified artifacts are stored in a version-isolated content-addressable store.

Unchanged content can therefore refer back to already-established work instead
of reproducing it simply because another build command was started.

The cache is not treated as the source of truth.

Reuse is admitted only when the engine can establish that the artifact belongs
to the current build state.

---

## One Authority

A build fact should have one owner.

Ionify is built around that principle.

Dependency identity, transformed source, reusable artifacts, and production
state should not acquire different meanings simply because the developer moved
from `dev` to `build`.

Development and production consume the same underlying build knowledge.

This is the idea behind **Build Authority**:

> **derive a build fact once, verify it, give it one owner, and reuse it wherever
> that fact remains valid.**

---

## Unified development and production

Ionify does not treat the development server and production build as unrelated
systems that happen to understand the same source files.

They share the same underlying authorities and persistent build knowledge.

That reduces an important source of build-system drift:

**the development pipeline believing one thing while the production pipeline
believes another.**

---

## Transformation

Ionify uses **OXC as its primary transformation engine**.

SWC is available automatically as a compatibility fallback for source that
requires it.

Both remain behind the same canonical transformation authority, so fallback
does not create a second competing build pipeline.

---

## What happens after the first build?

The first build establishes knowledge.

Later builds can reuse it.

For a no-change build, Ionify can return to an already verified state without
re-transforming the application simply because another build command was run.

For a source mutation, the goal is different:

**do the work affected by that mutation — not project-sized work by default.**

And once that change has been incorporated, the next no-change build should
return to quiescence.

That lifecycle is more important to Ionify than optimizing a single isolated
benchmark.

---

## Environment modes

Ionify supports:

```text
.env
.env.local
.env.<mode>
.env.<mode>.local
```

Select a mode independently of the build command:

```bash
pnpm ionify dev --mode staging
pnpm ionify build --mode staging
```

Configuration can consume the selected mode and environment:

```typescript
import { defineConfig } from "@ionify/ionify";

export default defineConfig(({ mode, env }) => ({
  entry: "/src/main.ts",
  outDir: "dist",
  productionArtifactPublishing: "auto",
}));
```

---

## What Ionify is not

Ionify is not trying to be another thin wrapper around a faster transformer.

OXC, SWC, Rust, caching, and incremental work all matter.

But none of them is the thesis.

The thesis is:

> **A build system should not repeatedly rediscover facts it has already
> established and can still prove valid.**

That is the problem Ionify is built to explore.

---

## Build Authority

Ionify is also the reference implementation behind ongoing work on
**Build Authority** — a model for reasoning about ownership, identity, reuse,
and lifecycle consistency inside build systems.

The implementation is evolving, but the central principles are simple:

**One Graph. One CAS. One Authority.**

---

## Links

Website: [https://ionify.cloud](https://ionify.cloud)

GitHub: [https://github.com/ionifyjs/ionify](https://github.com/ionifyjs/ionify)

Issues: [https://github.com/ionifyjs/ionify/issues](https://github.com/ionifyjs/ionify/issues)

Contact: [khaledsalem@ionify.cloud](mailto:khaledsalem@ionify.cloud)
