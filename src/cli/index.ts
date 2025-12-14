import { Command } from "commander";
import { logInfo, logError } from "./utils/logger.js";
import { runAnalyzeCommand } from "./commands/analyze.js";

const program = new Command();

program
  .name("ionify")
  .description("Ionify – Instant, Intelligent, Unified Build Engine")
  .version("0.1.0");

program
  .command("dev")
  .description("Start Ionify development server (coming in full release)")
  .option("-p, --port <port>", "Port to run the server on", "5173")
  .action(async () => {
    logError("Dev server is not available in this release. Stay tuned!");
    process.exit(1);
  });

program
  .command("build")
  .description("Build for production (coming in full release)")
  .option("-o, --outDir <dir>", "Output directory", "dist")
  .option("-l, --level <level>", "Optimization level (0-4)", "3")
  .action(async () => {
    logError("Build command is not available in this release. Stay tuned!");
    process.exit(1);
  });

program
  .command("analyze")
  .description("Analyze bundle and performance")
  .option("-f, --format <format>", "Output format (json|text)", "text")
  .action(async (options) => {
    try {
      await runAnalyzeCommand(options);
    } catch (err: any) {
      logError(`Analyzer failed: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
