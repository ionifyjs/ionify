const { parentPort } = require("worker_threads");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const postcss = require("postcss");
const postcssLoadConfig = require("postcss-load-config");
const postcssModules = require("postcss-modules");

let cachedPostcssConfig = null;
let postcssConfigFailed = false;

/** Cache pipelineHash per (rootDir + isModule) key — stable for the worker's lifetime. */
const pipelineHashCache = new Map();

let swcTransform = null;
function getSwcTransform() {
  if (swcTransform) return swcTransform;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("@swc/core");
  swcTransform = mod?.transform || null;
  if (!swcTransform) {
    throw new Error("@swc/core transform not available");
  }
  return swcTransform;
}

async function loadPostcssConfig(rootDir) {
  if (cachedPostcssConfig) return cachedPostcssConfig;
  if (postcssConfigFailed) return { plugins: [], options: {} };
  try {
    const result = await postcssLoadConfig({}, rootDir);
    const plugins = result?.plugins;
    const options = result?.options;
    const configFile = typeof result?.file === "string" ? result.file : null;
    cachedPostcssConfig = {
      plugins: Array.isArray(plugins) ? plugins : [],
      options: options ?? {},
      configFile,
    };
  } catch {
    postcssConfigFailed = true;
    cachedPostcssConfig = { plugins: [], options: {}, configFile: null };
  }
  return cachedPostcssConfig;
}

const enableSourceMaps = process.env.IONIFY_SOURCEMAPS === "true";

function parseMode() {
  const mode = (process.env.IONIFY_PARSER || "hybrid").toLowerCase();
  if (mode === "swc") return "swc";
  if (mode === "oxc") return "oxc";
  return "hybrid";
}

function resolveNativeBinding() {
  // Minimal loader to avoid importing TS helpers in worker context.
  const cwd = process.cwd();
  const candidates = [];

  // 1) Installed package / linked workspace: resolve relative to this file's location.
  const findPackageRoot = (startDir) => {
    let dir = startDir;
    for (let i = 0; i < 8; i++) {
      const pkgPath = path.join(dir, "package.json");
      try {
        if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isFile()) return dir;
      } catch {
        // ignore
      }
      const parent = path.dirname(dir);
      if (!parent || parent === dir) break;
      dir = parent;
    }
    return null;
  };

  const packageRoot = findPackageRoot(__dirname);
  if (packageRoot) {
    candidates.push(path.join(packageRoot, "native", "ionify_core.node"));
    candidates.push(path.join(packageRoot, "dist", "ionify_core.node"));
    candidates.push(path.join(packageRoot, "ionify_core.node"));
  }

  // 2) Development layouts (when running from repo root).
  candidates.push(path.join(cwd, "native", "ionify_core.node"));
  candidates.push(path.join(cwd, "target", "release", "ionify_core.node"));
  candidates.push(path.join(cwd, "target", "debug", "ionify_core.node"));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(candidate);
      }
    } catch {
      // ignore and try next
    }
  }
  return null;
}

const native = resolveNativeBinding();

function stablePluginName(plugin) {
  if (!plugin || typeof plugin !== "function") return "unknown";
  if (typeof plugin.postcssPlugin === "string" && plugin.postcssPlugin.length) return plugin.postcssPlugin;
  if (typeof plugin.name === "string" && plugin.name.length) return plugin.name;
  return "anonymous";
}

function sortObjectKeys(value) {
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = value[key];
  }
  return out;
}

function resolveCssSpecifier(spec, filePath, rootDir) {
  const trimmed = String(spec || "").trim();
  if (!trimmed) return null;
  if (/^(data:|https?:|\/\/)/i.test(trimmed)) return null;
  if (trimmed.startsWith("/")) {
    return path.resolve(rootDir, "." + trimmed);
  }
  return path.resolve(path.dirname(filePath), trimmed);
}

function discoverUrlDeps(css, filePath, rootDir) {
  const deps = [];
  const seen = new Set();
  const urlRe = /url\(\s*(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)/gi;
  let match;
  while ((match = urlRe.exec(css))) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    const resolved = resolveCssSpecifier(spec, filePath, rootDir);
    if (!resolved) continue;
    const norm = resolved.replace(/\\+/g, "/");
    if (seen.has(norm)) continue;
    seen.add(norm);
    deps.push(resolved);
  }
  return deps;
}

function computePipelineHash({ rootDir, modules, plugins, options, configFile }) {
  const pluginNames = Array.isArray(plugins) ? plugins.map(stablePluginName).filter(Boolean).sort() : [];
  let configFileHash = null;
  let configFileId = null;
  if (configFile && fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile);
      configFileHash = crypto.createHash("sha256").update(raw).digest("hex");
      const abs = path.resolve(configFile);
      const rel = path.relative(rootDir, abs).replace(/\\+/g, "/");
      configFileId = rel && !rel.startsWith("../") ? rel : path.basename(abs);
    } catch {
      configFileHash = null;
    }
  }

  const normalizedOptions = {
    map: options?.map ?? null,
  };

  const payload = JSON.stringify({
    schema: "ionify:css-pipeline:v1",
    configFile: configFileId,
    configFileHash,
    pluginNames,
    options: normalizedOptions,
    modules: modules ? 1 : 0,
    modulesOptions: null,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function runSwcTransform(job) {
  const isTs = job.ext === ".ts" || job.ext === ".tsx";
  const isTsx = job.ext === ".tsx";
  const isJsx = job.ext === ".jsx";

  const transform = getSwcTransform();
  const result = await transform(job.code, {
    filename: job.filePath,
    sourceMaps: enableSourceMaps ? "inline" : false,
    module: { type: "es6" },
    jsc: {
      target: "es2022",
      parser: isTs
        ? {
            syntax: "typescript",
            tsx: isTsx,
            decorators: true,
            dynamicImport: true,
          }
        : {
            syntax: "ecmascript",
            jsx: isJsx,
            decorators: true,
            dynamicImport: true,
          },
      transform: isTsx || isJsx
        ? {
            react: {
              development: false,
              runtime: "automatic",
            },
          }
        : undefined,
    },
  });

  return { code: result.code, map: result.map || undefined, type: "js" };
}

async function runCssTransform(job) {
  const rootDir = process.env.IONIFY_PROJECT_ROOT || process.cwd();
  const { plugins, options, configFile } = await loadPostcssConfig(rootDir);
  const isModule = /\.module\.css$/i.test(job.filePath);

  const pipeline = [...plugins];
  const deps = [];
  const urlDeps = [];
  const seenDeps = new Set();
  const seenUrlDeps = new Set();

  const addDep = (p) => {
    if (!p) return;
    const norm = p.replace(/\\+/g, "/");
    if (seenDeps.has(norm)) return;
    seenDeps.add(norm);
    deps.push(p);
  };
  const addUrlDep = (p) => {
    if (!p) return;
    const norm = p.replace(/\\+/g, "/");
    if (seenUrlDeps.has(norm)) return;
    seenUrlDeps.add(norm);
    urlDeps.push(p);
  };

  if (configFile) addDep(configFile);

  let tokens = null;
  if (isModule) {
    pipeline.push(
      postcssModules({
        generateScopedName: (name, filename) => {
          const relative = path.relative(rootDir, filename || job.filePath).replace(/\\+/g, "/");
          const seed = crypto.createHash("sha1").update(relative).digest("hex").slice(0, 6);
          return `${name}___${seed}`;
        },
        getJSON(_filename, json) {
          tokens = sortObjectKeys(json);
        },
      })
    );
  }

  const runner = postcss(pipeline);
  const result = await runner.process(job.code, {
    ...options,
    from: job.filePath,
    map: false,
  });

  // PostCSS plugin dependency messages (e.g. postcss-import, tailwind, etc.)
  for (const message of result.messages || []) {
    const anyMsg = message;
    if (anyMsg && anyMsg.type === "dependency" && typeof anyMsg.file === "string") {
      addDep(anyMsg.file);
    }
  }

  // Lightweight @import discovery (covers plain CSS without postcss-import plugin)
  const importRe = /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)?[^;]*;/gi;
  let match;
  while ((match = importRe.exec(job.code))) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    const resolved = resolveCssSpecifier(spec, job.filePath, rootDir);
    if (resolved) addDep(resolved);
  }

  for (const dep of discoverUrlDeps(result.css, job.filePath, rootDir)) {
    addUrlDep(dep);
  }

  const pipelineHashKey = `${rootDir}:${isModule ? 1 : 0}`;
  let pipelineHash = pipelineHashCache.get(pipelineHashKey);
  if (!pipelineHash) {
    pipelineHash = computePipelineHash({
      rootDir,
      modules: isModule,
      plugins,
      options,
      configFile,
    });
    pipelineHashCache.set(pipelineHashKey, pipelineHash);
  }

  return { code: result.css, type: "css", tokens, deps, urlDeps, pipelineHash };
}

function runNativeOxcTransform(job) {
  if (!native?.parseAndTransformOxc) {
    throw new Error("Native oxc transform not available");
  }
  
  const result = native.parseAndTransformOxc(job.code, {
    filename: job.filePath,
    jsx: job.ext === ".jsx" || job.ext === ".tsx",
    typescript: job.ext === ".ts" || job.ext === ".tsx",
    react_refresh: false, // Production build - no refresh
  });
  
  return { code: result.code, map: result.map || undefined, type: "js" };
}

function runNativeSwcTransform(job) {
  if (!native?.parseAndTransformSwc) {
    throw new Error("Native SWC transform not available");
  }
  
  const result = native.parseAndTransformSwc(job.code, {
    filename: job.filePath,
    jsx: job.ext === ".jsx" || job.ext === ".tsx",
    typescript: job.ext === ".ts" || job.ext === ".tsx",
    react_refresh: false, // Production build - no refresh
  });
  
  return { code: result.code, map: result.map || undefined, type: "js" };
}

async function handleJob(job) {
  const mode = parseMode();
  const ext = job.ext.toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    if (mode === "swc") {
      // Force SWC via native or fallback
      if (native?.parseAndTransformSwc) {
        return runNativeSwcTransform(job);
      }
      return runSwcTransform(job);
    }
    if (mode === "oxc") {
      // Force oxc via native (fail if unavailable)
      if (!native?.parseAndTransformOxc) {
        throw new Error("parser=oxc requires native binding");
      }
      return runNativeOxcTransform(job);
    }
    // hybrid: try native oxc, silent fallback to native swc or JS swc
    if (native?.parseAndTransformOxc) {
      try {
        return runNativeOxcTransform(job);
      } catch {
        // Silent fallback
      }
    }
    if (native?.parseAndTransformSwc) {
      return runNativeSwcTransform(job);
    }
    // Last resort: JS-side SWC
    return runSwcTransform(job);
  }
  if (ext === ".css") {
    return runCssTransform(job);
  }
  return { code: job.code, type: "asset" };
}

parentPort.on("message", async (job) => {
  try {
    const result = await handleJob(job);
    parentPort.postMessage({
      id: job.id,
      filePath: job.filePath,
      code: result.code,
      map: result.map,
      type: result.type,
      tokens: result.tokens,
      deps: result.deps,
      urlDeps: result.urlDeps,
      pipelineHash: result.pipelineHash,
    });
  } catch (err) {
    parentPort.postMessage({
      id: job.id,
      filePath: job.filePath,
      code: job.code,
      type: "asset",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
