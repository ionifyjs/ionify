const { parentPort } = require("worker_threads");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createRequire } = require("module");
const { pathToFileURL, fileURLToPath } = require("url");
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
  // Keep this CJS worker selector in lockstep with src/native/native-loader.ts.
  // Selection is exact; it never probes a binary built for another target.
  const packageByTarget = {
    "darwin-arm64": "@ionify/ionify-darwin-arm64",
    "darwin-x64": "@ionify/ionify-darwin-x64",
  };
  const target = `${process.platform}-${process.arch}`;
  const packageName = packageByTarget[target];
  if (!packageName) {
    const error = new Error([
      `[Ionify] Unsupported native platform: ${target}.`,
      `Supported platforms: ${Object.keys(packageByTarget).join(", ")}.`,
      "Ionify did not attempt to load a binary for another platform.",
    ].join("\n"));
    error.name = "IonifyNativeBindingError";
    error.code = "IONIFY_UNSUPPORTED_NATIVE_PLATFORM";
    throw error;
  }

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
  let privateBinding = null;
  if (packageRoot) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
      if (packageJson.name === "ionify" && packageJson.private === true) {
        const candidate = path.join(packageRoot, "native", "ionify_core.node");
        if (fs.statSync(candidate).isFile()) privateBinding = candidate;
      }
    } catch {
      // A public installation has no private source-checkout fallback.
    }
  }

  try {
    return require(packageName);
  } catch (selectedError) {
    const selectedMissing = selectedError?.code === "MODULE_NOT_FOUND"
      && String(selectedError?.message ?? selectedError).includes(packageName);
    if (privateBinding && selectedMissing) {
      try {
        return require(privateBinding);
      } catch (privateError) {
        const error = new Error([
          `[Ionify] Failed to load the native binding for ${target}.`,
          `Selected package: ${privateBinding}`,
          `Original Node error: ${privateError?.name ?? "Error"}: ${privateError?.message ?? privateError}`,
        ].join("\n"));
        error.name = "IonifyNativeBindingError";
        error.code = "IONIFY_NATIVE_DLOPEN_FAILED";
        error.cause = privateError;
        throw error;
      }
    }

    const guidance = selectedMissing
      ? [
        "The platform package was not installed. Optional dependencies may have been omitted or the install may be incomplete.",
        "Reinstall @ionify/ionify without --omit=optional / --no-optional.",
      ]
      : ["The selected package exists, but Node could not load its native addon."];
    const error = new Error([
      `[Ionify] Failed to load the native binding for ${target}.`,
      `Selected package: ${packageName}`,
      ...guidance,
      `Original Node error: ${selectedError?.name ?? "Error"}: ${selectedError?.message ?? selectedError}`,
    ].join("\n"));
    error.name = "IonifyNativeBindingError";
    error.code = selectedMissing ? "IONIFY_NATIVE_PACKAGE_MISSING" : "IONIFY_NATIVE_DLOPEN_FAILED";
    error.cause = selectedError;
    throw error;
  }
}

const native = resolveNativeBinding();

function stablePluginName(plugin) {
  if (!plugin || typeof plugin !== "function") return "unknown";
  if (typeof plugin.postcssPlugin === "string" && plugin.postcssPlugin.length) return plugin.postcssPlugin;
  if (typeof plugin.name === "string" && plugin.name.length) return plugin.name;
  return "anonymous";
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function addTiming(timings, label, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  timings.set(label, (timings.get(label) || 0) + ms);
}

function labelPostcssPlugin(plugin, index) {
  if (plugin && typeof plugin.postcssPlugin === "string" && plugin.postcssPlugin.length) return plugin.postcssPlugin;
  if (plugin && typeof plugin.name === "string" && plugin.name.length) return plugin.name;
  return `postcss-plugin-${index}`;
}

function timeMaybePromise(timings, label, started, value) {
  if (value && typeof value.then === "function") {
    return value.finally(() => addTiming(timings, label, nowMs() - started));
  }
  addTiming(timings, label, nowMs() - started);
  return value;
}

function wrapPostcssVisitorObject(visitor, label, timings) {
  if (!visitor || typeof visitor !== "object") return visitor;
  const out = Array.isArray(visitor) ? [...visitor] : { ...visitor };
  for (const key of Object.keys(out)) {
    if (key === "postcssPlugin") continue;
    const value = out[key];
    if (typeof value === "function") {
      out[key] = function timedPostcssVisitor(...args) {
        const started = nowMs();
        const result = value.apply(this, args);
        if (key === "prepare" && result && typeof result === "object" && typeof result.then !== "function") {
          addTiming(timings, label, nowMs() - started);
          return wrapPostcssVisitorObject(result, label, timings);
        }
        if (key === "prepare" && result && typeof result.then === "function") {
          return result.then((prepared) => {
            addTiming(timings, label, nowMs() - started);
            return wrapPostcssVisitorObject(prepared, label, timings);
          });
        }
        return timeMaybePromise(timings, label, started, result);
      };
    } else if (value && typeof value === "object") {
      out[key] = wrapPostcssVisitorObject(value, label, timings);
    }
  }
  return out;
}

function wrapPostcssPluginsForTiming(plugins, timings) {
  return plugins.map((plugin, index) => {
    const label = labelPostcssPlugin(plugin, index);
    if (typeof plugin === "function") {
      const wrapped = function timedPostcssPlugin(...args) {
        const started = nowMs();
        const result = plugin.apply(this, args);
        if (result && typeof result === "object" && typeof result.then !== "function") {
          addTiming(timings, label, nowMs() - started);
          return wrapPostcssVisitorObject(result, label, timings);
        }
        if (result && typeof result.then === "function") {
          return result.then((prepared) => {
            addTiming(timings, label, nowMs() - started);
            return wrapPostcssVisitorObject(prepared, label, timings);
          });
        }
        return timeMaybePromise(timings, label, started, result);
      };
      Object.assign(wrapped, plugin);
      return wrapped;
    }
    return wrapPostcssVisitorObject(plugin, label, timings);
  });
}

function classifyPostcssPluginTimings(timings) {
  const out = {
    tailwindPluginMs: 0,
    autoprefixerPluginMs: 0,
    rtlcssPluginMs: 0,
    otherPostcssPluginMs: 0,
  };
  for (const [label, ms] of Object.entries(timings)) {
    const normalized = label.toLowerCase();
    if (normalized.includes("tailwind")) out.tailwindPluginMs += ms;
    else if (normalized.includes("autoprefixer") || normalized === "plugin") out.autoprefixerPluginMs += ms;
    else if (normalized.includes("rtlcss")) out.rtlcssPluginMs += ms;
    else out.otherPostcssPluginMs += ms;
  }
  return out;
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
  if (trimmed.startsWith("@/")) return path.resolve(rootDir, "src", trimmed.slice(2));
  if (trimmed.startsWith(".") || trimmed.startsWith("..")) return path.resolve(path.dirname(filePath), trimmed);
  const specifier = trimmed.startsWith("~") ? trimmed.slice(1) : trimmed;
  try {
    return createRequire(filePath).resolve(specifier);
  } catch {
    return path.resolve(path.dirname(filePath), trimmed);
  }
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

const POSTCSS_DIR_DEPENDENCY_MAX_FILES = 5000;

function normalizeDependencyPath(depPath, rootDir, fromFile) {
  const value = String(depPath || "").trim();
  if (!value) return null;
  if (/^(?:data:|https?:|\/\/)/i.test(value)) return null;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(path.dirname(fromFile) || rootDir, value);
}

function globToRegExp(glob) {
  const normalized = String(glob || "**/*").replace(/\\+/g, "/").replace(/^\.\//, "");
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    if (ch === "{") {
      const end = normalized.indexOf("}", i + 1);
      if (end !== -1) {
        const body = normalized.slice(i + 1, end);
        const parts = body.split(",").map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"));
        out += `(?:${parts.join("|")})`;
        i = end;
        continue;
      }
    }
    out += ch.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  out += "$";
  return new RegExp(out);
}

function expandDirectoryDependency(dir, glob) {
  const deps = [];
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return deps;
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) return stat.isFile() ? [root] : deps;
  const re = globToRegExp(glob || "**/*");
  const visit = (current) => {
    if (deps.length >= POSTCSS_DIR_DEPENDENCY_MAX_FILES) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (deps.length >= POSTCSS_DIR_DEPENDENCY_MAX_FILES) return;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".ionify" || entry.name === "dist") {
        continue;
      }
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, abs).replace(/\\+/g, "/");
      if (re.test(rel)) deps.push(abs);
    }
  };
  visit(root);
  return deps;
}

function collectPostcssMessageDeps(messages, rootDir, filePath, tailwindGraphFiles = null) {
  const deps = [];
  const seen = new Set();
  const add = (depPath, plugin) => {
    if (!depPath) return;
    const normalized = path.resolve(depPath).replace(/\\+/g, "/");
    if (plugin === "tailwindcss" && tailwindGraphFiles && tailwindGraphFiles.has(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    deps.push(depPath);
  };

  for (const message of messages || []) {
    const msg = message;
    if (!msg || typeof msg !== "object") continue;
    if (
      (msg.type === "dependency" || msg.type === "build-dependency" || msg.type === "missing-dependency") &&
      typeof msg.file === "string"
    ) {
      add(normalizeDependencyPath(msg.file, rootDir, filePath), msg.plugin);
      continue;
    }
    if (msg.type === "dir-dependency" && typeof msg.dir === "string") {
      const baseDir = normalizeDependencyPath(msg.dir, rootDir, filePath);
      if (!baseDir) continue;
      for (const dep of expandDirectoryDependency(baseDir, typeof msg.glob === "string" ? msg.glob : null)) {
        add(dep, msg.plugin);
      }
      continue;
    }
    if (msg.type === "context-dependency") {
      const raw = typeof msg.dir === "string" ? msg.dir : typeof msg.file === "string" ? msg.file : null;
      const dep = raw ? normalizeDependencyPath(raw, rootDir, filePath) : null;
      if (!dep) continue;
      if (fs.existsSync(dep) && fs.statSync(dep).isDirectory()) {
        for (const child of expandDirectoryDependency(dep, typeof msg.glob === "string" ? msg.glob : null)) {
          add(child, msg.plugin);
        }
      } else {
        add(dep, msg.plugin);
      }
    }
  }

  return deps;
}

// ── Preprocessor pre-pass (mirror of src/core/loaders/css.ts — unified dev/build/worker, §8) ──
const CSS_LIKE_EXTENSIONS = [".css", ".scss", ".sass", ".less", ".styl"];
function isCssLikeExt(ext) {
  return CSS_LIKE_EXTENSIONS.includes(String(ext || "").toLowerCase());
}
function detectPreprocessorLang(filePath) {
  const ext = path.extname(String(filePath).split("?")[0].split("#")[0]).toLowerCase();
  if (ext === ".scss") return "scss";
  if (ext === ".sass") return "sass";
  if (ext === ".less") return "less";
  if (ext === ".styl" || ext === ".stylus") return "styl";
  return null;
}
let cachedPreprocessorOptions;
function getPreprocessorOptions() {
  if (cachedPreprocessorOptions !== undefined) return cachedPreprocessorOptions;
  try {
    const raw = process.env.IONIFY_CSS_PREPROCESSOR_OPTIONS;
    cachedPreprocessorOptions = raw ? JSON.parse(raw) : {};
  } catch {
    cachedPreprocessorOptions = {};
  }
  return cachedPreprocessorOptions;
}
function loadProjectPreprocessor(name, rootDir, fromFile) {
  for (const base of [fromFile, path.join(rootDir, "package.json")]) {
    try {
      const req = createRequire(base);
      req.resolve(name);
      return req(name);
    } catch {
      /* try next base */
    }
  }
  try {
    return require(name);
  } catch {
    return null;
  }
}
async function runPreprocessor(code, filePath, rootDir, lang, options) {
  const deps = [];
  if (lang === "scss" || lang === "sass") {
    const sass = loadProjectPreprocessor("sass", rootDir, filePath);
    if (!sass) {
      throw new Error(
        `[ionify:css] "${path.basename(filePath)}" requires the "sass" package — install it in your project: pnpm add -D sass`,
      );
    }
    const langOpts = (options && (options[lang] || options.scss)) || {};
    const result = sass.compileString(code, {
      syntax: lang === "sass" ? "indented" : "scss",
      url: pathToFileURL(filePath),
      loadPaths: [path.dirname(filePath), rootDir, path.join(rootDir, "node_modules")],
      ...langOpts,
    });
    for (const u of result.loadedUrls || []) {
      try {
        const p = fileURLToPath(u);
        if (p && p !== filePath) deps.push(p);
      } catch {
        /* non-file URL — ignore */
      }
    }
    return { css: result.css, deps, version: `sass:${String(sass.info || "").split("\t")[1] || ""}` };
  }
  if (lang === "less") {
    const less = loadProjectPreprocessor("less", rootDir, filePath);
    if (!less) {
      throw new Error(
        `[ionify:css] "${path.basename(filePath)}" requires the "less" package — install it in your project: pnpm add -D less`,
      );
    }
    const langOpts = (options && options.less) || {};
    const result = await less.render(code, {
      filename: filePath,
      paths: [path.dirname(filePath), rootDir],
      ...langOpts,
    });
    for (const p of result.imports || []) if (p && p !== filePath) deps.push(p);
    const version = less.version && less.version.join ? less.version.join(".") : String(less.version || "");
    return { css: result.css, deps, version: `less:${version}` };
  }
  throw new Error(
    `[ionify:css] Stylus (.styl) is not yet wired into Ionify's preprocessor pre-pass — Sass/SCSS and Less are supported. (Native-Rust + Stylus are future-planned: css-pipeline-contract §8.)`,
  );
}

function computePipelineHash({ rootDir, modules, modulesOptions, plugins, options, configFile, preprocessor }) {
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
  const normalizedModules =
    modules && modulesOptions
      ? {
          localsConvention: typeof modulesOptions.localsConvention === "string" ? modulesOptions.localsConvention : null,
          generateScopedName:
            typeof modulesOptions.generateScopedName === "string"
              ? modulesOptions.generateScopedName
              : typeof modulesOptions.generateScopedName === "function"
                ? "function"
                : null,
        }
      : null;

  const payloadObj = {
    schema: "ionify:css-pipeline:v1",
    configFile: configFileId,
    configFileHash,
    pluginNames,
    options: normalizedOptions,
    modules: modules ? 1 : 0,
    modulesOptions: normalizedModules,
  };
  // Fold preprocessor identity for preprocessed files only (mirror of css.ts — keeps plain `.css`
  // hashes unchanged and dev↔build CAS sharing intact). css-pipeline-contract §8.
  if (preprocessor) {
    let optionsTag = null;
    try {
      optionsTag = preprocessor.options ? JSON.stringify(preprocessor.options) : null;
    } catch {
      optionsTag = "<unserializable>";
    }
    payloadObj.preprocessor = { lang: preprocessor.lang, version: preprocessor.version, options: optionsTag };
  }
  return crypto.createHash("sha256").update(JSON.stringify(payloadObj)).digest("hex");
}

function emptyTailwindGraphContentProfile(fallbackReason) {
  return {
    attempted: false,
    enabled: false,
    ms: 0,
    files: 0,
    plugins: 0,
    configPath: null,
    fallbackReason,
  };
}

function findTailwindConfigPath(rootDir) {
  const candidates = [
    "tailwind.config.js",
    "tailwind.config.cjs",
    "tailwind.config.mjs",
    "tailwind.config.ts",
    "tailwind.config.cts",
    "tailwind.config.mts",
  ];
  for (const candidate of candidates) {
    const abs = path.join(rootDir, candidate);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function isTailwindPluginFactory(plugin) {
  if (typeof plugin !== "function") return false;
  if (plugin.name === "tailwindcss" && plugin.postcss === true) return true;
  const source = typeof plugin.toString === "function" ? plugin.toString() : "";
  return plugin.postcss === true && source.includes('postcssPlugin: "tailwindcss"');
}

function cssMayUseTailwindSyntax(css) {
  return /@(?:tailwind|apply|config|import|layer|screen|variants|responsive|theme|utility|variant|custom-variant)\b|\b(?:theme|screen)\s*\(/.test(css);
}

function cssNeedsTailwindContentScan(css) {
  return /@tailwind\s+utilities\b|@(?:source|plugin)\b/.test(css);
}

function graphTailwindContent(originalContent, files) {
  if (originalContent && typeof originalContent === "object" && !Array.isArray(originalContent)) {
    return { ...originalContent, files };
  }
  return { files };
}

function stripPresetContent(preset) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) return preset;
  const out = {};
  for (const key of Object.keys(preset)) {
    if (key === "content") continue;
    out[key] = key === "presets" && Array.isArray(preset[key])
      ? preset[key].map(stripPresetContent)
      : preset[key];
  }
  return out;
}

function cloneTailwindConfigForGraphContent(config, files) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  return {
    ...source,
    content: graphTailwindContent(source.content, files),
    presets: Array.isArray(source.presets) ? source.presets.map(stripPresetContent) : source.presets,
  };
}

function createTailwindGraphContentPipeline(rootDir, css, plugins, graphFilesInput) {
  const started = Date.now();
  const tailwindIndexes = plugins
    .map((plugin, index) => (isTailwindPluginFactory(plugin) ? index : -1))
    .filter((index) => index >= 0);
  if (tailwindIndexes.length === 0) {
    return { plugins, profile: emptyTailwindGraphContentProfile("no-tailwind-plugin") };
  }
  if (!cssMayUseTailwindSyntax(css)) {
    const tailwindIndexSet = new Set(tailwindIndexes);
    return {
      plugins: plugins.filter((_plugin, index) => !tailwindIndexSet.has(index)),
      profile: {
        ...emptyTailwindGraphContentProfile("no-tailwind-syntax"),
        attempted: true,
        ms: Date.now() - started,
        plugins: tailwindIndexes.length,
      },
    };
  }
  const graphFiles = Array.isArray(graphFilesInput)
    ? Array.from(new Set(graphFilesInput.filter((item) => typeof item === "string" && item.length > 0))).sort()
    : [];
  if (graphFiles.length === 0) {
    return { plugins, profile: emptyTailwindGraphContentProfile("no-graph-source-files") };
  }
  const configPath = findTailwindConfigPath(rootDir);
  if (!configPath) return { plugins, profile: emptyTailwindGraphContentProfile("no-tailwind-config") };
  try {
    const req = createRequire(path.join(rootDir, "package.json"));
    const tailwindFactory = req("tailwindcss");
    const tailwindEntry = req.resolve("tailwindcss");
    const loadConfigPath =
      [
        path.join(path.dirname(tailwindEntry), "lib", "load-config.js"),
        path.join(path.dirname(tailwindEntry), "lib", "lib", "load-config.js"),
      ].find((candidate) => fs.existsSync(candidate)) || path.join(path.dirname(tailwindEntry), "lib", "load-config.js");
    const loadConfigModule = req(loadConfigPath);
    if (typeof tailwindFactory !== "function" || typeof loadConfigModule.loadConfig !== "function") {
      return {
        plugins,
        profile: {
          ...emptyTailwindGraphContentProfile("tailwind-loader-unavailable"),
          attempted: true,
          ms: Date.now() - started,
          files: graphFiles.length,
          configPath,
        },
      };
    }
    const userConfig = loadConfigModule.loadConfig(configPath);
    const contentFiles = cssNeedsTailwindContentScan(css) ? graphFiles : [];
    const graphConfig = cloneTailwindConfigForGraphContent(userConfig, contentFiles);
    let replaced = 0;
    const nextPlugins = plugins.map((plugin, index) => {
      if (!tailwindIndexes.includes(index)) return plugin;
      replaced += 1;
      return tailwindFactory(graphConfig);
    });
    return {
      plugins: nextPlugins,
      profile: {
        attempted: true,
        enabled: replaced > 0,
        ms: Date.now() - started,
        files: contentFiles.length,
        plugins: replaced,
        configPath,
        fallbackReason: replaced > 0 ? null : "tailwind-plugin-not-replaced",
      },
    };
  } catch (err) {
    return {
      plugins,
      profile: {
        ...emptyTailwindGraphContentProfile(`tailwind-graph-content-error:${String(err).split("\n")[0]}`),
        attempted: true,
        ms: Date.now() - started,
        files: graphFiles.length,
        configPath,
      },
    };
  }
}

function createScopedNameGenerator(rootDir, filePath, modulesOptions) {
  const custom = modulesOptions && modulesOptions.generateScopedName;
  if (typeof custom === "string" && custom.trim()) {
    const pattern = custom;
    return (name, filename) => {
      const baseName = path.basename(filename || filePath).replace(/\.[^.]+$/, "");
      const rel = path.relative(rootDir, filename || filePath).replace(/\\+/g, "/");
      const hashHex = crypto.createHash("sha256").update(`${rel}:${name}`).digest("hex");
      return pattern
        .replace(/\[name\]/g, baseName)
        .replace(/\[local\]/g, name)
        .replace(/\[hash(?::(hex|base64))?(?::(\d+))?\]/g, (_m, enc, lenRaw) => {
          const len = lenRaw ? Math.max(1, Math.min(32, Number(lenRaw))) : 6;
          if (enc === "base64") return Buffer.from(hashHex, "hex").toString("base64url").slice(0, len);
          return hashHex.slice(0, len);
        });
    };
  }
  return (name, filename) => {
    const relative = path.relative(rootDir, filename || filePath).replace(/\\+/g, "/");
    const seed = crypto.createHash("sha1").update(relative).digest("hex").slice(0, 6);
    return `${name}___${seed}`;
  };
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
  const totalStart = nowMs();
  let preprocessorMs = 0;
  let postcssConfigLoadMs = 0;
  let tailwindGraphContentMs = 0;
  let postcssProcessMs = 0;
  let dependencyCollectionMs = 0;
  let importDependencyDiscoveryMs = 0;
  let urlDependencyDiscoveryMs = 0;
  let pipelineHashMs = 0;
  const pluginTimingMap = new Map();
  const rootDir = job.rootDir || process.env.IONIFY_PROJECT_ROOT || process.cwd();
  const configStart = nowMs();
  const { plugins, options, configFile } = await loadPostcssConfig(rootDir);
  postcssConfigLoadMs += nowMs() - configStart;
  const isModule = typeof job.cssModules === "boolean"
    ? job.cssModules
    : /\.module\.(css|scss|sass|less|styl)$/i.test(job.filePath);
  const modulesOptions = job.cssModulesOptions && typeof job.cssModulesOptions === "object"
    ? job.cssModulesOptions
    : undefined;

  // Preprocessor pre-pass (Sass/SCSS/Less) → CSS before PostCSS (mirror of css.ts, §8).
  const preprocessorLang = detectPreprocessorLang(job.filePath);
  let sourceCss = job.code;
  let preprocessorIdentity = null;
  const preprocessorDeps = [];
  if (preprocessorLang) {
    const preStart = nowMs();
    const preOptions = job.cssPreprocessorOptions && typeof job.cssPreprocessorOptions === "object"
      ? job.cssPreprocessorOptions
      : getPreprocessorOptions();
    const pre = await runPreprocessor(job.code, job.filePath, rootDir, preprocessorLang, preOptions);
    preprocessorMs += nowMs() - preStart;
    sourceCss = pre.css;
    for (const d of pre.deps) preprocessorDeps.push(d);
    preprocessorIdentity = { lang: preprocessorLang, version: pre.version, options: preOptions };
  }

  const tailwindStart = nowMs();
  const tailwindGraphContent = createTailwindGraphContentPipeline(
    rootDir,
    sourceCss,
    plugins,
    job.cssDemandGraphFiles,
  );
  tailwindGraphContentMs += nowMs() - tailwindStart;
  const pipeline = [...tailwindGraphContent.plugins];
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
  for (const d of preprocessorDeps) addDep(d);
  // Tailwind graph-content freshness is proven by the CSSA-owned aggregated
  // stamp (computed once in the main process and passed on the job), never by
  // admitting graph source files as per-artifact CSS dependencies.
  tailwindGraphContent.profile.stamp =
    tailwindGraphContent.profile.enabled && tailwindGraphContent.profile.files > 0
      ? (typeof job.cssDemandGraphStamp === "string" && job.cssDemandGraphStamp.length > 0
          ? job.cssDemandGraphStamp
          : null)
      : null;

  let tokens = null;
  if (isModule) {
    const scopedName = createScopedNameGenerator(rootDir, job.filePath, modulesOptions);
    pipeline.push(
      postcssModules({
        generateScopedName: scopedName,
        localsConvention: modulesOptions && modulesOptions.localsConvention,
        getJSON(_filename, json) {
          tokens = sortObjectKeys(json);
        },
      })
    );
  }

  const timedPipeline = wrapPostcssPluginsForTiming(pipeline, pluginTimingMap);
  const runner = postcss(timedPipeline);
  const processStart = nowMs();
  const result = await runner.process(sourceCss, {
    ...options,
    from: job.filePath,
    map: false,
  });
  postcssProcessMs += nowMs() - processStart;

  // PostCSS plugin dependency messages (postcss-import, Tailwind content globs, etc.).
  const depStart = nowMs();
  const tailwindGraphFiles = tailwindGraphContent.profile.enabled
    ? new Set(
        (Array.isArray(job.cssDemandGraphFiles) ? job.cssDemandGraphFiles : []).map((item) =>
          path.resolve(item).replace(/\\+/g, "/")
        )
      )
    : null;
  for (const dep of collectPostcssMessageDeps(result.messages || [], rootDir, job.filePath, tailwindGraphFiles)) {
    addDep(dep);
  }
  dependencyCollectionMs += nowMs() - depStart;

  // Lightweight @import discovery on the POST-preprocessor CSS (covers plain CSS @imports passed
  // through; preprocessor @use/@import partials are already recorded via preprocessorDeps).
  const importStart = nowMs();
  const importRe = /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)?[^;]*;/gi;
  let match;
  while ((match = importRe.exec(sourceCss))) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    const resolved = resolveCssSpecifier(spec, job.filePath, rootDir);
    if (resolved) addDep(resolved);
  }
  importDependencyDiscoveryMs += nowMs() - importStart;

  const urlStart = nowMs();
  for (const dep of discoverUrlDeps(result.css, job.filePath, rootDir)) {
    addUrlDep(dep);
  }
  urlDependencyDiscoveryMs += nowMs() - urlStart;

  const modulesOptionsKey = (() => {
    try {
      return modulesOptions ? JSON.stringify(modulesOptions) : "";
    } catch {
      return "<unserializable>";
    }
  })();
  const pipelineHashKey = `${rootDir}:${isModule ? 1 : 0}:${modulesOptionsKey}:${preprocessorLang || ""}`;
  let pipelineHash = pipelineHashCache.get(pipelineHashKey);
  if (!pipelineHash) {
    const pipelineHashStart = nowMs();
    pipelineHash = computePipelineHash({
      rootDir,
      modules: isModule,
      modulesOptions,
      plugins,
      options,
      configFile,
      preprocessor: preprocessorIdentity,
    });
    pipelineHashMs += nowMs() - pipelineHashStart;
    pipelineHashCache.set(pipelineHashKey, pipelineHash);
  }
  const postcssPluginTimings = Object.fromEntries(
    Array.from(pluginTimingMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, ms]) => [label, Number(ms.toFixed(2))]),
  );
  const classified = classifyPostcssPluginTimings(postcssPluginTimings);

  return {
    code: result.css,
    type: "css",
    tokens,
    deps,
    urlDeps,
    pipelineHash,
    tailwindGraphContent: tailwindGraphContent.profile,
    cssProfile: {
      totalMs: nowMs() - totalStart,
      preprocessorMs,
      postcssConfigLoadMs,
      postcssConfigWaitMs: 0,
      postcssConfigCacheHit: cachedPostcssConfig !== null,
      tailwindGraphContentMs,
      postcssProcessMs,
      postcssPluginMs: Object.values(postcssPluginTimings).reduce((sum, ms) => sum + ms, 0),
      ...classified,
      dependencyCollectionMs,
      importDependencyDiscoveryMs,
      urlDependencyDiscoveryMs,
      pipelineHashMs,
      cssDemandProofMs: 0,
      postcssPluginTimings,
    },
  };
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
  if (isCssLikeExt(ext)) {
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
      tailwindGraphContent: result.tailwindGraphContent,
      cssProfile: result.cssProfile,
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
