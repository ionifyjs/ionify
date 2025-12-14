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
 * - entry points (resolved absolute paths, sorted)
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
  entry: string[] | null;  // absolute paths, sorted
  cssOptions: Record<string, unknown> | null;
  assetOptions: Record<string, unknown> | null;
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
  cssOptions?: any;
  assetOptions?: any;
}): CanonicalVersionInputs {
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
  
  // Normalize entry to sorted array of absolute paths or null
  let entry: string[] | null = null;
  if (config.entry) {
    if (typeof config.entry === "string") {
      entry = [config.entry];
    } else if (Array.isArray(config.entry)) {
      entry = [...config.entry].sort();
    }
  }
  
  // Normalize CSS and asset options (empty object → null for consistency)
  const cssOptions = config.cssOptions && Object.keys(config.cssOptions).length > 0
    ? config.cssOptions
    : null;
    
  const assetOptions = config.assetOptions && Object.keys(config.assetOptions).length > 0
    ? config.assetOptions
    : null;
  
  return {
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    plugins,
    entry,
    cssOptions,
    assetOptions,
  };
}

/**
 * Compute version hash from canonical inputs.
 * Uses SHA256 and returns first 16 characters for brevity.
 * 
 * @param inputs - Canonical version inputs (already normalized)
 * @returns Version hash string (16 characters)
 */
export function computeVersionHash(inputs: CanonicalVersionInputs): string {
  // JSON.stringify with sorted keys for deterministic serialization
  const json = JSON.stringify(inputs, Object.keys(inputs).sort());
  const hash = createHash("sha256").update(json).digest("hex");
  return hash.slice(0, 16);
}
