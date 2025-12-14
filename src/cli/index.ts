
import { Command } from "commander";
import { logInfo, logError } from "./utils/logger.js";
import { startDevServer } from "./commands/dev.js";
import { runAnalyzeCommand } from "./commands/analyze.js";
import { runBuildCommand } from "./commands/build.js";

const program = new Command();

program
  .name("ionify")
  .description("Ionify – Instant, Intelligent, Unified Build Engine")
  .version("0.0.1");

program
  .command("dev")
  .description("Start Ionify development server")
  .option("-p, --port <port>", "Port to run the server on", "5173")
  .action(async (options) => {
    try {
      const port = parseInt(options.port, 10);
      await startDevServer({ port });
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
  .command("analyze")
  .description("Inspect cached dependency graph stats")
  .option("--json", "Output summary as JSON")
  .option("-l, --limit <count>", "Limit list outputs", "10")
  .action(async (options) => {
    try {
      const limit = parseInt(options.limit ?? "10", 10);
      await runAnalyzeCommand({ json: !!options.json, limit: Number.isFinite(limit) ? limit : 10 });
    } catch (err) {
      logError("Analyzer failed", err);
      process.exit(1);
    }
  });

program.parse(process.argv);
