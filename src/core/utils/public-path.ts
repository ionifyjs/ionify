import path from "path";
import fs from "fs";
import { fromWsModuleId, toWsModuleId } from "@core/module-id";

const MODULE_PREFIX = "/__ionify__/modules/";

export function publicPathForFile(rootDir: string, absPath: string): string {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedFile = path.resolve(absPath);
  if (normalizedFile.startsWith(normalizedRoot + path.sep) || normalizedFile === normalizedRoot) {
    const relative = path.relative(normalizedRoot, normalizedFile).split(path.sep).join("/");
    return "/" + (relative.length ? relative : "");
  }
  const logicalNodeModulesPath = mapRealPathToProjectNodeModules(normalizedRoot, normalizedFile);
  if (logicalNodeModulesPath) {
    const relative = path.relative(normalizedRoot, logicalNodeModulesPath).split(path.sep).join("/");
    return "/" + relative;
  }
  const wsId = toWsModuleId(normalizedFile, null);
  const encoded = Buffer.from(wsId ?? "invalid").toString("base64url");
  return MODULE_PREFIX + encoded;
}

function realpathOrResolve(absPath: string): string {
  try {
    const fn = (fs.realpathSync as any).native as ((p: string) => string) | undefined;
    if (fn) return fn(absPath);
    return fs.realpathSync(absPath);
  } catch {
    return path.resolve(absPath);
  }
}

function mapRealPathToProjectNodeModules(rootDir: string, absPath: string): string | null {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedFile = realpathOrResolve(absPath);
  const parts = normalizedFile.split(path.sep).filter(Boolean);

  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== "node_modules") continue;
    if (index === parts.length - 1) continue;

    const suffix = parts.slice(index + 1);
    if (suffix[0]?.startsWith("@") && suffix.length < 2) continue;

    const candidate = path.join(normalizedRoot, "node_modules", ...suffix);
    if (!fs.existsSync(candidate)) continue;
    if (realpathOrResolve(candidate) !== normalizedFile) continue;
    return candidate;
  }

  return null;
}

function isWithinRoots(filePath: string, roots: string[]): boolean {
  const exists = fs.existsSync(filePath);
  const normalizedFile = exists ? realpathOrResolve(filePath) : path.resolve(filePath);

  for (const root of roots) {
    const normalizedRoot = realpathOrResolve(root);
    if (normalizedFile === normalizedRoot) return true;
    if (normalizedFile.startsWith(normalizedRoot + path.sep)) return true;
  }
  return false;
}

function isForbiddenPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\+/g, "/");
  // Never serve git internals or Ionify state via the generic FS module route.
  return normalized.includes("/.git/") || normalized.includes("/.ionify/") || normalized.endsWith("/.git") || normalized.endsWith("/.ionify");
}

export function isForbiddenFsPath(filePath: string): boolean {
  return isForbiddenPath(filePath);
}

export function decodePublicPath(
  rootDir: string,
  urlPath: string,
  opts?: { allowedRoots?: string[]; workspaceRoot?: string },
): string | null {
  if (urlPath.startsWith(MODULE_PREFIX)) {
    const encoded = urlPath.slice(MODULE_PREFIX.length);
    try {
      const decoded = Buffer.from(encoded, "base64url").toString("utf8");
      if (!decoded || decoded.includes("\0")) return null;
      const abs = fromWsModuleId(decoded, opts?.workspaceRoot ?? null);
      if (!abs) return null;
      if (isForbiddenPath(abs)) return null;
      const allowedRoots = opts?.allowedRoots;
      if (Array.isArray(allowedRoots) && allowedRoots.length > 0) {
        if (!isWithinRoots(abs, allowedRoots)) return null;
      }
      return abs;
    } catch {
      return null;
    }
  }

  const normalizedRoot = path.resolve(rootDir);
  const joined = path.resolve(normalizedRoot, "." + urlPath);
  if (!joined.startsWith(normalizedRoot + path.sep) && joined !== normalizedRoot) {
    return null;
  }
  if (isForbiddenPath(joined)) return null;
  return joined;
}

export function isModulePublicPath(urlPath: string): boolean {
  return urlPath.startsWith(MODULE_PREFIX);
}

export { MODULE_PREFIX as MODULE_REQUEST_PREFIX };
