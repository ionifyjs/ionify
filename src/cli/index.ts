
// ── T21: NODE_COMPILE_CACHE auto-set ─────────────────────────────────────────
// V8 caches compiled bytecode for every module it loads. On subsequent runs
// the module-parse step is skipped (~10-15ms saved per CLI invocation).
// Must be set early — it is read by V8 at module-load time, so setting it
// here means the NEXT invocation benefits (not the current one, which has
// already started loading modules). The cache is self-populating and
// machine-local; no user action needed. Uses HOME env var (available on all
// POSIX systems and Windows via Node's normalisation) to avoid async imports.
if (!process.env.NODE_COMPILE_CACHE) {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (home) process.env.NODE_COMPILE_CACHE = home + "/.ionify/global/compile-cache";
}

import { Command, Option } from "commander";
import { logInfo, logError } from "./utils/logger.js";
import { startDevServer } from "./commands/dev.js";
import { runAnalyzeCommand } from "./commands/analyze.js";
import { runBuildCommand } from "./commands/build.js";
import { runPublishCommand } from "./commands/publish.js";
import { runAddCommand } from "./commands/add.js";
import { runPushCommand } from "./commands/push.js";
import { runHydrateCommand } from "./commands/hydrate.js";
import { runLoginCommand, runLogoutCommand, runWhoamiCommand } from "./commands/login.js";
import { runBindCommand } from "./commands/bind.js";
import { runStatusCommand } from "./commands/status.js";
import { runMigrateCommand } from "./commands/migrate.js";

const program = new Command();

function validateEnvFlag(cmd: string, value: string): "development" | "production" {
  if (value === "development" || value === "production") return value;
  logError(`${cmd}: --env must be 'development' or 'production' (got '${value}')`);
  process.exit(1);
}

program
  .name("ionify")
  .description("Ionify – Instant, Intelligent, Unified Build Engine")
  .version("0.0.1");

program
  .command("dev")
  .description("Start Ionify development server")
  .option("-p, --port <port>", "Port to run the server on", "5173")
  .option("-m, --mode <mode>", "Environment mode, loads .env.<mode> file (default: development)")
  .option("--hydrate", "Hydrate deps from Ionify Cloud CDC before starting (Tier-2)")
  .option("--hydrate-tier1", "Also hydrate Tier-1 source transforms before starting")
  .option("--namespace <name>", "Tier-1 namespace for hydration (overrides config.cloud.namespace)")
  .option("--concurrency <n>", "Upload/download concurrency for cloud ops", parseInt)
  .action(async (options) => {
    try {
      if (options.hydrate || options.hydrateTier1) {
        await runHydrateCommand({
          tier1: !!options.hydrateTier1,
          tier2: !options.hydrateTier1 || !!options.hydrate,
          namespace: options.namespace,
          concurrency: options.concurrency,
        });
      }
      const port = parseInt(options.port, 10);
      await startDevServer({ port, mode: options.mode });
    } catch (err) {
      logError("Failed to start dev server", err);
      process.exit(1);
    }
  });

program
  .command("build")
  .description("Create production build using Ionify bundler")
  .option("-o, --out-dir <dir>", "Output directory", "dist")
  .option("-m, --mode <mode>", "Environment mode, loads .env.<mode> while keeping production build semantics")
  .option("--push", "Push artifacts to Ionify Cloud after build (Tier-1 + Tier-2 by default)")
  .option("--tier1", "With --push: push only Tier-1 (source transforms)")
  .option("--tier2", "With --push: push only Tier-2 (CDC deps cache)")
  .option("--hydrate", "Hydrate Tier-2 deps from cloud before building")
  .option("--hydrate-tier1", "Also hydrate Tier-1 source transforms before building")
  .option("--namespace <name>", "Tier-1 namespace name (overrides config.cloud.namespace)")
  .option("--concurrency <n>", "Upload/download concurrency for cloud ops", parseInt)
  .action(async (options) => {
    try {
      if (options.mode) {
        process.env.MODE = options.mode;
        process.env.IONIFY_MODE = options.mode;
      }
      if (options.hydrate || options.hydrateTier1) {
        await runHydrateCommand({
          tier1: !!options.hydrateTier1,
          tier2: !options.hydrateTier1 || !!options.hydrate,
          namespace: options.namespace,
          concurrency: options.concurrency,
        });
      }
      await runBuildCommand({ outDir: options.outDir, mode: options.mode });
      if (options.push) {
        await runPushCommand({
          tier1: !!options.tier1,
          tier2: !!options.tier2,
          concurrency: options.concurrency,
          namespace: options.namespace,
        });
      }
    } catch {
      process.exit(1);
    }
  });

program
  .command("publish")
  .description("Publish production contracts or artifacts into .ionify without writing build output")
  .option("-m, --mode <mode>", "Environment mode, loads .env.<mode> while keeping production publication semantics")
  .option("--contracts", "Publish Production Contracts (graph, plan, dependency contracts, transform artifacts)")
  .option("--artifacts", "Publish Production Artifacts (contracts plus chunk artifacts)")
  .addOption(new Option("--phase <phase>", "Internal compatibility alias: A/contracts or B/artifacts").hideHelp())
  .action(async (options) => {
    try {
      await runPublishCommand({
        mode: options.mode,
        phase: options.phase,
        contracts: !!options.contracts,
        artifacts: !!options.artifacts,
      });
    } catch {
      process.exit(1);
    }
  });

program
  .command("push")
  .description("Push build artifacts to Ionify Cloud (Tier-1 + Tier-2 by default)")
  .option("--tier1", "Push only Tier-1 (source transform blobs + manifest)")
  .option("--tier2", "Push only Tier-2 (CDC deps cache session)")
  .option("--namespace <name>", "Tier-1 namespace name (overrides config.cloud.namespace)")
  .option("--env <env>", "Restrict push to a single env (development|production); default: every verified env on disk")
  .option("--concurrency <n>", "Upload concurrency", parseInt)
  .action(async (options) => {
    try {
      const env = options.env ? validateEnvFlag("push", options.env) : undefined;
      await runPushCommand({
        tier1: !!options.tier1,
        tier2: !!options.tier2,
        namespace: options.namespace,
        concurrency: options.concurrency,
        env,
      });
    } catch (err) {
      logError("Push failed", err);
      process.exit(1);
    }
  });

program
  .command("optimize-all")
  .description("Fully optimize every dependency without starting dev or pushing")
  .option("--env <env>", "Env to optimize (development|production); default: NODE_ENV or development")
  .action(async (options) => {
    try {
      const env = options.env ? validateEnvFlag("optimize-all", options.env) : undefined;
      const { runOptimizeAllCommand } = await import("./commands/optimize-all.js");
      await runOptimizeAllCommand({ env });
    } catch (err) {
      logError("optimize-all failed", err);
      process.exit(1);
    }
  });

program
  .command("hydrate")
  .description("Hydrate artifacts from Ionify Cloud (Tier-1 + Tier-2 by default)")
  .option("--tier1", "Hydrate only Tier-1 (source transform blobs from manifest)")
  .option("--tier2", "Hydrate only Tier-2 (CDC deps cache)")
  .option("--namespace <name>", "Tier-1 namespace name (overrides config.cloud.namespace)")
  .option("--env <env>", "Env to hydrate (development|production); default: NODE_ENV or production")
  .option("--concurrency <n>", "Download concurrency", parseInt)
  .action(async (options) => {
    try {
      const env = options.env ? validateEnvFlag("hydrate", options.env) : undefined;
      await runHydrateCommand({
        tier1: !!options.tier1,
        tier2: !!options.tier2,
        namespace: options.namespace,
        concurrency: options.concurrency,
        env,
      });
    } catch (err) {
      logError("Hydrate failed", err);
      process.exit(1);
    }
  });

program
  .command("login")
  .description("Log in to Ionify Cloud (auth only; project binding is separate)")
  .option("--api <url>", "Ionify Cloud API URL", "https://api.ionify.cloud")
  .option("--token <token>", "Existing project token from the dashboard")
  .action(async (options) => {
    try {
      await runLoginCommand({
        apiUrl: options.api,
        token: options.token,
      });
    } catch (err) {
      logError("Login failed", err);
      process.exit(1);
    }
  });

program
  .command("bind")
  .description("Bind the current folder to an Ionify Cloud project")
  .requiredOption("--project <projectId>", "Project ID from the dashboard")
  .option("--api <url>", "Ionify Cloud API URL")
  .option("--slug <slug>", "Project slug/name used in the Fingerprint V1 hash")
  .option("--allow-local", "Create a local_unverified binding when no git remote exists")
  .action(async (options) => {
    try {
      await runBindCommand({
        projectId: options.project,
        apiUrl: options.api,
        slug: options.slug,
        allowLocal: !!options.allowLocal,
      });
    } catch (err) {
      logError("Bind failed", err);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show local binding and Ionify Cloud project status")
  .option("--json", "Print machine-readable status JSON")
  .action(async (options) => {
    try {
      await runStatusCommand({ json: !!options.json });
    } catch (err) {
      logError("Status failed", err);
      process.exit(1);
    }
  });

program
  .command("logout")
  .description("Log out from Ionify Cloud")
  .action(() => runLogoutCommand());

program
  .command("whoami")
  .description("Show current Ionify Cloud identity")
  .action(async () => {
    try {
      await runWhoamiCommand();
    } catch (err) {
      logError("whoami failed", err);
      process.exit(1);
    }
  });

program
  .command("migrate")
  .description("Convert a Vite project to Ionify (config + scripts), with backups + a report")
  .option("-f, --force", "Overwrite an existing ionify.config.ts (a .bak is kept)")
  .option("-C, --cwd <dir>", "Project directory to migrate (defaults to current directory)")
  .action(async (options) => {
    try {
      await runMigrateCommand({ cwd: options.cwd, force: !!options.force });
    } catch (err) {
      logError("Migration failed", err);
      process.exit(1);
    }
  });

program
  .command("add")
  .description("Add a copy-paste component to your project (shadcn-style, Ionify-native)")
  .argument("[component]", "Component name, e.g. button")
  .option("--list", "List available components")
  .option("-d, --dir <dir>", "Target directory", "src/components/ui")
  .option("-f, --force", "Overwrite if file exists")
  .action(async (component, options) => {
    try {
      await runAddCommand(component, {
        list: !!options.list,
        dir: options.dir,
        force: !!options.force,
      });
    } catch (err) {
      logError("Failed to add component", err);
      process.exit(1);
    }
  });

program
  .command("analyze")
  .description("Inspect graph, build, packs, routes, and Phase B analyzer findings")
  .option("--json", "Output summary as JSON")
  .option("--verbose", "Show full detailed analyzer sections after the summary")
  .option("--section <name>", "Focus on one section: graph, build, deps, packs, routes, findings")
  .option("-l, --limit <count>", "Limit list outputs", "10")
  .option("--top <count>", "Alias for --limit")
  .option("--graph", "Show graph summary")
  .option("--tree", "Include dependency tree in graph summary")
  .option("--deps", "Alias for --tree")
  .option("--build", "Show build manifest/build.stats summary")
  .option("--packs", "Show vendor-pack summary")
  .option("--routes", "Show route-hint summary")
  .option("--findings", "Show duplicate, bloat, and suggestion findings")
  .option("--deps-hash <hash>", "Pin analyzer pack summary to a specific depsHash")
  .option("--out-dir <dir>", "Build output directory to inspect", "dist")
  .action(async (options) => {
    try {
      const rawLimit = options.top ?? options.limit ?? "10";
      const limit = parseInt(rawLimit, 10);
      const section =
        typeof options.section === "string" && options.section.length > 0 ? options.section.toLowerCase() : undefined;
      if (section && !["graph", "build", "deps", "packs", "routes", "findings"].includes(section)) {
        throw new Error(`Invalid --section value "${options.section}"`);
      }
      await runAnalyzeCommand({
        json: !!options.json,
        verbose: !!options.verbose,
        section: section as any,
        limit: Number.isFinite(limit) ? limit : 10,
        graph: !!options.graph,
        tree: !!options.tree,
        deps: !!options.deps,
        build: !!options.build,
        packs: !!options.packs,
        routes: !!options.routes,
        findings: !!options.findings,
        depsHash: options.depsHash,
        outDir: options.outDir,
      });
    } catch (err) {
      logError("Analyzer failed", err);
      process.exit(1);
    }
  });

program.parse(process.argv);
