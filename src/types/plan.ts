/** "dep" = pre-built Tier-2 dep optimizer artifact (T19 dep-leaf graph node) */
export type BuildPlanModuleKind = "js" | "css" | "asset" | "dep";

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
  productionClosureHash?: string | null;
  sideEffects?: "none" | "present" | "unknown" | null;
  artifactTopology?: "wrapper" | "esm-native" | "esm-native-slim" | null;
}

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
