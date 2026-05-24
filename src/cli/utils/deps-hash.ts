import crypto from "crypto";

/**
 * Schema version bump this when the on-disk deps cache format changes in a
 * backwards-incompatible way. All callers (dev + build) read the same value so
 * cache invalidation is automatic across both commands.
 */
export const DEPS_CACHE_SCHEMA_VERSION = 1;

/**
 * Minimal lockfile surface required to compute the deps hash.
 * Both `dev.ts` (which carries extra `packageCount`) and `build.ts` satisfy
 * this interface.
 */
export interface LockfileContents {
  contents: Buffer;
}

export interface ComputeDepsHashOpts {
  nodeEnv?: string;
  sourcemap: boolean;
  bundleEsm: boolean;
  sharedChunks: string;
  outputVersion: number;
}

/**
 * Deterministic, 16-hex-char hash that uniquely identifies a set of optimized
 * deps. Used as the directory name under `.ionify/deps/<depsHash>/` and as the
 * cache-lookup key for ionify-cloud CDC sessions.
 *
 * Inputs:
 *   configHash  — hash of the project's ionify config optimizeDeps section
 *   lockfile    — raw lockfile bytes (null if no lockfile found)
 *   opts        — runtime flags that affect the optimizer output
 */
export function computeDepsHash(
  configHash: string,
  lockfile: LockfileContents | null,
  opts: ComputeDepsHashOpts,
): string {
  const hash = crypto.createHash("sha256");
  hash.update(configHash);
  hash.update(`depsSchema=${DEPS_CACHE_SCHEMA_VERSION}`);
  if (lockfile) {
    hash.update(lockfile.contents);
  }
  hash.update(`NODE_ENV=${opts.nodeEnv}`);
  hash.update(`optimizeDeps.sourcemap=${opts.sourcemap ? "1" : "0"}`);
  hash.update(`optimizeDeps.bundleEsm=${opts.bundleEsm ? "1" : "0"}`);
  hash.update(`optimizeDeps.sharedChunks=${opts.sharedChunks}`);
  hash.update(`optimizeDeps.outputVersion=${opts.outputVersion}`);
  return hash.digest("hex").slice(0, 16);
}
