#!/usr/bin/env node

// src/cli/utils/logger.ts
import chalk from "chalk";
function logInfo(message) {
  console.log(chalk.cyan(`[Ionify] ${message}`));
}
function logWarn(message) {
  console.warn(chalk.yellow(`[Ionify] ${message}`));
}
function logError(message, err) {
  console.error(chalk.red(`[Ionify] ${message}`));
  if (err) console.error(err);
}

export {
  logInfo,
  logWarn,
  logError
};
