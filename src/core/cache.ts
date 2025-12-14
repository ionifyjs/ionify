import fs from "fs";
import path from "path";
import crypto from "crypto";
import { native as nativeBinding } from "@native/index";

const CACHE_DIR = path.join(process.cwd(), ".ionify", "cache");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/** Generate deterministic cache key for given content */
export function getCacheKey(content: string): string {
  if (nativeBinding?.cacheHash) {
    try {
      return nativeBinding.cacheHash(Buffer.from(content));
    } catch {
      // fall through to JS hash
    }
  }
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** Write buffer or string to cache */
export function writeCache(hash: string, data: Buffer | string) {
  ensureCacheDir();
  const target = path.join(CACHE_DIR, hash);
  fs.writeFileSync(target, data);
}

/** Read cached file by hash if exists */
export function readCache(hash: string): Buffer | null {
  const target = path.join(CACHE_DIR, hash);
  return fs.existsSync(target) ? fs.readFileSync(target) : null;
}

/** Clear all cached data */
export function clearCache() {
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  }
}
