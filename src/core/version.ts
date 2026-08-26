/**
 * Version Hash Computation for Cache Invalidation
 * 
 * This module provides deterministic version hash computation to ensure dev and build
 * commands operate on the same versioned sled trees and CAS directories.
 * 
 * The version hash is computed from configuration inputs that affect transform/bundle output:
 * - parserMode, minifier (which parser/minifier to use)
 * - treeshake, scopeHoist (optimization settings)
 * - plugins (plugin names, sorted alphabetically)
 * - resolveOptions (aliases/extensions/conditions/mainFields that affect graph reachability)
 * - cssOptions, assetOptions (loader configuration)
 * 
 * Critical Requirements:
 * 1. All arrays MUST be sorted deterministically
 * 2. undefined vs null must be normalized consistently
 * 3. Boolean options must be normalized to explicit values
 * 4. Entry paths must be absolute and resolved before canonicalization
 * 
 * Used by:
 * - Sled database tree names: graph-<version>, reverse-<version>, deps-<version>, ast-cache-<version>
 * - CAS directory structure: .ionify/cas/<version>/<moduleHash>/
 * - Transform cache invalidation
 * 
 * @phase U
 */

import type { IonifyConfig } from "../types/config";
import { createHash } from "node:crypto";

/**
 * Canonical version inputs after normalization.
 * This shape is what gets hashed to produce the version string.
 */
export interface CanonicalVersionInputs {
  // Storage schema tag to force a clean cutover when persistent formats change.
  // Phase 6.6 introduces deterministic ws:// module IDs across Graph/CAS.
  storageSchema: string;
  parserMode: "oxc" | "swc" | "hybrid";
  minifier: "oxc" | "swc" | "auto";
  treeshake: {
    mode: "safe" | "aggressive";
    include: string[];
    exclude: string[];
  } | null;
  scopeHoist: {
    inlineFunctions: boolean;
    constantFolding: boolean;
    combineVariables: boolean;
  } | null;
  plugins: string[];  // plugin names, sorted alphabetically
  resolveOptions: Record<string, unknown> | null;
  cssOptions: Record<string, unknown> | null;
  assetOptions: Record<string, unknown> | null;
  runtimeContracts: Record<string, unknown> | null;
}

/**
 * Normalize treeshake configuration to canonical form.
 * Handles boolean | string | object variants.
 */
function normalizeTreeshake(treeshake: any): CanonicalVersionInputs["treeshake"] {
  if (treeshake === false || treeshake === undefined || treeshake === null) {
    return null;
  }
  
  if (treeshake === true) {
    return {
      mode: "safe",
      include: [],
      exclude: [],
    };
  }
  
  if (typeof treeshake === "string") {
    return {
      mode: treeshake === "aggressive" ? "aggressive" : "safe",
      include: [],
      exclude: [],
    };
  }
  
  // Object form
  return {
    mode: treeshake.mode === "aggressive" ? "aggressive" : "safe",
    include: Array.isArray(treeshake.include) ? [...treeshake.include].sort() : [],
    exclude: Array.isArray(treeshake.exclude) ? [...treeshake.exclude].sort() : [],
  };
}

/**
 * Normalize scopeHoist configuration to canonical form.
 * Handles boolean | object variants.
 */
function normalizeScopeHoist(scopeHoist: any): CanonicalVersionInputs["scopeHoist"] {
  if (scopeHoist === false || scopeHoist === undefined || scopeHoist === null) {
    return null;
  }
  
  if (scopeHoist === true) {
    return {
      inlineFunctions: true,
      constantFolding: true,
      combineVariables: true,
    };
  }
  
  // Object form - extract explicit boolean values
  return {
    inlineFunctions: scopeHoist.inlineFunctions === true,
    constantFolding: scopeHoist.constantFolding === true,
    combineVariables: scopeHoist.combineVariables === true,
  };
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return out.length > 0 ? out : null;
}

function normalizeResolveAlias(alias: unknown): Array<[string, string[]]> | null {
  if (!alias || typeof alias !== "object" || Array.isArray(alias)) return null;
  const entries: Array<[string, string[]]> = [];
  for (const [key, value] of Object.entries(alias as Record<string, unknown>)) {
    if (typeof key !== "string" || key.length === 0) continue;
    const values = Array.isArray(value) ? value : [value];
    const normalized = values.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
    if (normalized.length > 0) entries.push([key, normalized]);
  }
  return entries.length > 0 ? entries : null;
}

function normalizeBuiltinFallback(value: unknown): Array<[string, string | false]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, string | false] =>
        entry[0].length > 0 &&
        (entry[1] === false || (typeof entry[1] === "string" && entry[1].length > 0)),
    )
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries : null;
}

function normalizeRuntimeGlobals(
  value: unknown,
): Array<[string, string | [string, string]]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries: Array<[string, string | [string, string]]> = [];
  for (const [globalName, provider] of Object.entries(value as Record<string, unknown>)) {
    if (globalName.length === 0) continue;
    if (typeof provider === "string" && provider.length > 0) {
      entries.push([globalName, provider]);
      continue;
    }
    if (
      Array.isArray(provider) &&
      provider.length === 2 &&
      typeof provider[0] === "string" &&
      provider[0].length > 0 &&
      typeof provider[1] === "string" &&
      provider[1].length > 0
    ) {
      entries.push([globalName, [provider[0], provider[1]]]);
    }
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries : null;
}

function normalizeResolveOptions(resolveOptions: any): CanonicalVersionInputs["resolveOptions"] {
  if (!resolveOptions || typeof resolveOptions !== "object") return null;
  const normalized: Record<string, unknown> = {};
  const alias = normalizeResolveAlias(resolveOptions.alias);
  const builtinFallback = normalizeBuiltinFallback(resolveOptions.builtinFallback);
  const runtimeGlobals = normalizeRuntimeGlobals(resolveOptions.runtimeGlobals);
  const extensions = normalizeStringArray(resolveOptions.extensions);
  const conditions = normalizeStringArray(resolveOptions.conditions);
  const mainFields = normalizeStringArray(resolveOptions.mainFields);
  if (alias) normalized.alias = alias;
  if (builtinFallback) normalized.builtinFallback = builtinFallback;
  if (runtimeGlobals) normalized.runtimeGlobals = runtimeGlobals;
  if (extensions) normalized.extensions = extensions;
  if (conditions) normalized.conditions = conditions;
  if (mainFields) normalized.mainFields = mainFields;
  return Object.keys(normalized).length > 0 ? normalized : null;
}

/**
 * Compute canonical version inputs from user config.
 * 
 * CRITICAL: This function must produce IDENTICAL output for dev and build
 * when given the same logical configuration.
 * 
 * All arrays are sorted. All undefined values are normalized to explicit defaults or null.
 * Entry paths MUST be absolute before calling this function.
 * 
 * @param config - User configuration (may contain parserMode, minifier, treeshake, etc.)
 * @returns Canonical inputs ready for hashing
 */
export function computeCanonicalVersionInputs(config: Partial<IonifyConfig> & {
  parserMode?: "oxc" | "swc" | "hybrid";
  minifier?: "oxc" | "swc" | "auto";
  treeshake?: any;
  scopeHoist?: any;
  entry?: string | string[];  // Should be absolute paths
  plugins?: any[];
  resolveOptions?: any;
  cssOptions?: any;
  assetOptions?: any;
  runtimeContracts?: Record<string, unknown> | null;
}): CanonicalVersionInputs {
  // IMPORTANT (Phase 6.6):
  // - `entry` is intentionally excluded from the shared engine version hash so Graph/CAS
  //   are reusable across projects within the same workspace when config inputs match.
  // - Storage schema changes MUST bump this tag for a clean cutover (no in-place migrations).
  // v2: native bare-specifier resolution becomes the default for graph building (unified dev/build behavior).
  const storageSchema = "phase6.6-ws-module-ids-v2";

  // Normalize parserMode and minifier with explicit defaults
  const parserMode = config.parserMode || "hybrid";
  const minifier = config.minifier || "auto";
  
  // Normalize optimization settings
  const treeshake = normalizeTreeshake(config.treeshake);
  const scopeHoist = normalizeScopeHoist(config.scopeHoist);
  
  // Extract and sort plugin names
  const plugins = Array.isArray(config.plugins)
    ? config.plugins
        .map((p) => typeof p === "string" ? p : p.name)
        .filter((name): name is string => typeof name === "string")
        .sort()
    : [];
  const resolveOptions = normalizeResolveOptions(config.resolveOptions);
  
  // Normalize CSS and asset options (empty object → null for consistency)
  const cssOptions = config.cssOptions && Object.keys(config.cssOptions).length > 0
    ? config.cssOptions
    : null;
    
  const assetOptions = config.assetOptions && Object.keys(config.assetOptions).length > 0
    ? config.assetOptions
    : null;
  const runtimeContracts = config.runtimeContracts && Object.keys(config.runtimeContracts).length > 0
    ? config.runtimeContracts
    : null;
  
  return {
    storageSchema,
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    plugins,
    resolveOptions,
    cssOptions,
    assetOptions,
    runtimeContracts,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== "object") return val;
    if (Array.isArray(val)) return val;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(val as Record<string, unknown>).sort()) {
      out[key] = (val as Record<string, unknown>)[key];
    }
    return out;
  });
}

/**
 * Compute version hash from canonical inputs.
 * Uses SHA256 and returns first 16 characters for brevity.
 * 
 * @param inputs - Canonical version inputs (already normalized)
 * @returns Version hash string (16 characters)
 */
export function computeVersionHash(inputs: CanonicalVersionInputs): string {
  // Deterministic serialization (stable key ordering at all object depths).
  const json = stableStringify(inputs);
  const hash = createHash("sha256").update(json).digest("hex");
  return hash.slice(0, 16);
}
