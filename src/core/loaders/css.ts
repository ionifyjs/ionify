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

function resolveCssSpecifier(spec: string, filePath: string, rootDir: string): string | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (/^(data:|https?:|\/\/)/i.test(trimmed)) return null;
  const resolved = trimmed.startsWith("/")
    ? path.resolve(rootDir, "." + trimmed)
    : path.resolve(path.dirname(filePath), trimmed);
  return resolved;
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

async function computePipelineHash(
  rootDir: string,
  modules: boolean,
  modulesOptions?: IonifyCSSConfig["modules"],
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

  return getCacheKey(
    JSON.stringify({
      schema: "ionify:css-pipeline:v1",
      configFile: configFileId,
      configFileHash,
      pluginNames,
      options: normalizedOptions,
      modules: modules ? 1 : 0,
      modulesOptions: normalizedModules,
    }),
  );
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
}: CompileCssOptions): Promise<CompileCssResult> {
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
  const result = await runner.process(code, {
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

  // PostCSS plugin dependency messages (e.g. postcss-import, tailwind, etc.)
  for (const message of result.messages || []) {
    const anyMsg = message as any;
    if (anyMsg?.type === "dependency" && typeof anyMsg.file === "string") {
      addDep(anyMsg.file);
    }
  }

  // Lightweight @import discovery (covers plain CSS without postcss-import plugin)
  // Note: This is best-effort; external URLs are ignored.
  const importRe =
    /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)?[^;]*;/gi;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(code))) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    if (!spec) continue;
    const resolved = resolveCssSpecifier(spec, filePath, rootDir);
    if (resolved) addDep(resolved);
  }

  // url() dependency discovery (assets referenced from CSS)
  for (const dep of discoverUrlDeps(result.css, filePath, rootDir)) {
    addUrlDep(dep);
  }

  const pipelineHash = await computePipelineHash(rootDir, modules, modulesOptions);

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
