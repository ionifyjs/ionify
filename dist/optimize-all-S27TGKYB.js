#!/usr/bin/env node
import {
  logError,
  logInfo
} from "./chunk-SNACSSNX.js";
import "./chunk-FHXXO743.js";

// src/cli/commands/optimize-all.ts
async function runOptimizeAllCommand(options = {}) {
  const requestedEnv = options.env ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = requestedEnv;
  const previousIonifyNodeEnv = process.env.IONIFY_NODE_ENV;
  process.env.IONIFY_NODE_ENV = requestedEnv;
  try {
    logInfo(`[optimize-all] Optimizing every dep for env=${requestedEnv}\u2026`);
    const { runBuildCommand } = await import("./build-PWWFQJR6.js");
    await runBuildCommand({ depsOnly: true });
    logInfo(`[optimize-all] Done. .verified snapshot written for env=${requestedEnv}.`);
  } catch (err) {
    logError("[optimize-all] Failed", err);
    throw err;
  } finally {
    if (previousNodeEnv === void 0) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousIonifyNodeEnv === void 0) delete process.env.IONIFY_NODE_ENV;
    else process.env.IONIFY_NODE_ENV = previousIonifyNodeEnv;
  }
}
export {
  runOptimizeAllCommand
};
