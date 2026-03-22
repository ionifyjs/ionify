import path from "path";

export const COMPRESSION_CAS_VERSION = 1;

/**
 * Build the CAS artifact path for a module hash under a given version.
 * Returns the directory that contains transformed.js / transformed.js.map.
 */
export function getCasArtifactPath(casRoot: string, versionHash: string, moduleHash: string): string {
  return path.join(casRoot, versionHash, moduleHash);
}

export function getCompressionCasArtifactPath(
  casRoot: string,
  finalOutputHash: string,
  opts: { brotliQuality: number; gzipLevel: number },
): string {
  const shard = finalOutputHash.slice(0, 2) || "00";
  const settingsKey = `br${Math.max(0, Math.floor(opts.brotliQuality))}-gz${Math.max(0, Math.floor(opts.gzipLevel))}`;
  return path.join(casRoot, "compression", `v${COMPRESSION_CAS_VERSION}`, shard, finalOutputHash, settingsKey);
}
