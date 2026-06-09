export * from "./core/types/config";
export * from "./core/types/plan";
export * from "./runtime/federation";

import type { IonifyConfig, IonifyConfigEnv } from "./core/types/config";

export function defineConfig(config: IonifyConfig): IonifyConfig;
export function defineConfig(
  config: (env: IonifyConfigEnv) => IonifyConfig | Promise<IonifyConfig>
): (env: IonifyConfigEnv) => IonifyConfig | Promise<IonifyConfig>;
export function defineConfig(
  config: IonifyConfig | ((env: IonifyConfigEnv) => IonifyConfig | Promise<IonifyConfig>)
): IonifyConfig | ((env: IonifyConfigEnv) => IonifyConfig | Promise<IonifyConfig>) {
  return config;
}
