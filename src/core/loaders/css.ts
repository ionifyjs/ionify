/**
{
  "description": "CSS loader. Compiles CSS through PostCSS, supports CSS modules, and emits JS modules for inline imports.",
  "phase": 2,
  "todo": [
    "Load PostCSS plugins from config.",
    "Generate scoped CSS modules tokens.",
    "Inject styles with HMR-friendly module output."
  ]
}
*/

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
import postcss, { AcceptedPlugin, ProcessOptions } from "postcss";
import postcssLoadConfig from "postcss-load-config";
import postcssModules from "postcss-modules";
import { getCacheKey } from "@core/cache";
import type { IonifyCSSConfig } from "@core/types/config";

type CssTokens = Record<string, string>;

export type CssDependency = {
  filePath: string;
  kind: "dependency";
};

interface CompileCssOptions {
  code: string;
  filePath: string;
  rootDir: string;
  modules?: boolean;
  modulesOptions?: IonifyCSSConfig["modules"];
  preprocessorOptions?: IonifyCSSConfig["preprocessorOptions"];
}

type PreprocessorLang = "scss" | "sass" | "less" | "styl";

interface PreprocessOutcome {
  css: string;
  deps: string[];
  /** Stable preprocessor identity (lib + version) folded into the pipeline hash. */
  version: string;
}

function detectPreprocessorLang(filePath: string): PreprocessorLang | null {
  const ext = path.extname(filePath.split("?")[0].split("#")[0]).toLowerCase();
  if (ext === ".scss") return "scss";
  if (ext === ".sass") return "sass";
  if (ext === ".less") return "less";
  if (ext === ".styl" || ext === ".stylus") return "styl";
  return null;
}

/**
 * Lazy-load a preprocessor (`sass`/`less`) from the PROJECT first (so the app pins its own
 * version, like Vite), then the engine's own node_modules. Returns null if neither resolves.
 */
function loadProjectPreprocessor(name: string, rootDir: string, fromFile: string): any | null {
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
    return createRequire(__filename ?? fromFile)(name);
  } catch {
    return null;
  }
}

/**
 * Preprocessor pre-pass (css-pipeline-contract §8): compile Sass/SCSS/Less to CSS BEFORE PostCSS,
 * deterministically. Records preprocessor import deps (for watch/invalidation) and returns a stable
 * lib+version identity to fold into the pipeline hash. Stylus is reserved (future-planned, §8).
 */
async function runPreprocessor(
  code: string,
  filePath: string,
  rootDir: string,
  lang: PreprocessorLang,
  options: Record<string, any> | undefined,
): Promise<PreprocessOutcome> {
  const deps: string[] = [];
  if (lang === "scss" || lang === "sass") {
    const sass = loadProjectPreprocessor("sass", rootDir, filePath);
    if (!sass) {
      throw new Error(
        `[ionify:css] "${path.basename(filePath)}" requires the "sass" package — install it in your project: pnpm add -D sass`,
      );
    }
    const langOpts = (options?.[lang] ?? options?.scss ?? {}) as Record<string, any>;
    const result = sass.compileString(code, {
      syntax: lang === "sass" ? "indented" : "scss",
      url: pathToFileURL(filePath),
      loadPaths: [path.dirname(filePath), rootDir, path.join(rootDir, "node_modules")],
      ...langOpts,
    });
    for (const u of (result.loadedUrls ?? []) as Array<URL | string>) {
      try {
        const p = fileURLToPath(u);
        if (p && p !== filePath) deps.push(p);
      } catch {
        /* non-file URL (e.g. sass: built-ins) — ignore */
      }
    }
    return { css: result.css, deps, version: `sass:${String(sass.info ?? "").split("\t")[1] ?? ""}` };
  }
  if (lang === "less") {
    const less = loadProjectPreprocessor("less", rootDir, filePath);
    if (!less) {
      throw new Error(
        `[ionify:css] "${path.basename(filePath)}" requires the "less" package — install it in your project: pnpm add -D less`,
      );
    }
    const langOpts = (options?.less ?? {}) as Record<string, any>;
    const result = await less.render(code, {
      filename: filePath,
      paths: [path.dirname(filePath), rootDir],
      ...langOpts,
    });
    for (const p of (result.imports ?? []) as string[]) {
      if (p && p !== filePath) deps.push(p);
    }
    return { css: result.css, deps, version: `less:${String((less.version ?? []).join?.(".") ?? less.version ?? "")}` };
  }
  // Stylus — reserved (future-planned alongside native-Rust preprocessing, css-pipeline-contract §8).
  throw new Error(
    `[ionify:css] Stylus (.styl) is not yet wired into Ionify's preprocessor pre-pass — Sass/SCSS and Less are supported. (Native-Rust + Stylus are future-planned: css-pipeline-contract §8.)`,
  );
}

export interface CompileCssResult {
  css: string;
  tokens?: CssTokens;
  deps: CssDependency[];
  urlDeps: CssDependency[];
  pipelineHash: string;
}

interface RenderCssModuleOptions {
  css: string;
  filePath: string;
  tokens?: CssTokens;
  hmr?: boolean;
  inject?: boolean;
}

type LoadedPostcssConfig = {
  plugins: AcceptedPlugin[];
  options: ProcessOptions;
  configFile: string | null;
};

const cachedPostcssConfigByRoot = new Map<string, LoadedPostcssConfig>();
const postcssConfigFailedRoots = new Set<string>();

async function getPostcssConfig(rootDir: string) {
  const key = path.resolve(rootDir);
  const cached = cachedPostcssConfigByRoot.get(key);
  if (cached) return cached;
  if (postcssConfigFailedRoots.has(key)) {
    const empty: LoadedPostcssConfig = { plugins: [], options: {}, configFile: null };
    cachedPostcssConfigByRoot.set(key, empty);
    return empty;
  }
  try {
    const result = await postcssLoadConfig({}, rootDir);
    const configFile =
      typeof (result as any)?.file === "string" ? ((result as any).file as string) : null;
    const loaded: LoadedPostcssConfig = {
      plugins: Array.isArray(result.plugins) ? result.plugins : [],
      options: result.options ?? {},
      configFile,
    };
    cachedPostcssConfigByRoot.set(key, loaded);
  } catch {
    postcssConfigFailedRoots.add(key);
    const empty: LoadedPostcssConfig = { plugins: [], options: {}, configFile: null };
    cachedPostcssConfigByRoot.set(key, empty);
  }
  return cachedPostcssConfigByRoot.get(key)!;
}

function stablePluginName(plugin: unknown): string {
  if (!plugin || typeof plugin !== "function") return "unknown";
  const anyPlugin = plugin as any;
  if (typeof anyPlugin.postcssPlugin === "string" && anyPlugin.postcssPlugin.length > 0) {
    return anyPlugin.postcssPlugin;
  }
  if (typeof anyPlugin.name === "string" && anyPlugin.name.length > 0) return anyPlugin.name;
  if (typeof (plugin as any).toString === "function") {
    return "anonymous";
  }
  return "unknown";
}

function sortObjectKeys<T extends Record<string, any>>(value: T): T {
  const out: Record<string, any> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = value[key];
  }
  return out as T;
}

export function resolveCssSpecifier(spec: string, filePath: string, rootDir: string): string | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (/^(data:|https?:|\/\/)/i.test(trimmed)) return null;
  if (trimmed.startsWith("/")) return path.resolve(rootDir, "." + trimmed);
  if (trimmed.startsWith("@/")) return path.resolve(rootDir, "src", trimmed.slice(2));
  if (trimmed.startsWith(".") || trimmed.startsWith("..")) return path.resolve(path.dirname(filePath), trimmed);

  const specifier = trimmed.startsWith("~") ? trimmed.slice(1) : trimmed;
  try {
    return createRequire(filePath).resolve(specifier);
  } catch {
    return path.resolve(path.dirname(filePath), trimmed);
  }
}

function discoverUrlDeps(css: string, filePath: string, rootDir: string): string[] {
  const deps: string[] = [];
  const seen = new Set<string>();
  const add = (p: string | null) => {
    if (!p) return;
    const norm = p.replace(/\\+/g, "/");
    if (seen.has(norm)) return;
    seen.add(norm);
    deps.push(p);
  };

  // Note: This is a conservative parser; it ignores CSS escapes and nested functions.
  // It is sufficient as a dependency signal for watcher/invalidation.
  const urlRe = /url\(\s*(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(css))) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    add(resolveCssSpecifier(spec, filePath, rootDir));
  }
  return deps;
}

/**
 * Rewrite **local** `url(...)` references in compiled CSS via a caller-supplied mapper.
 *
 * This is the single, shared `url()`-rebasing primitive (CSS Option 2) used by both:
 *  - the dev server (serve-time → maps each asset to its dev-served public path), and
 *  - the production bundler (emit-time → maps each asset to a hashed `dist/assets/` file).
 *
 * The CAS `transformed.css` artifact stays phase-neutral; only the served/emitted body is
 * rewritten — so dev and build share resolution but produce phase-appropriate targets.
 *
 * Left untouched (returned verbatim): external (`data:`, `http(s):`, `//`), fragment-only
 * (`#clip`), and root-relative (`/foo.png`, already site-root-resolvable) specifiers.
 * Relative (`./`, `../`), alias (`@/`), `~pkg`, and bare-package specifiers are resolved
 * against `fromFsPath`/`rootDir` and handed to `mapTarget`; returning `null` (or the same
 * string) leaves the original `url()` as-is (an unresolved ref the dist-CSS gate surfaces).
 *
 * Callers MUST NOT feed `@import url(...)` statements through this function — it rewrites
 * every `url()` token. The bundler isolates `@import` first; the dev path runs this only
 * after `@import` has been rewritten to served URLs.
 */
export function rewriteCssUrls(
  css: string,
  fromFsPath: string,
  rootDir: string,
  mapTarget: (absPath: string, originalSpec: string) => string | null,
): string {
  const urlRe = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")\s]+))\s*\)/gi;
  return css.replace(urlRe, (full, sQuote, dQuote, bare) => {
    const spec = (sQuote ?? dQuote ?? bare ?? "").trim();
    if (!spec) return full;
    // external / fragment-only / root-relative — never rebased
    if (/^(?:data:|https?:|\/\/|#|\/)/i.test(spec)) return full;
    const abs = resolveCssSpecifier(spec, fromFsPath, rootDir);
    if (!abs) return full;
    const replacement = mapTarget(abs, spec);
    if (!replacement || replacement === spec) return full;
    const quote = sQuote != null ? "'" : '"';
    return `url(${quote}${replacement}${quote})`;
  });
}

async function computePipelineHash(
  rootDir: string,
  modules: boolean,
  modulesOptions?: IonifyCSSConfig["modules"],
  preprocessor?: { lang: string; version: string; options?: Record<string, any> } | null,
): Promise<string> {
  const { plugins, options, configFile } = await getPostcssConfig(rootDir);
  const pluginNames = plugins.map(stablePluginName).filter(Boolean).sort();
  let configFileHash: string | null = null;
  let configFileId: string | null = null;
  if (configFile && fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile);
      configFileHash = getCacheKey(raw);
      const abs = path.resolve(configFile);
      const rel = path.relative(rootDir, abs).replace(/\\+/g, "/");
      configFileId = rel && !rel.startsWith("../") ? rel : path.basename(abs);
    } catch {
      configFileHash = null;
    }
  }

  const normalizedModules =
    modules && modulesOptions
      ? {
          localsConvention:
            typeof modulesOptions.localsConvention === "string"
              ? modulesOptions.localsConvention
              : null,
          generateScopedName:
            typeof modulesOptions.generateScopedName === "string"
              ? modulesOptions.generateScopedName
              : typeof modulesOptions.generateScopedName === "function"
                ? "function"
                : null,
        }
      : null;

  // Note: postcss `options` can include non-serializable values; only hash a safe subset.
  const normalizedOptions = {
    map: (options as any)?.map ?? null,
  };

  const payload: Record<string, unknown> = {
    schema: "ionify:css-pipeline:v1",
    configFile: configFileId,
    configFileHash,
    pluginNames,
    options: normalizedOptions,
    modules: modules ? 1 : 0,
    modulesOptions: normalizedModules,
  };

  // Fold preprocessor identity (lib + version + options) ONLY for preprocessed files — plain `.css`
  // keeps its v1 hash unchanged (no mass CAS invalidation). css-pipeline-contract §8.
  if (preprocessor) {
    let optionsTag: string | null = null;
    try {
      optionsTag = preprocessor.options ? JSON.stringify(preprocessor.options) : null;
    } catch {
      optionsTag = "<unserializable>";
    }
    payload.preprocessor = { lang: preprocessor.lang, version: preprocessor.version, options: optionsTag };
  }

  return getCacheKey(JSON.stringify(payload));
}

function createScopedNameGenerator({
  rootDir,
  filePath,
  modulesOptions,
}: {
  rootDir: string;
  filePath: string;
  modulesOptions?: IonifyCSSConfig["modules"];
}) {
  const custom = modulesOptions?.generateScopedName;
  if (typeof custom === "function") {
    return (name: string, filename: string, css: string) => custom(name, filename, css);
  }
  if (typeof custom === "string" && custom.trim().length > 0) {
    const pattern = custom;
    return (name: string, filename: string) => {
      const baseName = path.basename(filename || filePath).replace(/\.[^.]+$/, "");
      const rel = path.relative(rootDir, filename || filePath).replace(/\\+/g, "/");
      const hashHex = crypto.createHash("sha256").update(`${rel}:${name}`).digest("hex");

      return pattern
        .replace(/\[name\]/g, baseName)
        .replace(/\[local\]/g, name)
        .replace(/\[hash(?::(hex|base64))?(?::(\d+))?\]/g, (_m, enc, lenRaw) => {
          const len = lenRaw ? Math.max(1, Math.min(32, Number(lenRaw))) : 6;
          if (enc === "base64") {
            const b64 = Buffer.from(hashHex, "hex").toString("base64url");
            return b64.slice(0, len);
          }
          return hashHex.slice(0, len);
        });
    };
  }

  return (name: string, filename: string) => {
    const relative = path
      .relative(rootDir, filename || filePath)
      .replace(/\\+/g, "/");
    const seed = crypto.createHash("sha1").update(relative).digest("hex").slice(0, 6);
    return `${name}___${seed}`;
  };
}

export async function compileCss({
  code,
  filePath,
  rootDir,
  modules = false,
  modulesOptions,
  preprocessorOptions,
}: CompileCssOptions): Promise<CompileCssResult> {
  // Preprocessor pre-pass (Sass/SCSS/Less) → CSS, BEFORE PostCSS (css-pipeline-contract §8).
  // Unified across dev/build/worker; preprocessor import deps + lib identity are tracked below.
  const preprocessorLang = detectPreprocessorLang(filePath);
  let sourceCss = code;
  let preprocessorIdentity: { lang: string; version: string; options?: Record<string, any> } | null = null;
  const preprocessorDeps: string[] = [];
  if (preprocessorLang) {
    const pre = await runPreprocessor(code, filePath, rootDir, preprocessorLang, preprocessorOptions);
    sourceCss = pre.css;
    preprocessorDeps.push(...pre.deps);
    preprocessorIdentity = { lang: preprocessorLang, version: pre.version, options: preprocessorOptions };
  }

  const { plugins, options, configFile } = await getPostcssConfig(rootDir);
  const pipeline = [...plugins];
  let tokens: CssTokens | undefined;

  if (modules) {
    const scopedName = createScopedNameGenerator({ rootDir, filePath, modulesOptions });
    pipeline.push(
      postcssModules({
        generateScopedName: scopedName,
        localsConvention: modulesOptions?.localsConvention,
        getJSON(_filename, json) {
          tokens = sortObjectKeys(json as CssTokens);
        },
      })
    );
  }

  const runner = postcss(pipeline);
  const result = await runner.process(sourceCss, {
    ...options,
    from: filePath,
    map: false,
  });

  const deps: CssDependency[] = [];
  const urlDeps: CssDependency[] = [];
  const seenDeps = new Set<string>();
  const seenUrlDeps = new Set<string>();
  const addDep = (depPath: string) => {
    const normalized = depPath.replace(/\\+/g, "/");
    if (seenDeps.has(normalized)) return;
    seenDeps.add(normalized);
    deps.push({ filePath: depPath, kind: "dependency" });
  };
  const addUrlDep = (depPath: string) => {
    const normalized = depPath.replace(/\\+/g, "/");
    if (seenUrlDeps.has(normalized)) return;
    seenUrlDeps.add(normalized);
    urlDeps.push({ filePath: depPath, kind: "dependency" });
  };

  if (configFile) addDep(configFile);

  // Preprocessor import deps (@use/@import of partials resolved by sass/less) → watch/invalidation.
  for (const dep of preprocessorDeps) addDep(dep);

  // PostCSS plugin dependency messages (e.g. postcss-import, tailwind, etc.)
  for (const message of result.messages || []) {
    const anyMsg = message as any;
    if (anyMsg?.type === "dependency" && typeof anyMsg.file === "string") {
      addDep(anyMsg.file);
    }
  }

  // Lightweight @import discovery on the POST-preprocessor CSS (covers plain CSS @imports the
  // preprocessor passed through; preprocessor-level @use/@import are already recorded above).
  // Note: This is best-effort; external URLs are ignored.
  const importRe =
    /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)?[^;]*;/gi;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(sourceCss))) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    if (!spec) continue;
    const resolved = resolveCssSpecifier(spec, filePath, rootDir);
    if (resolved) addDep(resolved);
  }

  // url() dependency discovery (assets referenced from CSS)
  for (const dep of discoverUrlDeps(result.css, filePath, rootDir)) {
    addUrlDep(dep);
  }

  const pipelineHash = await computePipelineHash(rootDir, modules, modulesOptions, preprocessorIdentity);

  const compiled: CompileCssResult = {
    css: result.css,
    tokens,
    deps,
    urlDeps,
    pipelineHash,
  };

  return compiled;
}

export function renderCssModule({
  css,
  filePath,
  tokens,
  hmr = true,
  inject = true,
}: RenderCssModuleOptions): string {
  const cssJson = JSON.stringify(css);
  const styleId = `ionify-css-${getCacheKey(filePath).slice(0, 8)}`;
  const tokensJson = tokens ? JSON.stringify(tokens) : "null";

  return `
// ionify:css
const cssText = ${cssJson};
const styleId = ${JSON.stringify(styleId)};
${inject ? `let style = document.querySelector(\`style[data-ionify-id="\${styleId}"]\`);
if (!style) {
  style = document.createElement("style");
  style.setAttribute("data-ionify-id", styleId);
  document.head.appendChild(style);
}
style.textContent = cssText;` : ""}
${tokens ? `const tokens = ${tokensJson};` : ""}
export const css = cssText;
${tokens ? `export const classes = tokens;
export default tokens;` : `export default cssText;`}
${hmr ? `if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    const existing = document.querySelector(\`style[data-ionify-id="\${styleId}"]\`);
    if (existing) existing.remove();
  });
}` : ""}
`.trim();
}

export function renderCssTokensModule(tokens: CssTokens): string {
  const sorted = sortObjectKeys(tokens);
  const tokensJson = JSON.stringify(sorted);
  return `
// ionify:css
const tokens = ${tokensJson};
export const classes = tokens;
export default tokens;
`.trim();
}

export function renderCssRawStringModule(cssText: string): string {
  return `
// ionify:css
const css = ${JSON.stringify(cssText)};
export { css };
export default css;
`.trim();
}

export function renderCssUrlModule(url: string): string {
  return `
// ionify:css
const url = ${JSON.stringify(url)};
export { url };
export default url;
`.trim();
}
