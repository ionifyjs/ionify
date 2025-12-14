// Intermediate Representation (IR) for Ionify
// TypeScript definitions matching the Rust IR types

export interface ModuleId {
  path: string;
  query?: string;
}

export enum DependencyKind {
  Static = 'Static',
  Dynamic = 'Dynamic',
  Css = 'Css',
  Asset = 'Asset',
}

export interface IonDependency {
  specifier: string;
  kind: DependencyKind;
  resolved_id?: ModuleId;
}

export interface IonModule {
  id: ModuleId;
  code: string;
  dependencies: IonDependency[];
  hash: string;
  transform_stats?: TransformStats;
}

export interface TransformStats {
  folded_constants: number;
  inlined_functions: number;
  dead_code_pruned: number;
  vars_merged: number;
  decls_removed: number;
  nodes_pruned: number;
}
