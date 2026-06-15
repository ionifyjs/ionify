/**
 * CSS-like source extensions — the single source of truth for "is this a CSS module?"
 * across the whole pipeline (graph kind, import classifier, dev server, worker dispatch,
 * native bundler emission). Preprocessor inputs (`.scss`/`.sass`/`.less`/`.styl`) are
 * compiled to CSS by the TS pipeline before PostCSS, so they classify as CSS everywhere
 * `.css` does. Emitted output is always `.css`.
 *
 * Must mirror the Rust `CSS_EXTENSIONS` set in `src/rust/bundler/mod.rs` (module-kind-classifier
 * contract: TS and Rust must agree on kind).
 */
export const CSS_LIKE_EXTENSIONS = [".css", ".scss", ".sass", ".less", ".styl"] as const;

/** True if `ext` (with leading dot) is a CSS-like extension. Case-insensitive. */
export function isCssLikeExt(ext: string): boolean {
  return (CSS_LIKE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

/** True if `p` (path or import specifier; `?query`/`#hash` ignored) has a CSS-like extension. */
export function isCssLikePath(p: string): boolean {
  const clean = p.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return false;
  return isCssLikeExt(clean.slice(dot));
}

/** True for a CSS-modules file: `.module.{css,scss,sass,less,styl}` (`?query`/`#hash` ignored). */
export function isCssModuleLikePath(p: string): boolean {
  const clean = p.split("?")[0].split("#")[0].toLowerCase();
  return /\.module\.(?:css|scss|sass|less|styl)$/.test(clean);
}
