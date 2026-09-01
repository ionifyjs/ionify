/**
{
  "description": "Utility for loading, validating, and merging user ionify.config.ts files. Provides default values for missing fields.",
  "phase": 0,
  "todo": [
    "Implement loadConfig() to read ionify.config.ts.",
    "Add schema validation for core fields (entry, output, alias).",
    "Merge user config with defaults.",
    "Expose getConfig() for CLI commands."
  ]
}
*/

import fs from "fs";
import path from "path";
import type { IonifyConfig } from "../../types/config";
import { logError, logInfo, logWarn } from "./logger.js";
import { configureResolverAliases, resetResolverAliasCache } from "@core/resolver";
import { loadEnv as loadIonifyEnv, type EnvRecord } from "@cli/utils/env";
import { importNativeConfigModule } from "@cli/utils/native-config-loader";

const CONFIG_BASENAMES = [
  "ionify.config.ts",
  "ionify.config.mts",
  "ionify.config.js",
  "ionify.config.mjs",
  "ionify.config.cjs",
];

let cachedConfig: IonifyConfig | null = null;
let configLoaded = false;

function resolveConfigMode(mode?: string): string {
  return mode || process.env.MODE || process.env.IONIFY_MODE || process.env.NODE_ENV || "development";
}

function buildConfigEnv(mode: string, rootDir: string): EnvRecord {
  const env = loadIonifyEnv(mode, rootDir);
  const merged: EnvRecord = {
    ...env,
    MODE: mode,
  };
  if (typeof process.env.NODE_ENV === "string") {
    merged.NODE_ENV = process.env.NODE_ENV;
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (key.startsWith("VITE_") || key.startsWith("IONIFY_")) {
      merged[key] = value;
    }
  }
  return merged;
}

function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 15; i++) {
    const pkg = path.join(dir, "package.json");
    try {
      if (fs.existsSync(pkg) && fs.statSync(pkg).isFile()) return dir;
    } catch {
      // ignore
    }
    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}

function findConfigFile(cwd: string): string | null {
  for (const name of CONFIG_BASENAMES) {
    const candidate = path.resolve(cwd, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

export async function loadIonifyConfig(cwd = process.cwd(), mode?: string): Promise<IonifyConfig | null> {
  if (configLoaded) return cachedConfig;
  configLoaded = true;
  const configMode = resolveConfigMode(mode);

  const configPath = findConfigFile(cwd);
  if (!configPath) {
    // No config file: default root should still be deterministic and not depend on
    // where the user runs the command from inside the project.
    const projectRoot = findProjectRoot(cwd) ?? cwd;
    cachedConfig = { root: projectRoot };
    configureResolverAliases(undefined, projectRoot);
    delete process.env.IONIFY_RESOLVE_ALIAS;
    delete process.env.IONIFY_BROWSER_BUILTIN_FALLBACK;
    delete process.env.IONIFY_BROWSER_RUNTIME_GLOBALS;
    return cachedConfig;
  }

  try {
    const configDir = path.dirname(configPath);
    const configEnv = buildConfigEnv(configMode, configDir);
    const imported = await importNativeConfigModule(configPath) as any;
    // Support both default export and module export patterns.
    let resolved: IonifyConfig | null | any =
      imported?.default ?? imported?.config ?? imported ?? null;
    
    // If the config is a function (from defineConfig), call it
    if (resolved && typeof resolved === 'function') {
      resolved = resolved({ mode: configMode, env: configEnv });
    }
    
    if (resolved && typeof (resolved as unknown as Promise<unknown>)?.then === "function") {
      resolved = await (resolved as unknown as Promise<IonifyConfig>);
    }
    if (resolved && typeof resolved === "object") {
      // Phase 5.4.2: Normalize and validate root option
      if (resolved.root) {
        const rootPath = path.isAbsolute(resolved.root) 
          ? resolved.root 
          : path.resolve(path.dirname(configPath), resolved.root);
        
        if (!fs.existsSync(rootPath)) {
          logError(`Config error: root directory does not exist: ${rootPath}`);
          throw new Error(`Invalid root: ${rootPath}`);
        }
        
        if (!fs.statSync(rootPath).isDirectory()) {
          logError(`Config error: root must be a directory: ${rootPath}`);
          throw new Error(`Invalid root: ${rootPath}`);
        }
        
        resolved.root = rootPath;
        logInfo(`Using project root: ${path.relative(cwd, rootPath)}`);
      } else {
        // Default to config file's directory (or cwd if no config)
        resolved.root = path.dirname(configPath);
      }
      
      // Phase 5.4.2: Warn about unsupported esbuildOptions
      if (resolved.optimizeDeps?.esbuildOptions) {
        logWarn("optimizeDeps.esbuildOptions is not supported in Ionify (uses native Rust optimizer). This option will be ignored.");
      }
      
      cachedConfig = resolved;
      const baseDir =
        typeof resolved.root === "string" && resolved.root.length > 0 ? resolved.root : path.dirname(configPath);
      const aliases = resolved?.resolve?.alias;
      if (aliases && typeof aliases === "object") {
        configureResolverAliases(aliases, baseDir);
        try {
          process.env.IONIFY_RESOLVE_ALIAS = JSON.stringify(aliases);
        } catch {
          delete process.env.IONIFY_RESOLVE_ALIAS;
        }
      } else {
        configureResolverAliases(undefined, baseDir);
        delete process.env.IONIFY_RESOLVE_ALIAS;
      }
      const builtinFallback = resolved?.resolve?.builtinFallback;
      if (builtinFallback && typeof builtinFallback === "object" && !Array.isArray(builtinFallback)) {
        process.env.IONIFY_BROWSER_BUILTIN_FALLBACK = JSON.stringify(builtinFallback);
      } else {
        delete process.env.IONIFY_BROWSER_BUILTIN_FALLBACK;
      }
      const runtimeGlobals = resolved?.resolve?.runtimeGlobals;
      if (runtimeGlobals && typeof runtimeGlobals === "object" && !Array.isArray(runtimeGlobals)) {
        process.env.IONIFY_BROWSER_RUNTIME_GLOBALS = JSON.stringify(runtimeGlobals);
      } else {
        delete process.env.IONIFY_BROWSER_RUNTIME_GLOBALS;
      }
      logInfo(`Loaded ionify config from ${path.relative(cwd, configPath)}`);
    } else {
      throw new Error("Config did not export an object");
    }
  } catch (err) {
    logError("Failed to load ionify.config", err);
    cachedConfig = null;
    configureResolverAliases(undefined, cwd);
    delete process.env.IONIFY_RESOLVE_ALIAS;
    delete process.env.IONIFY_BROWSER_BUILTIN_FALLBACK;
    delete process.env.IONIFY_BROWSER_RUNTIME_GLOBALS;
  }
  return cachedConfig;
}

export function getCachedConfig(): IonifyConfig | null {
  return cachedConfig;
}

export function resetIonifyConfigCache() {
  cachedConfig = null;
  configLoaded = false;
  resetResolverAliasCache();
}



// ===== Next Phase TODOs =====
// Phase 4: Add migration hints for Vite/Rollup configs.
// Phase 5: Add Analyzer configuration hooks.
