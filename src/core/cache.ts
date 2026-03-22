import fs from "fs";
import path from "path";
import crypto from "crypto";
import { native as nativeBinding } from "@native/index";

export type CacheKeyInput = string | Buffer | Uint8Array;

function resolveIonifyDir(): string {
  const fromEnv = process.env.IONIFY_STATE_DIR;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  const projectRoot = process.env.IONIFY_PROJECT_ROOT;
  if (projectRoot && path.isAbsolute(projectRoot)) return path.join(projectRoot, ".ionify");
  return path.join(process.cwd(), ".ionify");
}

function cacheDir(): string {
  return path.join(resolveIonifyDir(), "cache");
}

function ensureCacheDir() {
  const dir = cacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Generate deterministic cache key for given content */
export function getCacheKey(content: CacheKeyInput): string {
  if (nativeBinding?.cacheHash) {
    try {
      const data = typeof content === "string" ? Buffer.from(content) : content;
      return nativeBinding.cacheHash(data);
    } catch {
      // fall through to JS hash
    }
  }
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** Write buffer or string to cache */
export function writeCache(hash: string, data: Buffer | string) {
  ensureCacheDir();
  const target = path.join(cacheDir(), hash);
  fs.writeFileSync(target, data);
}

/** Read cached file by hash if exists */
export function readCache(hash: string): Buffer | null {
  const target = path.join(cacheDir(), hash);
  return fs.existsSync(target) ? fs.readFileSync(target) : null;
}

/** Clear all cached data */
export function clearCache() {
  const dir = cacheDir();
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
