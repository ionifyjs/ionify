/** "dep" = pre-built Tier-2 dep optimizer artifact (T19 dep-leaf graph node) */
export type BuildPlanModuleKind = "js" | "css" | "asset" | "dep";

export interface BuildPlanDependencyImportAbi {
  outFile: string;
  mode: string;
  names: string[];
  hasDefault: boolean;
  hasNamespace: boolean;
  hasSideEffect: boolean;
  hasExportStar: boolean;
  uncertain: boolean;
}

export interface BuildPlanDependencyAbi {
  version: number;
  names: string[];
  hasDefault: boolean;
  uncertain: boolean;
  abiHash: string;
  imports: BuildPlanDependencyImportAbi[];
}

export interface BuildPlanRuntimeLink {
  specifier: string;
  targetId: string;
  isDynamic: boolean;
}

export interface BuildPlanModule {
  id: string;
  fsPath?: string | null;
  hash?: string | null; // Optional to work with NAPI
  kind: BuildPlanModuleKind;
  deps: string[];
  dynamicDeps: string[];
  dependencyFormat?: "esm" | "cjs" | "unknown" | null;
  usedExports?: string[] | null;
  dependencyAbiHash?: string | null;
  dependencyAbi?: BuildPlanDependencyAbi | null;
  sideEffects?: "none" | "present" | "unknown" | null;
  artifactTopology?: "wrapper" | "esm-native" | "esm-native-slim" | null;
  runtimeDemandHash?: string | null;
  runtimeMutationVerified?: boolean;
  runtimeLinks?: BuildPlanRuntimeLink[] | null;
  // G2-C2: the exact Transform-owned materialized-byte identity TS admitted for
  // THIS plan (getCacheKey of the consumed bytes). Not a new artifact identity —
  // a plan-scoped pin. Native re-hashes the bytes it reads and rejects any
  // mismatch (defense-in-depth); Rust never reads the Transform proof itself.
  admittedOutputHash?: string | null;
  // G2-C3: the authority-owned admission contract that governs this artifact
  // (the durable provenance fact; see docs/gate-2-finding-ledger.md G2-C3).
  // `proofKind` identifies the REQUIRED contract — it does not assert the proof
  // is already materialized/admitted. Optional ONLY at the legacy/unsealed decode
  // boundary: a sealed *reusable* plan carries exactly one proofKind per
  // consumable module; a consumable reaching admission without one is
  // NonReusable and fails closed (no default, no path/flag inference).
  proofKind?: ProofKind | null;
}

/** G2-C3 admission-contract discriminant. Invariant: each value maps to exactly
 * one authority-owned admission contract (and thus one owning authority).
 * Consumers dispatch SOLELY on this value. */
export type ProofKind =
  | "DplContentHash" // owned by DPL — dependency artifact, byte-verified vs DPL artifactHash
  | "TransformArtifactProof"; // owned by Transform — app-source, verified vs TransformArtifactProof


export interface BuildPlanChunk {
  id: string;
  modules: BuildPlanModule[];
  entry: boolean;
  shared: boolean;
  consumers: string[];
  css: string[];
  assets: string[];
}

export interface BuildPlan {
  entries: string[];
  chunks: BuildPlanChunk[];
}
