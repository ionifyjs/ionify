/**
 * Entry Module Detection Utility
 * 
 * Determines if a file is an entry module.
 * 
 * Ionify uses this to ensure the React Refresh runtime is initialized in the true entry
 * module while avoiding per-component registrations for the entry.
 */

import path from "path";
import type { IonifyConfig } from "../../types/config";

// Static entry patterns to avoid recreation on every call
// Common entry patterns: /src/main.{ts,tsx,js,jsx}, /src/index.{ts,tsx,js,jsx}
const ENTRY_PATTERNS = [
  /\/src\/main\.(tsx?|jsx?)$/,
  /\/src\/index\.(tsx?|jsx?)$/,
];

function normalizePath(input: string): string {
  // Always normalize slashes for consistent matching.
  const normalized = path.normalize(input).replace(/\\/g, "/");
  // Only normalize case on Windows (case-insensitive fs semantics).
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Check if a file path is an entry module.
 * 
 * Detection strategy:
 * 1. If config.entry is defined, check exact match
 * 2. If no config.entry, use heuristic: /src/main.* or /src/index.*
 * 
 * @param filePath - Absolute path to the file
 * @param config - Ionify configuration (optional)
 * @returns true if the file is an entry module
 */
export function isEntryModule(filePath: string, config?: IonifyConfig): boolean {
  const normalized = normalizePath(path.resolve(filePath));

  // Strategy 1: Check config.entry if defined
  if (config?.entry) {
    const root = config.root ?? process.cwd();
    const entries = Array.isArray(config.entry) ? config.entry : [config.entry];
    for (const entry of entries) {
      const resolvedEntry = path.resolve(root, entry);
      const normalizedEntry = normalizePath(resolvedEntry);
      if (normalized === normalizedEntry) return true;
    }
  }

  // Strategy 2: Heuristic-based detection
  return ENTRY_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Check if a file path looks like a component module (heuristic).
 * This is used to differentiate entry modules from component modules.
 * 
 * @param filePath - Absolute path to the file
 * @returns true if the file looks like a component
 */
export function looksLikeComponent(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const basename = path.basename(normalized, path.extname(normalized));
  
  // Components typically have PascalCase names
  return /^[A-Z][A-Za-z0-9]*$/.test(basename);
}
