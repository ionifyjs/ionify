
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

import { Command } from "commander";
import { logInfo, logError } from "./utils/logger.js";
import { startDevServer } from "./commands/dev.js";
import { runAnalyzeCommand } from "./commands/analyze.js";
import { runBuildCommand } from "./commands/build.js";
import { runAddCommand } from "./commands/add.js";

const program = new Command();

program
  .name("ionify")
  .description("Ionify – Instant, Intelligent, Unified Build Engine")
  .version("0.0.1");

program
  .command("dev")
  .description("Start Ionify development server")
  .option("-p, --port <port>", "Port to run the server on", "5173")
  .option("-m, --mode <mode>", "Environment mode, loads .env.<mode> file (default: development)")
  .action(async (options) => {
    try {
      const port = parseInt(options.port, 10);
      await startDevServer({ port, mode: options.mode });
    } catch (err) {
      logError("Failed to start dev server", err);
      process.exit(1);
    }
  });

// Placeholder for future commands
program
  .command("build")
  .description("Create production build using Ionify bundler")
  .option("-o, --out-dir <dir>", "Output directory", "dist")
  .action(async (options) => {
    try {
      await runBuildCommand({ outDir: options.outDir });
    } catch {
      process.exit(1);
    }
  });

program
  .command("migrate")
  .description("Migrate from Vite/Rollup config (not implemented yet)")
  .action(() => logInfo("Migrate command coming soon..."));

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
