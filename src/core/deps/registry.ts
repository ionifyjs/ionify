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
const manifestCache = new Map<string, { version?: string; peerDependencies?: Record<string, unknown> } | null>();
const peerIdentityCache = new Map<string, string | null>();

export function computeStableDepFileName(options: {
  entryPath: string;
  packageName: string;
  packageVersion?: string | null;
  subpath?: string | null;
}): string {
  const pkgName = sanitizePackageName(options.packageName);
  const pkgVersion = options.packageVersion || "0.0.0";
  const subpath = normalizeSubpath(options.subpath);

  const identity = buildDepIdentityFingerprint({
    entryPath: options.entryPath,
    packageName: options.packageName,
    packageVersion: pkgVersion,
    subpath,
  });

  const hash = crypto
    .createHash("sha256")
    .update(identity)
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

export function isCoreSingletonDepFileName(fileName: string): boolean {
  const normalized = String(fileName || "").trim().toLowerCase();
  return (
    normalized.startsWith("react@") ||
    normalized.startsWith("react-dom@") ||
    normalized.startsWith("scheduler@") ||
    normalized.startsWith("react-refresh@")
  );
}

export function hasCoreSingletonPeerDeps(entryPath: string): boolean {
  const packageRoot = findPackageRoot(realpathOrSelf(entryPath));
  if (!packageRoot) return false;

  const peerDeps = readPackageManifest(packageRoot)?.peerDependencies ?? {};
  return (
    Object.prototype.hasOwnProperty.call(peerDeps, "react") ||
    Object.prototype.hasOwnProperty.call(peerDeps, "react-dom") ||
    Object.prototype.hasOwnProperty.call(peerDeps, "scheduler") ||
    Object.prototype.hasOwnProperty.call(peerDeps, "react-refresh")
  );
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

function buildDepIdentityFingerprint(options: {
  entryPath: string;
  packageName: string;
  packageVersion: string;
  subpath: string;
}): string {
  const canonicalPath = realpathOrSelf(options.entryPath);
  const peerIdentity = resolvePeerIdentitySignature(canonicalPath);
  if (!peerIdentity) {
    return canonicalPath;
  }

  return [
    "peer-aware:v1",
    options.packageName,
    options.packageVersion,
    options.subpath,
    peerIdentity,
  ].join("|");
}

function resolvePeerIdentitySignature(entryPath: string): string | null {
  const canonicalEntry = realpathOrSelf(entryPath);
  if (peerIdentityCache.has(canonicalEntry)) {
    return peerIdentityCache.get(canonicalEntry) ?? null;
  }

  const packageRoot = findPackageRoot(canonicalEntry);
  if (!packageRoot) {
    peerIdentityCache.set(canonicalEntry, null);
    return null;
  }

  const manifest = readPackageManifest(packageRoot);
  const peerNames = Object.keys(manifest?.peerDependencies ?? {}).sort();
  if (!peerNames.length) {
    peerIdentityCache.set(canonicalEntry, null);
    return null;
  }

  const startDir = path.dirname(packageRoot);
  const signature = peerNames
    .map((peerName) => `${peerName}@${resolveInstalledPackageVersion(startDir, peerName) ?? "missing"}`)
    .join("|");

  peerIdentityCache.set(canonicalEntry, signature);
  return signature;
}

function resolveInstalledPackageVersion(startDir: string, packageName: string): string | null {
  let currentDir = startDir;
  let previousDir = "";

  while (currentDir && currentDir !== previousDir) {
    const manifestPath = path.join(currentDir, "node_modules", packageName, "package.json");
    if (fs.existsSync(manifestPath)) {
      return readPackageManifest(path.dirname(manifestPath))?.version ?? null;
    }
    previousDir = currentDir;
    currentDir = path.dirname(currentDir);
  }

  return null;
}

function readPackageManifest(packageRoot: string): { version?: string; peerDependencies?: Record<string, unknown> } | null {
  const canonicalRoot = realpathOrSelf(packageRoot);
  if (manifestCache.has(canonicalRoot)) {
    return manifestCache.get(canonicalRoot) ?? null;
  }

  const manifestPath = path.join(canonicalRoot, "package.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      version?: string;
      peerDependencies?: Record<string, unknown>;
    };
    manifestCache.set(canonicalRoot, parsed);
    return parsed;
  } catch {
    manifestCache.set(canonicalRoot, null);
    return null;
  }
}

function realpathOrSelf(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return targetPath;
  }
}
