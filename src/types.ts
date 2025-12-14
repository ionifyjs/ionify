export * from "./core/types/config";
export * from "./core/types/plan";

import type { IonifyConfig } from "./core/types/config";

export function defineConfig(config: IonifyConfig): IonifyConfig;
export function defineConfig(
  config: (env: { mode: string }) => IonifyConfig | Promise<IonifyConfig>
): IonifyConfig | Promise<IonifyConfig>;
export function defineConfig(
  config: IonifyConfig | ((env: { mode: string }) => IonifyConfig | Promise<IonifyConfig>)
): IonifyConfig | Promise<IonifyConfig> {
  if (typeof config === "function") {
    return config({ mode: process.env.NODE_ENV || "development" });
  }
  return config;
}
