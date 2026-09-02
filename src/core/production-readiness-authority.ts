import fs from "fs";
import path from "path";
import { getCacheKey } from "@core/cache";
import type { BuildPlan } from "../types/plan";

export const PRODUCTION_READINESS_AUTHORITY_VERSION = 1;
export const PRODUCTION_READINESS_RECORD_KIND = "deploy-ready.v1";

export type ProductionReadinessState = "missing" | "stale" | "partial" | "verified" | "invalid";

export type ProductionReadinessCompressionState = "verified" | "skipped" | "missing";

export type ProductionReadinessChunkArtifact = {
  id: string;
  files: {
    js: string[];
    css: string[];
    assets: string[];
  };
};

export type ProductionReadinessPublicAsset = {
  file: string;
  bytes: number;
  hash: string;
};

export type ProductionReadinessIdentity = {
  praVersion: typeof PRODUCTION_READINESS_AUTHORITY_VERSION;
  kind: typeof PRODUCTION_READINESS_RECORD_KIND;
  configHash: string;
  workspaceHash: string;
  depsHash: string;
  productionPlanHash: string;
  tier4ChunkManifestHash: string | null;
  distOutputManifestHash: string | null;
  compressionManifestHash: string | null;
  compressionState: ProductionReadinessCompressionState;
  publicAssetManifestHash: string | null;
  integrityPolicyHash: string | null;
  engineVersion: string;
  depsOptimizerOutputVersion: string;
};

export type ProductionReadinessRecord = {
  version: typeof PRODUCTION_READINESS_AUTHORITY_VERSION;
  kind: typeof PRODUCTION_READINESS_RECORD_KIND;
  state: ProductionReadinessState;
  identityHash: string;
  identity: ProductionReadinessIdentity;
  proofs: {
    workspace: {
      workspaceRoot: string;
      projectRoot: string;
    };
    dist: {
      manifestHash: string | null;
      buildStatsHash: string | null;
      assetsManifestHash: string | null;
      indexHtmlHash: string | null;
    };
    compression: {
      state: ProductionReadinessCompressionState;
      manifestHash: string | null;
    };
    publicAssets: {
      assets: ProductionReadinessPublicAsset[];
      conflicts: string[];
    };
  };
  metadata: {
    updatedAt: string;
    producer: "build" | "publish-contracts" | "publish-artifacts";
  };
};

export type CreateProductionReadinessRecordInput = {
  configHash: string;
  workspaceRoot: string;
  projectRoot: string;
  depsHash: string;
  plan: BuildPlan;
  artifacts: ProductionReadinessChunkArtifact[];
  dist: {
    manifestHash: string;
    buildStatsHash: string;
    assetsManifestHash?: string | null;
    indexHtmlHash?: string | null;
  };
  compression: {
    state: ProductionReadinessCompressionState;
    manifestHash?: string | null;
  };
  publicAssets: {
    assets: ProductionReadinessPublicAsset[];
    conflicts: string[];
  };
  integrityPolicyHash?: string | null;
  engineVersion?: string | null;
  depsOptimizerOutputVersion: string | number;
  updatedAt?: string;
};

export type CreatePartialProductionReadinessRecordInput = {
  producer: "publish-contracts" | "publish-artifacts";
  configHash: string;
  workspaceRoot: string;
  projectRoot: string;
  depsHash: string;
  plan: BuildPlan;
  tier4ChunkManifestHash?: string | null;
  integrityPolicyHash?: string | null;
  engineVersion?: string | null;
  depsOptimizerOutputVersion: string | number;
  updatedAt?: string;
};

export type ProductionReadinessPlanValidationInput = {
  configHash: string;
  workspaceRoot: string;
  projectRoot: string;
  depsHash: string;
  plan: BuildPlan;
  depsOptimizerOutputVersion: string | number;
  engineVersion?: string | null;
};

export function resolveProductionReadinessRecordPath(ionifyDir: string): string {
  return path.join(ionifyDir, "production-readiness", "deploy-ready.v1.json");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

export function hashStable(value: unknown): string {
  return getCacheKey(stableJson(value));
}

export function hashFileIfExists(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return getCacheKey(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

export function computeProductionPlanHash(plan: BuildPlan): string {
  return hashStable({
    entries: [...plan.entries].sort(),
    chunks: plan.chunks.map((chunk) => ({
      id: chunk.id,
      entry: chunk.entry,
      shared: chunk.shared,
      consumers: [...(chunk.consumers ?? [])].sort(),
      css: [...(chunk.css ?? [])].sort(),
      assets: [...(chunk.assets ?? [])].sort(),
      modules: chunk.modules.map((mod) => ({
        id: mod.id,
        fsPath: mod.fsPath ?? null,
        hash: mod.hash ?? null,
        kind: mod.kind,
        deps: [...(mod.deps ?? [])].sort(),
        dynamicDeps: [...(mod.dynamicDeps ?? [])].sort(),
        dependencyFormat: mod.dependencyFormat ?? null,
        usedExports: mod.usedExports ? [...mod.usedExports].sort() : null,
        dependencyAbiHash: mod.dependencyAbiHash ?? null,
        sideEffects: mod.sideEffects ?? null,
      })),
    })),
  });
}

export function computeTier4ChunkManifestHash(artifacts: ProductionReadinessChunkArtifact[]): string {
  return hashStable(
    artifacts.map((artifact) => ({
      id: artifact.id,
      files: {
        js: [...(artifact.files.js ?? [])].sort(),
        css: [...(artifact.files.css ?? [])].sort(),
        assets: [...(artifact.files.assets ?? [])].sort(),
      },
    })),
  );
}

export function computeDistOutputManifestHash(input: {
  manifestHash: string;
  buildStatsHash: string;
  assetsManifestHash?: string | null;
  indexHtmlHash?: string | null;
}): string {
  return hashStable({
    manifestHash: input.manifestHash,
    buildStatsHash: input.buildStatsHash,
    assetsManifestHash: input.assetsManifestHash ?? null,
    indexHtmlHash: input.indexHtmlHash ?? null,
  });
}

export function computePublicAssetManifestHash(input: {
  assets: ProductionReadinessPublicAsset[];
  conflicts: string[];
}): string {
  return hashStable({
    assets: input.assets.map((asset) => ({
      file: asset.file,
      bytes: asset.bytes,
      hash: asset.hash,
    })),
    conflicts: [...input.conflicts].sort(),
  });
}

export function createProductionReadinessRecord(
  input: CreateProductionReadinessRecordInput,
): ProductionReadinessRecord {
  const workspaceHash = hashStable({
    workspaceRoot: input.workspaceRoot,
    projectRoot: input.projectRoot,
  });
  const productionPlanHash = computeProductionPlanHash(input.plan);
  const tier4ChunkManifestHash = computeTier4ChunkManifestHash(input.artifacts);
  const distOutputManifestHash = computeDistOutputManifestHash(input.dist);
  const publicAssetManifestHash = computePublicAssetManifestHash(input.publicAssets);
  const compressionManifestHash = input.compression.manifestHash ?? null;
  const compressionState = input.compression.state;
  const hasRequiredOutputProofs =
    input.configHash.length > 0 &&
    input.depsHash.length > 0 &&
    input.dist.manifestHash.length > 0 &&
    input.dist.buildStatsHash.length > 0 &&
    input.artifacts.length > 0;
  const state: ProductionReadinessState =
    hasRequiredOutputProofs &&
    compressionState === "verified" &&
    compressionManifestHash &&
    input.publicAssets.conflicts.length === 0
      ? "verified"
      : "partial";

  const identity: ProductionReadinessIdentity = {
    praVersion: PRODUCTION_READINESS_AUTHORITY_VERSION,
    kind: PRODUCTION_READINESS_RECORD_KIND,
    configHash: input.configHash,
    workspaceHash,
    depsHash: input.depsHash,
    productionPlanHash,
    tier4ChunkManifestHash,
    distOutputManifestHash,
    compressionManifestHash,
    compressionState,
    publicAssetManifestHash,
    integrityPolicyHash: input.integrityPolicyHash ?? null,
    engineVersion: input.engineVersion ?? getIonifyEngineVersion(),
    depsOptimizerOutputVersion: String(input.depsOptimizerOutputVersion),
  };

  return {
    version: PRODUCTION_READINESS_AUTHORITY_VERSION,
    kind: PRODUCTION_READINESS_RECORD_KIND,
    state,
    identityHash: hashStable(identity),
    identity,
    proofs: {
      workspace: {
        workspaceRoot: input.workspaceRoot,
        projectRoot: input.projectRoot,
      },
      dist: {
        manifestHash: input.dist.manifestHash,
        buildStatsHash: input.dist.buildStatsHash,
        assetsManifestHash: input.dist.assetsManifestHash ?? null,
        indexHtmlHash: input.dist.indexHtmlHash ?? null,
      },
      compression: {
        state: compressionState,
        manifestHash: compressionManifestHash,
      },
      publicAssets: {
        assets: input.publicAssets.assets.map((asset) => ({ ...asset })),
        conflicts: [...input.publicAssets.conflicts].sort(),
      },
    },
    metadata: {
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      producer: "build",
    },
  };
}

export function createPartialProductionReadinessRecord(
  input: CreatePartialProductionReadinessRecordInput,
): ProductionReadinessRecord {
  const workspaceHash = hashStable({
    workspaceRoot: input.workspaceRoot,
    projectRoot: input.projectRoot,
  });
  const identity: ProductionReadinessIdentity = {
    praVersion: PRODUCTION_READINESS_AUTHORITY_VERSION,
    kind: PRODUCTION_READINESS_RECORD_KIND,
    configHash: input.configHash,
    workspaceHash,
    depsHash: input.depsHash,
    productionPlanHash: computeProductionPlanHash(input.plan),
    tier4ChunkManifestHash: input.tier4ChunkManifestHash ?? null,
    distOutputManifestHash: null,
    compressionManifestHash: null,
    compressionState: "missing",
    publicAssetManifestHash: null,
    integrityPolicyHash: input.integrityPolicyHash ?? null,
    engineVersion: input.engineVersion ?? getIonifyEngineVersion(),
    depsOptimizerOutputVersion: String(input.depsOptimizerOutputVersion),
  };

  return {
    version: PRODUCTION_READINESS_AUTHORITY_VERSION,
    kind: PRODUCTION_READINESS_RECORD_KIND,
    state: "partial",
    identityHash: hashStable(identity),
    identity,
    proofs: {
      workspace: {
        workspaceRoot: input.workspaceRoot,
        projectRoot: input.projectRoot,
      },
      dist: {
        manifestHash: null,
        buildStatsHash: null,
        assetsManifestHash: null,
        indexHtmlHash: null,
      },
      compression: {
        state: "missing",
        manifestHash: null,
      },
      publicAssets: {
        assets: [],
        conflicts: [],
      },
    },
    metadata: {
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      producer: input.producer,
    },
  };
}

export function writeProductionReadinessRecord(ionifyDir: string, record: ProductionReadinessRecord): void {
  const recordPath = resolveProductionReadinessRecordPath(ionifyDir);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  const tmpPath = `${recordPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, recordPath);
}

export function readProductionReadinessRecord(ionifyDir: string): ProductionReadinessRecord | null {
  const recordPath = resolveProductionReadinessRecordPath(ionifyDir);
  try {
    const raw = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    if (!isProductionReadinessRecord(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function isVerifiedProductionReadinessForPlan(
  record: ProductionReadinessRecord | null,
  input: ProductionReadinessPlanValidationInput,
): boolean {
  if (!record || record.state !== "verified") return false;
  const identity = record.identity;
  if (identity.configHash !== input.configHash) return false;
  if (identity.depsHash !== input.depsHash) return false;
  if (identity.depsOptimizerOutputVersion !== String(input.depsOptimizerOutputVersion)) return false;
  if (identity.engineVersion !== (input.engineVersion ?? getIonifyEngineVersion())) return false;
  if (
    identity.workspaceHash !==
    hashStable({
      workspaceRoot: input.workspaceRoot,
      projectRoot: input.projectRoot,
    })
  ) {
    return false;
  }
  if (identity.productionPlanHash !== computeProductionPlanHash(input.plan)) return false;
  return true;
}

function isProductionReadinessRecord(value: unknown): value is ProductionReadinessRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as ProductionReadinessRecord;
  if (record.version !== PRODUCTION_READINESS_AUTHORITY_VERSION) return false;
  if (record.kind !== PRODUCTION_READINESS_RECORD_KIND) return false;
  if (typeof record.identityHash !== "string" || record.identityHash.length === 0) return false;
  if (!record.identity || typeof record.identity !== "object") return false;
  if (hashStable(record.identity) !== record.identityHash) return false;
  return true;
}

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForStableJson);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = normalizeForStableJson((value as Record<string, unknown>)[key]);
  }
  return out;
}

export function getIonifyEngineVersion(): string {
  const candidates = ["../package.json", "../../package.json"];
  for (const candidate of candidates) {
    try {
      const pkgUrl = new URL(candidate, import.meta.url);
      const pkg = JSON.parse(fs.readFileSync(pkgUrl, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
    } catch {
      // Try the next bundled/source layout.
    }
  }
  try {
    const pkgPath = path.resolve(process.cwd(), "node_modules", "ionify", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {
    // Fall through to a stable explicit marker; optimizer version remains separate.
  }
  return "unknown";
}
