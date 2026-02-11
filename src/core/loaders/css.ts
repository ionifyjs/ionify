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

import path from "path";
import crypto from "crypto";
import postcss, { AcceptedPlugin, ProcessOptions } from "postcss";
import postcssLoadConfig from "postcss-load-config";
import postcssModules from "postcss-modules";
import { getCacheKey } from "@core/cache";

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
}

export interface CompileCssResult {
  css: string;
  tokens?: CssTokens;
  deps: CssDependency[];
}

interface RenderCssModuleOptions {
  css: string;
  filePath: string;
  tokens?: CssTokens;
}

let cachedConfig: { plugins: AcceptedPlugin[]; options: ProcessOptions } | null = null;
let configFailed = false;

async function getPostcssConfig(rootDir: string) {
  if (cachedConfig) return cachedConfig;
  if (configFailed) return { plugins: [], options: {} };
  try {
    const result = await postcssLoadConfig({}, rootDir);
    cachedConfig = {
      plugins: Array.isArray(result.plugins) ? result.plugins : [],
      options: result.options ?? {},
    };
  } catch {
    configFailed = true;
    cachedConfig = { plugins: [], options: {} };
  }
  return cachedConfig!;
}

export async function compileCss({
  code,
  filePath,
  rootDir,
  modules = false,
}: CompileCssOptions): Promise<CompileCssResult> {
  const { plugins, options } = await getPostcssConfig(rootDir);
  const pipeline = [...plugins];
  let tokens: CssTokens | undefined;

  if (modules) {
    const scopedName = (name: string, filename: string) => {
      const relative = path.relative(rootDir, filename || filePath).replace(/\\+/g, "/");
      const seed = crypto.createHash("sha1").update(relative).digest("hex").slice(0, 6);
      return `${name}___${seed}`;
    };

    pipeline.push(
      postcssModules({
        generateScopedName: scopedName,
        getJSON(_filename, json) {
          tokens = json as CssTokens;
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
  const seen = new Set<string>();
  const addDep = (depPath: string) => {
    const normalized = depPath.replace(/\\+/g, "/");
    if (seen.has(normalized)) return;
    seen.add(normalized);
    deps.push({ filePath: depPath, kind: "dependency" });
  };

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
    if (/^(data:|https?:|\/\/)/i.test(spec)) continue;
    // Root-relative in CSS is treated as project-root relative (Vite-style).
    const resolved = spec.startsWith("/")
      ? path.resolve(rootDir, "." + spec)
      : path.resolve(path.dirname(filePath), spec);
    addDep(resolved);
  }

  const compiled: CompileCssResult = {
    css: result.css,
    tokens,
    deps,
  };

  return compiled;
}

export function renderCssModule({
  css,
  filePath,
  tokens,
}: RenderCssModuleOptions): string {
  const cssJson = JSON.stringify(css);
  const styleId = `ionify-css-${getCacheKey(filePath).slice(0, 8)}`;
  const tokensJson = tokens ? JSON.stringify(tokens) : "null";

  return `
// ionify:css
const cssText = ${cssJson};
const styleId = ${JSON.stringify(styleId)};
let style = document.querySelector(\`style[data-ionify-id="\${styleId}"]\`);
if (!style) {
  style = document.createElement("style");
  style.setAttribute("data-ionify-id", styleId);
  document.head.appendChild(style);
}
style.textContent = cssText;
${tokens ? `const tokens = ${tokensJson};` : ""}
export const css = cssText;
${tokens ? `export const classes = tokens;
export default tokens;` : `export default cssText;`}
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    const existing = document.querySelector(\`style[data-ionify-id="\${styleId}"]\`);
    if (existing) existing.remove();
  });
}
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
