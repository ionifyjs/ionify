import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface DepEntry {
  entryPath: string;
  fileName: string;
  packageName: string;
  packageVersion: string;
  subpath?: string | null;
}

const registry = new Map<string, DepEntry>();

export function computeStableDepFileName(options: {
  entryPath: string;
  packageName: string;
  packageVersion?: string | null;
  subpath?: string | null;
}): string {
  const pkgName = sanitizePackageName(options.packageName);
  const pkgVersion = options.packageVersion || "0.0.0";
  const subpath = normalizeSubpath(options.subpath);
  
  // Canonicalize path to ensure consistent hashes across symlinks (pnpm, etc.)
  let canonicalPath = options.entryPath;
  try {
    canonicalPath = fs.realpathSync(options.entryPath);
  } catch {
    // If canonicalization fails, use original path
  }
  
  const hash = crypto
    .createHash("sha256")
    .update(canonicalPath)
    .digest("hex")
    .slice(0, 6);
  const subpathSuffix = subpath ? `__${subpath}` : "";
  return `${pkgName}@${pkgVersion}${subpathSuffix}_${hash}.js`;
}

export function registerDepEntry(entry: Omit<DepEntry, "fileName">): DepEntry {
  const fileName = computeStableDepFileName({
    entryPath: entry.entryPath,
    packageName: entry.packageName,
    packageVersion: entry.packageVersion,
    subpath: entry.subpath,
  });
  
  // One ID Policy: If already registered, return existing entry
  const existing = registry.get(fileName);
  if (existing) {
    return existing;
  }
  
  const record = { ...entry, fileName };
  registry.set(fileName, record);
  return record;
}

export function getDepEntry(fileName: string): DepEntry | undefined {
  return registry.get(fileName);
}

/**
 * Compute subpath from actual file path (matches Rust compute_subpath)
 * Example: /node_modules/pkg/dist/es2015/index.js → "dist/es2015"
 * Example: /node_modules/lodash/lodash.js → "" (main entry)
 */
export function computeSubpathFromEntryPath(entryPath: string): string {
  const packageRoot = findPackageRoot(entryPath);
  if (!packageRoot) {
    if (process.env.DEBUG_DEPS) {
      console.log(`[computeSubpathFromEntryPath] No package root for: ${entryPath}`);
    }
    return "";
  }

  // Get relative path from package root to entry file
  let rel = path.relative(packageRoot, entryPath).replace(/\\/g, "/");

  // Remove file extension
  const extIndex = rel.lastIndexOf(".");
  if (extIndex !== -1) {
    rel = rel.substring(0, extIndex);
  }

  // Remove /index suffix
  if (rel.endsWith("/index")) {
    rel = rel.substring(0, rel.length - "/index".length);
  }

  // Check if this is the main entry point (filename matches package name)
  const pkgName = path.basename(packageRoot);
  
  if (process.env.DEBUG_DEPS) {
    console.log(`[subpath] entry: ${path.basename(entryPath)}, root: ${pkgName}, rel: "${rel}", isMain: ${rel === pkgName}`);
  }
  
  if (rel === pkgName || rel === "index" || rel === "" || rel === ".") {
    return ""; // Main entry - no subpath
  }

  return rel || "";
}

/**
 * Find package root (package.json directory that's a direct child of node_modules)
 * Handles scoped packages like @scope/package correctly.
 */
function findPackageRoot(entryPath: string): string | null {
  let currentDir = path.dirname(entryPath);
  let previousDir = entryPath;

  while (currentDir && currentDir !== previousDir) {
    const parent = path.dirname(currentDir);
    const grandparent = path.dirname(parent);

    // Check if parent is node_modules (normal package)
    if (path.basename(parent) === "node_modules") {
      const pkgJsonPath = path.join(currentDir, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        return currentDir;
      }
    }
    
    // Check if grandparent is node_modules (scoped package like @scope/package)
    if (path.basename(grandparent) === "node_modules" && path.basename(parent).startsWith("@")) {
      const pkgJsonPath = path.join(currentDir, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        return currentDir;
      }
    }

    previousDir = currentDir;
    currentDir = parent;
  }

  return null;
}

function sanitizePackageName(name: string): string {
  return name.replace(/^@/, "").replace(/\//g, "__");
}

function normalizeSubpath(subpath?: string | null): string {
  if (!subpath) return "";
  const cleaned = subpath.replace(/^\.\//, "").replace(/^\//, "");
  // Normalize main entry variations to empty string
  if (!cleaned || cleaned === "." || cleaned === "index") return "";
  return cleaned.replace(/\//g, "__");
}
