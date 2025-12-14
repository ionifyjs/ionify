import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { build } from "esbuild";
import type { IonifyConfig } from "../../types/config";
import { logError, logInfo } from "./logger.js";
import { configureResolverAliases, resetResolverAliasCache } from "@core/resolver";

const CONFIG_BASENAMES = [
  "ionify.config.ts",
  "ionify.config.mts",
  "ionify.config.js",
  "ionify.config.mjs",
  "ionify.config.cjs",
];

let cachedConfig: IonifyConfig | null = null;
let configLoaded = false;

// Bundle the config file into a single ESM string that can be `import()`ed.
async function bundleConfig(entry: string) {
  const absDir = path.dirname(entry);
  
  // Create a plugin to inline the ionify module exports (defineConfig)
  const inlineIonifyPlugin = {
    name: 'inline-ionify',
    setup(build: any) {
      build.onResolve({ filter: /^ionify$/ }, () => ({
        path: 'ionify-virtual',
        namespace: 'ionify-ns'
      }));
      build.onLoad({ filter: /.*/, namespace: 'ionify-ns' }, () => ({
        contents: `
          export function defineConfig(config) {
            return typeof config === 'function' ? config : () => config;
          }
        `,
        loader: 'js'
      }));
    }
  };
  
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: "inline",
    write: false,
    target: "node18",
    logLevel: "silent",
    absWorkingDir: absDir,
    plugins: [inlineIonifyPlugin],
  });
  const output = result.outputFiles?.[0];
  if (!output) throw new Error("Failed to bundle ionify config");
  const dirnameLiteral = JSON.stringify(absDir);
  const filenameLiteral = JSON.stringify(entry);
  const importMetaLiteral = JSON.stringify(pathToFileURL(entry).href);

  let contents = output.text;
  if (contents.includes("import.meta.url")) {
    contents = contents.replace(/import\.meta\.url/g, "__IONIFY_IMPORT_META_URL");
    contents = `const __IONIFY_IMPORT_META_URL = ${importMetaLiteral};\n${contents}`;
  }
  const preamble =
    `const __dirname = ${dirnameLiteral};\n` +
    `const __filename = ${filenameLiteral};\n`;
  return preamble + contents;
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

export async function loadIonifyConfig(cwd = process.cwd()): Promise<IonifyConfig | null> {
  if (configLoaded) return cachedConfig;
  configLoaded = true;

  const configPath = findConfigFile(cwd);
  if (!configPath) {
    cachedConfig = null;
    configureResolverAliases(undefined, cwd);
    return cachedConfig;
  }

  try {
    const bundled = await bundleConfig(configPath);
    const dataUrl = `data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`;
    const imported = await import(dataUrl);
    // Support both default export and module export patterns.
    let resolved: IonifyConfig | null | any =
      imported?.default ?? imported?.config ?? imported ?? null;
    
    // If the config is a function (from defineConfig), call it
    if (resolved && typeof resolved === 'function') {
      resolved = resolved({ mode: process.env.NODE_ENV || 'development' });
    }
    
    if (resolved && typeof (resolved as unknown as Promise<unknown>)?.then === "function") {
      resolved = await (resolved as unknown as Promise<IonifyConfig>);
    }
    if (resolved && typeof resolved === "object") {
      cachedConfig = resolved;
      const baseDir = path.dirname(configPath);
      const aliases = resolved?.resolve?.alias;
      if (aliases && typeof aliases === "object") {
        configureResolverAliases(aliases, baseDir);
      } else {
        configureResolverAliases(undefined, baseDir);
      }
      logInfo(`Loaded ionify config from ${path.relative(cwd, configPath)}`);
    } else {
      throw new Error("Config did not export an object");
    }
  } catch (err) {
    logError("Failed to load ionify.config", err);
    cachedConfig = null;
    configureResolverAliases(undefined, cwd);
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



