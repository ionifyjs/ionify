import type { IncomingMessage } from "http";
import fs from "fs";
import { getCacheKey, type CacheKeyInput } from "@core/cache";

export function normalizeEtag(tag: string): string {
  return tag.trim().replace(/^W\//, "");
}

export function isNotModified(req: IncomingMessage, etag: string): boolean {
  const header = req.headers["if-none-match"];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return false;
  if (value.trim() === "*") return true;
  const expected = normalizeEtag(etag);
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .some((t) => normalizeEtag(t) === expected);
}

export function weakEtagFromStat(prefix: string, stat: fs.Stats): string {
  const mtime = Math.floor(stat.mtimeMs);
  return `W/"${prefix}-${stat.size}-${mtime}"`;
}

export function weakEtagFromContent(prefix: string, content: CacheKeyInput): string {
  const size =
    typeof content === "string"
      ? Buffer.byteLength(content, "utf8")
      : Buffer.byteLength(content);
  const hash = getCacheKey(content).slice(0, 16);
  return `W/"${prefix}-${size}-${hash}"`;
}
