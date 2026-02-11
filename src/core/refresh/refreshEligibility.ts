import type { IonifyConfig } from "../../types/config";

export interface ReactRefreshEligibilityOptions {
  ext: string;
  code: string;
  isDev: boolean;
  config?: IonifyConfig | null;
}

export function containsJSX(code: string): boolean {
  const sample = code.slice(0, 8 * 1024);

  // Compiled / non-JSX patterns that still represent React element creation.
  if (sample.includes("React.createElement")) return true;
  if (/\bjsx(?:s)?\s*\(/.test(sample)) return true;

  // Fragments.
  if (sample.includes("<>") || sample.includes("</>")) return true;

  // Self-closing tags: <Foo /> / <div/>
  if (/<[A-Za-z][A-Za-z0-9.$_-]*\b[^>]*\/>/.test(sample)) return true;

  // Paired tags: require both an opening and closing tag to reduce TS-generic false positives.
  if (/<[A-Za-z][A-Za-z0-9.$_-]*\b[^>]*>/.test(sample) && /<\/[A-Za-z]/.test(sample)) {
    return true;
  }

  return false;
}

export function shouldUseReactRefresh(options: ReactRefreshEligibilityOptions): boolean {
  const { ext, code, isDev, config } = options;

  if (!isDev) return false;
  if (config?.fastRefresh === false) return false;

  // Content-based: fall back to plain HMR when there's no JSX/element creation.
  if (ext === ".jsx" || ext === ".tsx") return containsJSX(code);

  // Optional: support JSX-in-JS/TS (common in some codebases).
  if (ext === ".js" || ext === ".ts" || ext === ".mjs" || ext === ".mts") return containsJSX(code);

  return false;
}
