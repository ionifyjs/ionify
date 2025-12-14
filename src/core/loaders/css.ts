import path from "path";
import crypto from "crypto";
import postcss, { AcceptedPlugin, ProcessOptions } from "postcss";
import postcssLoadConfig from "postcss-load-config";
import postcssModules from "postcss-modules";
import { getCacheKey } from "@core/cache";
import { transformCache } from "@core/transform";

type CssTokens = Record<string, string>;

interface CompileCssOptions {
  code: string;
  filePath: string;
  rootDir: string;
  modules?: boolean;
}

export interface CompileCssResult {
  css: string;
  tokens?: CssTokens;
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
  const loaderHash = getCacheKey(JSON.stringify({ modules, filePath: filePath.replace(/\\+/g, "/") }));
  const contentHash = getCacheKey(code);
  const cacheKey = `${contentHash}-${loaderHash}`;
  const cached = transformCache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached.transformed) as CompileCssResult;
      return parsed;
    } catch {
      // fall through
    }
  }

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

  const compiled: CompileCssResult = {
    css: result.css,
    tokens,
  };

  transformCache.set(cacheKey, {
    hash: contentHash,
    loaderHash,
    transformed: JSON.stringify(compiled),
    timestamp: Date.now(),
  });

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
