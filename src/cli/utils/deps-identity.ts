import fs from "fs";
import path from "path";
import { computeGraphVersion, getDepsOptimizerOutputVersion } from "@native/index";
import { createProductionGraphVersionInputs } from "@core/production-build-identity";
import { resolveMinifier } from "@cli/utils/minifier";
import { resolveParser } from "@cli/utils/parser";
import { resolveTreeshake } from "@cli/utils/treeshake";
import { resolveScopeHoist } from "@cli/utils/scope-hoist";
import { computeDepsHash } from "@cli/utils/deps-hash";

const DEPS_OPTIMIZER_OUTPUT_VERSION = getDepsOptimizerOutputVersion();

export type StandaloneDepsIdentity = {
  depsHash: string;
  configHash: string;
};

/**
 * Canonical standalone dependency identity for cloud commands.
 *
 * `build` and `dev` compute depsHash from the graph config hash, lockfile bytes,
 * NODE_ENV, and optimizer-affecting options. Cloud commands that run outside an
 * in-process build handoff must use the same identity, otherwise push/hydrate
 * can address different CDC sessions for the same project state.
 */
export async function computeStandaloneDepsIdentity(
  config: any,
  workspace: { workspaceRoot: string },
  rootDir: string,
  nodeEnv: "development" | "production",
): Promise<StandaloneDepsIdentity> {
  const lockfile = readCanonicalLockfile(workspace, rootDir);

  const minifier = resolveMinifier(config, { envVar: process.env.IONIFY_MINIFIER });
  const parserMode = resolveParser(config, { envMode: process.env.IONIFY_PARSER });
  const treeshake = resolveTreeshake(config?.treeshake, {
    envMode: process.env.IONIFY_TREESHAKE,
    includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
    excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE,
  });
  const scopeHoist = resolveScopeHoist(config?.scopeHoist, {
    envMode: process.env.IONIFY_SCOPE_HOIST,
    inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
    constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
    combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE,
  });
  const entries = resolveConfiguredEntries(config, rootDir);
  const rawVersionInputs = createProductionGraphVersionInputs({
    config,
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    entries,
  }) as Parameters<typeof computeGraphVersion>[0];
  const configHash = computeGraphVersion(rawVersionInputs);

  const depsSourcemapEnabled = config?.optimizeDeps?.sourcemap === true;
  const depsBundleEsmEnabled = config?.optimizeDeps?.bundleEsm !== false;
  const depsSharedChunksMode = normalizeSharedChunksMode(config?.optimizeDeps?.sharedChunks);

  return {
    depsHash: computeDepsHash(configHash, lockfile, {
      nodeEnv,
      sourcemap: depsSourcemapEnabled,
      bundleEsm: depsBundleEsmEnabled,
      sharedChunks: depsSharedChunksMode,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    }),
    configHash,
  };
}

function readCanonicalLockfile(
  workspace: { workspaceRoot: string },
  rootDir: string,
): { contents: Buffer } | null {
  const lockfileOrder = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"];
  const roots = [...new Set([workspace.workspaceRoot, rootDir].map((root) => path.resolve(root)))];
  for (const root of roots) {
    for (const name of lockfileOrder) {
      const filePath = path.join(root, name);
      if (fs.existsSync(filePath)) {
        return { contents: fs.readFileSync(filePath) };
      }
    }
  }
  return null;
}

function resolveConfiguredEntries(config: any, rootDir: string): string[] | undefined {
  if (!config?.entry) return undefined;
  const entries = Array.isArray(config.entry) ? config.entry : [config.entry];
  return entries.map((entry: string) =>
    entry.startsWith("/") ? path.join(rootDir, entry) : path.resolve(rootDir, entry),
  );
}

function normalizeSharedChunksMode(sharedChunks: unknown): string {
  if (sharedChunks === undefined || sharedChunks === "auto") return "auto";
  if (sharedChunks === true) return "1";
  if (sharedChunks === false) return "0";
  return String(sharedChunks);
}
