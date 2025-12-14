export interface BuildChunkAsset {
  source: string;
  fileName: string;
}

export interface BuildChunkArtifact {
  id: string;
  fileName: string;
  code: string;
  map?: string;
  assets: BuildChunkAsset[];
  code_bytes: number;  // Match Rust snake_case naming
  map_bytes: number;   // Match Rust snake_case naming
}

export interface BuildPlanModule {
  id: string;
  hash?: string;
  kind: string;
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