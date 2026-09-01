import { native } from "@native/index";

/**
 * A1/B.1 single authority — the canonical local-source extension list + order.
 *
 * The AUTHORITY is the native resolver's `LOCAL_SOURCE_EXTENSIONS`
 * (src/rust/resolver/package_resolver.rs), surfaced to JS via
 * `native.localSourceExtensions()`. Every TS local-source resolver consumes THIS
 * function instead of defining its own array, so the four engine resolvers
 * (resolveImport, ModuleResolver, native resolveModule, graph-build) can never
 * drift in set or order — the exact bug class R2 sealed.
 *
 * `LOCAL_SOURCE_EXTENSIONS_FALLBACK` is a drift-guarded mirror, used only when the
 * native export is unavailable (a partially-mocked `native` in unit tests, or an
 * older addon predating the export). It is NOT an independent authority:
 * `tests/resolver-golden-vector` asserts it deep-equals
 * `native.localSourceExtensions()`, so it can never silently diverge from the
 * native source of truth.
 */
export const LOCAL_SOURCE_EXTENSIONS_FALLBACK: readonly string[] = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
];

let cachedNative: string[] | null = null;

/** The canonical local-source extension list, sourced from the native authority. */
export function localSourceExtensions(): string[] {
  if (cachedNative) return cachedNative;
  const fromNative = native?.localSourceExtensions?.();
  if (Array.isArray(fromNative) && fromNative.length > 0) {
    cachedNative = fromNative;
    return cachedNative;
  }
  // Native addon absent (mock/old binary) — return the drift-guarded mirror
  // fresh each call so a later real-native availability still wins.
  return [...LOCAL_SOURCE_EXTENSIONS_FALLBACK];
}
