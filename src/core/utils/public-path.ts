import path from "path";

const MODULE_PREFIX = "/__ionify__/modules/";

export function publicPathForFile(rootDir: string, absPath: string): string {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedFile = path.resolve(absPath);
  if (normalizedFile.startsWith(normalizedRoot + path.sep) || normalizedFile === normalizedRoot) {
    const relative = path.relative(normalizedRoot, normalizedFile).split(path.sep).join("/");
    return "/" + (relative.length ? relative : "");
  }
  const encoded = Buffer.from(normalizedFile).toString("base64url");
  return MODULE_PREFIX + encoded;
}

export function decodePublicPath(rootDir: string, urlPath: string): string | null {
  if (urlPath.startsWith(MODULE_PREFIX)) {
    const encoded = urlPath.slice(MODULE_PREFIX.length);
    try {
      const decoded = Buffer.from(encoded, "base64url").toString("utf8");
      return path.resolve(decoded);
    } catch {
      return null;
    }
  }

  const normalizedRoot = path.resolve(rootDir);
  const joined = path.resolve(normalizedRoot, "." + urlPath);
  if (!joined.startsWith(normalizedRoot + path.sep) && joined !== normalizedRoot) {
    return null;
  }
  return joined;
}

export function isModulePublicPath(urlPath: string): boolean {
  return urlPath.startsWith(MODULE_PREFIX);
}

export { MODULE_PREFIX as MODULE_REQUEST_PREFIX };
