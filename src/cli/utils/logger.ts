
import chalk from "chalk";

export function logInfo(message: string) {
  console.log(chalk.cyan(`[Ionify] ${message}`));
}

export function logWarn(message: string) {
  console.warn(chalk.yellow(`[Ionify] ${message}`));
}

export function logError(message: string, err?: unknown) {
  console.error(chalk.red(`[Ionify] ${message}`));
  if (err) console.error(err);
}
