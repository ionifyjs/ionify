export type BuildPlanModuleKind = "js" | "css" | "asset";

export interface BuildPlanModule {
  id: string;
  fsPath?: string | null;
  hash?: string | null; // Optional to work with NAPI
  kind: BuildPlanModuleKind;
  deps: string[];
  dynamicDeps: string[];
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
