import { Command } from "commander";
import { logInfo, logError } from "./utils/logger.js";
import { startDevServer } from "./commands/dev.js";
import { runBuildCommand } from "./commands/build.js";
import { runAnalyzeCommand } from "./commands/analyze.js";

const program = new Command();

program
  .name("ionify")
  .description("Ionify – Instant, Intelligent, Unified Build Engine")
  .version("0.1.0");

program
  .command("dev")
  .description("Start Ionify development server")
  .option("-p, --port <port>", "Port to run the server on", "5173")
  .action(async (options) => {
    try {
      await startDevServer(options);
    } catch (err: any) {
      logError(`Dev server failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command("build")
  .description("Build for production")
  .option("-o, --outDir <dir>", "Output directory", "dist")
  .option("-l, --level <level>", "Optimization level (0-4)", "3")
  .action(async (options) => {
    try {
      await runBuildCommand(options);
    } catch (err: any) {
      logError(`Build failed: ${err.message}`);
      process.exit(1);
    }
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
