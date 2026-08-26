# ⚡ Ionify

**The build engine that doesn't start over.**

One Graph. One CAS. One Authority.

---

Every layer of computing learned to stop redoing work it had already done —
CPUs got caches, databases got indexes, compilers got incremental compilation.

The build never learned it.

Every run rediscovers dependencies, re-transforms modules, and reconstructs
work the previous run already knew.

Ionify is a build engine that **remembers**.

It maintains a persistent dependency graph, a content-addressable store, and
one published authority over dependency identity and artifacts — shared across
dev and production so the build does not have to rediscover the same truth
every time it runs.

But remembering work is only half the problem.

Ionify also has to prove that remembered work is still valid before it can be
reused.

That is the idea behind **Build Authority**:

> Produce build knowledge once. Give every fact one owner. Reuse it only while
> the evidence that made it valid still holds.

## Quick Start

```bash
pnpm add -D @ionify/ionify
````

Create `ionify.config.ts`:

```typescript
export default {
  entry: "/src/main.ts",
  outDir: "dist",
  productionArtifactPublishing: "auto",
};
```

Then:

```bash
pnpm ionify dev
pnpm ionify build
```

Or start a new project:

```bash
pnpm create ionify
```

## Tested at scale

We pressure-test Ionify on a large React application containing more than:

* **15,000 React components**
* **25,000 dependencies**

On the same machine, with both tools configured for their maximum practical
production optimization:

| Build state                |     Vite 8 |        Ionify |
| -------------------------- | ---------: | ------------: |
| True cold production build | **~2.7 s** |  **~11–12 s** |
| Warm no-edit build         |          — | **~35–40 ms** |
| One-file mutation          |          — |   **~100 ms** |

The warm number begins with the **second build**.

The first Ionify build still has to discover the graph, resolve dependency
boundaries, transform source, establish artifact identities, and publish the
proofs that make later reuse trustworthy.

After that, Ionify does not simply ask whether cached bytes exist.

It asks whether previously produced work is still **admissible** under the
current source, configuration, dependency, and artifact identities.

If nothing changed, the build can collapse to tens of milliseconds.

If one source file changed, Ionify can reconstruct the affected work instead
of treating the entire project as new.

Today, Vite is substantially faster on the first build.

That matters. Cold build performance is part of the real developer and CI
experience, and it remains an active optimization target for Ionify.

But Ionify is also optimizing another dimension:

**the lifetime cost of a project after verified build knowledge exists.**

The goal is to make the second build fundamentally different from the first.

## What Ionify Is

Ionify is not just another faster bundler.

It is a persistent build engine built around three ideas:

### One Graph

A long-lived dependency graph survives across builds and process restarts.

The engine does not need to rediscover the entire application merely because
another build started.

### One CAS

Build artifacts are stored by identity in a version-isolated,
content-addressable store:

```text
.ionify/cas/versionHash/moduleHash/...
```

An artifact can be reused when its identity and supporting proof still match
the current build state.

A CAS hit alone is not authority to reuse work.

### One Authority

Every build fact should have one canonical owner.

Dependency identity, topology, publication, transforms, and other derived
facts should not be independently rediscovered by competing parts of the
pipeline.

Dev and production consume the same authorities rather than constructing
different answers to the same question.

This removes an entire class of lifecycle drift:

* works in dev, breaks in production
* duplicate dependency ownership
* phantom exports
* unnecessary reconstruction
* cached work reused under the wrong assumptions

The goal is not to detect those inconsistencies later.

It is to make them structurally difficult to create.

## Architecture

At a high level:

```text
                         Source
                           │
                           ▼
                    Resolve / Classify
                           │
                           ▼
                Canonical Transform
                  OXC primary
                  SWC fallback
                           │
                           ▼
                        Define
                           │
                           ▼
                  Final source bytes
                           │
                           ▼
                      Parser(B)
                           │
                    ┌──────┴──────┐
                    ▼             ▼
               Resolver facts   Import facts
                    │             │
                    └──────┬──────┘
                           ▼
                 Persistent Graph
                           │
                           ▼
             Dependency Publication Layer
                           │
                           ▼
                Verified artifact identity
                           │
                           ▼
             Content-Addressable Store
                           │
                   ┌───────┴───────┐
                   ▼               ▼
              Dev lifecycle   Production build
```

The important property is not the exact sequence of implementation stages.

It is ownership:

**one canonical derivation, one owner for each fact, and verified reuse across
lifecycles.**

### Hybrid Transformation Engine

Ionify uses a hybrid transformation strategy by design.

**OXC is the primary transform and import-analysis engine.**

**SWC is selected automatically as a compatibility fallback when the canonical
transform requires it.**

They are not separate build authorities.

Both operate underneath the same canonical Transform authority, so choosing a
fallback does not create a second independent interpretation of the module.

The application does not need to choose between OXC and SWC.

### Canonical derivation

For changed source, Ionify's production lifecycle derives the canonical source
state once.

Conceptually:

```text
source
  ↓
canonical Transform
  ↓
A
  ↓
Define
  ↓
B
  ↓
Parser(B)
  ↓
Resolver + dependency demand
  ↓
published build knowledge
```

Parser(B) observes the final post-Define bytes rather than reconstructing a
separate interpretation of the source.

Verified transform artifacts can then be admitted by later stages instead of
being transformed again.

### Dependency Publication Layer

Dependencies are not treated as an anonymous tree that every lifecycle is free
to rediscover.

Ionify's Dependency Publication Layer (DPL) owns the published dependency
identity and topology consumed by the rest of the build.

That gives dev and production one answer to questions such as:

```text
Which dependency is this?

What does it expose?

Which artifact represents it?

Which published dependency boundary does this module belong to?
```

The dependency tree remains provenance.

The published dependency artifact is the build contract.

### Verified reuse

Ionify distinguishes between:

```text
artifact exists
```

and:

```text
artifact is admissible for this build
```

A cached artifact is reused only when its identity and supporting proof match
the current build state.

When proof is missing or invalid, Ionify reconstructs the affected work rather
than silently trusting stale bytes.

This is the difference between caching work and remembering **verified** work.

### Storage

* **Graph persistence** — native Rust implementation
* **Transformed outputs** — version-isolated CAS
* **Dependency artifacts** — published through DPL
* **Artifact admission** — proof-backed rather than existence-backed
* **Automatic invalidation** — identity/configuration-aware

### Unified Dev + Production

Development and production consume the same resolver semantics, dependency
authority, transform contracts, and persistent build knowledge.

They may perform different work for their lifecycle, but they do not get
independent authority to redefine the same facts.

That distinction is central to Ionify:

**shared authority does not require identical execution.**

## Environment Modes

Ionify loads `.env`, `.env.local`, `.env.<mode>`, and `.env.<mode>.local`.

Use `--mode` to select the application mode while keeping production build
semantics:

```bash
pnpm ionify dev --mode staging
pnpm ionify build --mode staging
```

Config functions receive the selected mode and loaded environment values:

```typescript
import { defineConfig } from "@ionify/ionify";

export default defineConfig(({ mode, env }) => ({
  cloud: {
    apiUrl: env.IONIFY_CLOUD_API_URL,
    namespace: mode,
  },
}));
```

## Project Status

| Capability                                      | Status         |
| ----------------------------------------------- | -------------- |
| Persistent Graph                                | ✅ Stable       |
| Content Addressable Storage                     | ✅ Stable       |
| Native Dependency Resolver                      | ✅ Stable       |
| Unified Dev + Build Authority                   | ✅ Stable       |
| Dependency Publication Layer (DPL)              | ✅ Stable       |
| One Dependency Authority (ODA)                  | ✅ Stable       |
| Production Artifact Publishing (PAP)            | ✅ Stable       |
| One CSS Authority (CSSA)                        | ✅ Stable       |
| Canonical Transform / Define / Parser lifecycle | ✅ Stable       |
| Proof-backed Transform admission                | ✅ Stable       |
| Owner-scoped mutation reconstruction            | ✅ Stable       |
| Federation Foundation                           | ✅ Stable       |
| Workspace Engine                                | ✅ Stable       |
| Ionify Analyze                                  | ✅ Stable       |
| Cloud CAS                                       | 🚧 In Progress |

## Current build behavior

The current production lifecycle has been validated against four projects,
including a large React pressure test.

The architecture currently enforces:

* one canonical Transform / Define / Parser observation for changed source
* zero duplicate app-source Transform work on the validated true-cold path
* verified TransformArtifactProof admission
* DPL-owned dependency publication
* affected-owner reconstruction for source mutation
* zero derivation on the following no-edit build
* shared build authorities across lifecycle reuse

These are architectural invariants, not benchmark targets.

## What's next

Cold build performance is now one of the major remaining optimization targets.

Current profiling shows that the first build still pays substantial cost in
dependency processing, canonical derivation/materialization, bundling, and
post-build compression.

Those costs will be optimized without weakening the authority model that makes
warm reuse possible.

Another upcoming area is **invalidation explainability**.

When Ionify decides that previously verified work can no longer be reused, the
engine should be able to explain why:

```text
module invalidated
    because source identity changed

artifact rejected
    because configuration identity changed

dependency contract rebuilt
    because dependency topology changed
```

The goal is for invalidation to become inspectable rather than mysterious:
not only **what rebuilt**, but **which declared input or authority fact caused
that decision**.

This also creates a path toward detecting build rules that depend on inputs
outside their declared authority — for example environment state, time, or
external data — rather than allowing an apparently valid warm hit to hide an
undeclared dependency.

## Links

Website: [https://ionify.cloud](https://ionify.cloud)
GitHub: [https://github.com/ionifyjs/ionify](https://github.com/ionifyjs/ionify)
Issues: [https://github.com/ionifyjs/ionify/issues](https://github.com/ionifyjs/ionify/issues)
Contact: [khaledsalem@ionify.cloud](mailto:khaledsalem@ionify.cloud)

## License

MIT © Khaled Salem
