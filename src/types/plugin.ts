/**
{
  "description": "Defines the IonifyPlugin interface and related type helpers for onLoad/onTransform hooks.",
  "phase": 0,
  "todo": [
    "Define IonifyPlugin interface with onLoad/onTransform.",
    "Add TransformContext and TransformResult types.",
    "Export helper for creating typed plugins."
  ]
}
*/

import type { Loader, TransformContext, TransformResult } from "@core/transform";

export type IonifyLoader = Loader;

export interface IonifyPlugin {
  name: string;
  setup?: ((options: IonifyPluginContext) => void | Promise<void>) | ((...args: unknown[]) => void | Promise<void>);
  loaders?: IonifyLoader[];
  [key: string]: unknown;
}

export interface IonifyPluginContext {
  registerLoader(loader: IonifyLoader): void;
}

export type { TransformContext, TransformResult };



// ===== Next Phase TODOs =====
// Phase 3: Add onBundle() hook support.
// Phase 4: Enable Rust/WASM plugin types.
