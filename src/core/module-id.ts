import fs from "fs";
import path from "path";

export const WS_MODULE_PREFIX = "ws://";

function realpathOrResolve(absPath: string): string {
  try {
    const fn = (fs.realpathSync as any).native as ((p: string) => string) | undefined;
    if (fn) return fn(absPath);
    return fs.realpathSync(absPath);
  } catch {
    return path.resolve(absPath);
  }
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

function isSafeRelPath(relPosix: string): boolean {
  if (!relPosix) return false;
  if (relPosix === "." || relPosix.startsWith("./")) return false;
  if (relPosix.includes("\0")) return false;
  if (relPosix.startsWith("../") || relPosix === "..") return false;
  // Disallow Windows drive prefixes or UNC-like roots after normalization.
  if (/^[A-Za-z]:\//.test(relPosix) || relPosix.startsWith("//")) return false;
  // Prevent traversal segments.
  const parts = relPosix.split("/");
  if (parts.some((part) => part === ".." || part === "")) return false;
  return true;
}

export function resolveWorkspaceRoot(defaultRoot?: string | null): string {
  const fromEnv = process.env.IONIFY_WORKSPACE_ROOT;
  if (fromEnv && path.isAbsolute(fromEnv)) return realpathOrResolve(fromEnv);
  if (defaultRoot && path.isAbsolute(defaultRoot)) return realpathOrResolve(defaultRoot);
  return realpathOrResolve(process.cwd());
}

export function isWsModuleId(value: string): boolean {
  return typeof value === "string" && value.startsWith(WS_MODULE_PREFIX);
}

export function toWsModuleId(absPath: string, workspaceRoot?: string | null): string | null {
  if (!absPath || typeof absPath !== "string") return null;
  if (!path.isAbsolute(absPath)) return null;

  const wsRoot = resolveWorkspaceRoot(workspaceRoot ?? null);
  const normalizedWs = realpathOrResolve(wsRoot);
  const exists = fs.existsSync(absPath);
  const normalizedFile = exists ? realpathOrResolve(absPath) : path.resolve(absPath);

  if (
    normalizedFile !== normalizedWs &&
    !normalizedFile.startsWith(normalizedWs + path.sep)
  ) {
    return null;
  }

  const rel = path.relative(normalizedWs, normalizedFile);
  const relPosix = toPosixPath(rel);
  if (!isSafeRelPath(relPosix)) return null;
  return WS_MODULE_PREFIX + relPosix;
}

export function fromWsModuleId(id: string, workspaceRoot?: string | null): string | null {
  if (!isWsModuleId(id)) return null;
  const relPosix = id.slice(WS_MODULE_PREFIX.length);
  if (!isSafeRelPath(relPosix)) return null;

  const wsRoot = resolveWorkspaceRoot(workspaceRoot ?? null);
  const normalizedWs = realpathOrResolve(wsRoot);
  const relNative = relPosix.split("/").join(path.sep);
  const joined = path.resolve(normalizedWs, relNative);
  if (joined !== normalizedWs && !joined.startsWith(normalizedWs + path.sep)) {
    return null;
  }
  return joined;
}

