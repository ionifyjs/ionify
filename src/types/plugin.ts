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



