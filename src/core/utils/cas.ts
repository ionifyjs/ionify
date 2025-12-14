import path from "path";

/**
 * Build the CAS artifact path for a module hash under a given version.
 * Returns the directory that contains transformed.js / transformed.js.map.
 */
export function getCasArtifactPath(casRoot: string, versionHash: string, moduleHash: string): string {
  return path.join(casRoot, versionHash, moduleHash);
}
