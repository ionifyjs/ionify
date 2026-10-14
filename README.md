<p align="center">
  <a href="https://ionify.cloud">
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcset="https://raw.githubusercontent.com/ionifyjs/ionify/main/.github/readme/continuum-still.png">
      <img src="https://raw.githubusercontent.com/ionifyjs/ionify/main/.github/readme/continuum.gif" width="1200" alt="Ionify. Keep the work. Keep the flow. Three rotating, separated engine rings surround the Continuum mark: establish, verify, reuse.">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://ionify.cloud/getting-started"><strong>Get started ↗</strong></a> &nbsp; · &nbsp;
  <a href="https://ionify.cloud/guide">Read the guide</a> &nbsp; · &nbsp;
  <a href="https://ionify.cloud/compare">Compare workflows</a> &nbsp; · &nbsp;
  <a href="https://github.com/ionifyjs/ionify/issues">Report a finding</a>
</p>

<p align="center"><sub>Rust-powered · Persistent build knowledge · MIT licensed<br>3D artwork, not a live build trace. <a href="https://raw.githubusercontent.com/ionifyjs/ionify/main/.github/readme/continuum-still.png">View the still</a> · <a href="https://ionify.cloud/#layers">Explore the interactive engine ↗</a></sub></p>

# Ionify

### Your next edit deserves a shorter wait.

You change a component. Build. Check it. Find one more thing. Build again.

**Ionify helps reduce the repeated work between your idea and checking the result.** It is a Rust-powered frontend build engine that keeps valid build knowledge across local runs, so the next build can benefit from the last—even after the process exits.

The first build establishes that knowledge. Later builds verify what still holds, reuse it, and rebuild what needs to change. Less time repeating work. More time working through your feature.

[See the reported results](#01--the-next-build) · [Run it](#02--make-your-first-build) · [Try one edit](#03--make-one-change) · [Open the engine](#04--why-the-work-can-survive) · [Current limits](#05--know-the-boundaries)

---

## 01 / The next build

<img src="https://raw.githubusercontent.com/ionifyjs/ionify/main/.github/readme/reported-builds.png" width="1200" alt="Developer-reported Ionify production builds on one project: about 30 ms with no changes, about 120 ms after one file changed, and 5–6 seconds for the first build. Full comparison and limitations follow.">

On a private project with roughly **15,000 React components** and **25,000 dependencies**, the project’s developer reported these production-build times:

| What you do | Ionify | Vite 8 |
| :--- | ---: | ---: |
| Build for the first time | **~5–6 s** | ~2.7 s |
| Change nothing and build again | **~30 ms** | ~2.7 s |
| Change one file and build again | **~120 ms** | ~2.7 s |

The useful result is the shorter pause before checking your next change. **The first Ionify build was slower.** These measurements describe production invocations—not HMR latency, dev-server startup or a remote-cache hit.

> **Scope of this report:** developer-reported observations from one private project, not independently reproduced here. Hardware, exact tool revisions, configuration and a public reproduction harness were not supplied with the figures. The source project is not public. Treat these as a reason to try your own workflow, not a universal speed guarantee.

[Read the full Vite comparison →](https://ionify.cloud/compare/vite-vs-ionify)

## 02 / Make your first build

**Before you start:** this repository’s `0.1.37` package declares native packages for macOS (`darwin-arm64`, `darwin-x64`), Linux (arm64 and x64, GNU and musl), and Windows (arm64 and x64, MSVC). The loader selects the matching runtime. Keep optional dependencies enabled; they carry the native engine. A declared target is not itself evidence that every release-validation check has passed.

The package requires **Node.js 22.x or 24.x** (`^22.0.0 || ^24.0.0`). Check the version requirements of your chosen template too.

### Keep the frontend tools you use

Built-in support covers React and Fast Refresh; JavaScript, TypeScript, JSX and TSX; ES modules and CommonJS dependency interop; CSS and CSS Modules; static assets; dynamic imports and code splitting; HMR; environment files and `import.meta.env`; and workspace discovery. Sass and Less require their corresponding compiler packages. Tailwind CSS and PostCSS use their normal project packages and configuration. Validate your app’s specific integrations before switching its build command.

### Start a new app

```bash
pnpm create ionify@latest
```

Follow the scaffolder prompts and the generated project’s instructions. Prefer npm? Use `npm create ionify@latest`.

### Bring an existing app

Start in a branch or separate checkout. Keep your current build command while checking compatibility.

```bash
pnpm add -D @ionify/ionify
```

Create `ionify.config.ts`, pointing at your app’s actual entry:

```typescript
import { defineConfig } from "@ionify/ionify";

export default defineConfig({
  entry: "/src/main.tsx",
});
```

Keep your HTML entry and required framework configuration. This example configures a build entry; it does not create the application or guarantee compatibility with every framework or plugin.

```bash
# Develop the app.
pnpm exec ionify dev

# In a separate terminal, or after stopping dev:
pnpm exec ionify build
```

[Setup guide →](https://ionify.cloud/getting-started) · [Configuration →](https://ionify.cloud/configs) · [CLI →](https://ionify.cloud/cli)

## 03 / Make one change

Choose a visible component—a button label is enough. The question is simple: **how soon can you check the correct production result after an edit?**

```bash
# 1. Establish the initial build.
pnpm exec ionify build

# 2. Keep .ionify and the output directory. Change nothing.
pnpm exec ionify build

# 3. Edit a visible string in an imported component, then:
pnpm exec ionify build

# 4. Check the built app. Run again without another edit.
pnpm exec ionify build
```

Keep the inputs and output requirements comparable. Record first-build and repeat-build times separately. Check the emitted app, not only the timer. Repeat with a stylesheet, dependency and configuration change before adopting a new engine.

**Changing one file does not promise a one-file rebuild.** Shared consumers, CSS demand, chunk relationships or incomplete reuse proofs can require wider work. Correct output comes before a cache hit.

<details>
<summary><strong>Use the environment your app actually runs in</strong></summary>

Ionify loads these files for the selected mode:

```text
.env
.env.local
.env.<mode>
.env.<mode>.local
```

```bash
pnpm exec ionify dev --mode staging
pnpm exec ionify build --mode staging
```

A configuration function receives `mode` and `env`:

```typescript
import { defineConfig } from "@ionify/ionify";

export default defineConfig(({ mode }) => ({
  entry: "/src/main.tsx",
  server: {
    port: mode === "staging" ? 5174 : 5173,
  },
  productionArtifactPublishing: "auto",
}));
```

Selecting `staging` changes the environment mode; `build` still uses production-build semantics. Do not put secrets in client-exposed environment variables.

</details>

<details>
<summary><strong>Already using Nx or Turborepo? Keep the team’s workflow.</strong></summary>

Try Ionify as one supported application’s build command. Keep your existing test runner, linting, task orchestration and remote-cache service.

```json
{
  "scripts": {
    "dev:ionify": "ionify dev",
    "build:ionify": "ionify build"
  }
}
```

These are pilot scripts, not a complete task-runner integration. Configure task inputs, outputs and environment for your repository. A whole-task cache hit can skip the engine entirely; check a real source edit that causes the build command to run, too.

[Nx example →](https://ionify.cloud/compare/nx-vs-ionify) · [Turborepo example →](https://ionify.cloud/compare/turborepo-vs-ionify)

</details>

## 04 / Why the work can survive

<img src="https://raw.githubusercontent.com/ionifyjs/ionify/main/.github/readme/memory-stack.png" width="1200" alt="Conceptual exploded 3D stack: a persistent graph remembers relationships, a content-addressed store retains artifacts, and Build Authority defines the owners and validity checks for reuse.">

**One Graph. One CAS. One Authority.** The architecture explains the feedback-loop benefit; it is not a substitute for measuring it.

| What you keep | How Ionify approaches it | Where the promise stops |
| :--- | :--- | :--- |
| **Project knowledge after a restart** | A persistent graph records module identities, content hashes and dependency edges. | A graph must be complete and valid for the decision consuming it. |
| **Useful work from the previous build** | A content-addressable store (CAS) retains artifacts by content-derived identity. | A matching hash alone does not prove that all relevant inputs were included. |
| **A shared interpretation across dev and build** | Authoritative producers publish dependency, styling and production contracts for later consumers. | Shared ownership reduces a source of disagreement; it does not guarantee zero bugs or identical work in every stage. |

Build Authority means giving each category of build knowledge an explicit owner, then checking identity and validity before reuse. When a proof is missing or stale, the safe path is to re-establish the work—not trust a file merely because it exists.

<details>
<summary><strong>Inside the authority layers: DPL, CSSA, PAP and PRA</strong></summary>

| Layer | Responsibility |
| :--- | :--- |
| **DPL · Dependency Publication Layer** | Publishes dependency identities, artifacts and export contracts for consumers. |
| **CSSA · CSS Authority** | Owns styling artifacts and the input/completeness proofs needed to reuse them. |
| **PAP · Production Artifact Publishing** | Publishes production contracts and, when requested, artifacts into `.ionify`. It is not deployment. |
| **PRA · Production Readiness Authority** | Verifies output readiness against the current build identity. It does not create the artifacts it verifies. |

The configured hybrid transformation path tries OXC first, with SWC as a compatibility fallback. Transformation speed is one part of the engine; ownership, persistence and validity determine whether that work needs repeating.

[Explore the architecture →](https://ionify.cloud/architecture) · [Build Authority →](https://ionify.cloud/build-authority)

</details>

## 05 / Know the boundaries

| Area | Current position |
| :--- | :--- |
| **Local warm reuse** | Validated in the project’s reported work, including local process restarts and dev-to-build consumption. Results depend on inputs and configuration. |
| **First-build cost** | Still improving. Fast First Build is planned, not a completed capability. |
| **Remote / cross-machine reuse** | Cloud CAS is in progress. Local timings are not evidence of equivalent CI or team-wide reuse. |
| **Framework and plugin fit** | Check your app’s required behavior. Ionify is not presented as a drop-in replacement for every Vite, webpack or Next.js integration. |
| **Correctness and trust** | Validity checks and conservative fallback matter. Persistent state and hashes are not a blanket guarantee of invalidation completeness or supply-chain security. |

Other engines and task runners also provide incremental work and caching. Choose Ionify for the improvement you can demonstrate in your own edit–build–check loop—not a claim that other tools remember nothing.

[Development status →](https://ionify.cloud/status) · [Choose by workflow →](https://ionify.cloud/compare)

---

### Make your next build count.

Try one app. Keep your existing build available. Tell us what got faster, what did not, and whether the output behaved correctly.

For a useful issue, include the Ionify version, OS/CPU, command, cache state, a minimal reproduction when possible, and expected versus actual output. Remove credentials and private source before sharing.

**[Get started ↗](https://ionify.cloud/getting-started)** · [Open an issue](https://github.com/ionifyjs/ionify/issues) · [Contact](mailto:khaledsalem@ionify.cloud)

<sub>MIT · [License](LICENSE) · [Website](https://ionify.cloud) · [Visual asset sources](.github/readme/README.md)</sub>
