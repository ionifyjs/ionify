import { TransformEngine } from "@core/transform";
import { jsLoader } from "@core/loaders/js";
import type { IonifyConfig } from "../../types/config";
import type { IonifyLoader } from "../../types/plugin";

export type LoaderRegistration = (
  engine: TransformEngine,
  config?: IonifyConfig | null
) => void | Promise<void>;

const registry: LoaderRegistration[] = [];

export function registerLoader(registration: LoaderRegistration) {
  registry.push(registration);
}

export async function applyRegisteredLoaders(
  engine: TransformEngine,
  config?: IonifyConfig | null
) {
  for (const registration of registry) {
    await registration(engine, config ?? null);
  }

  if (config?.plugins) {
    for (const plugin of config.plugins) {
      if (plugin.loaders) {
        for (const loader of plugin.loaders) {
          engine.useLoader(loader);
        }
      }
      if (plugin.setup) {
        const context = {
          registerLoader: (loader: IonifyLoader) => {
            engine.useLoader(loader);
          },
        };
        await plugin.setup(context);
      }
    }
  }

  if (config?.loaders) {
    for (const loader of config.loaders) {
      engine.useLoader(loader);
    }
  }
}

// Built-in loaders
registerLoader((engine) => {
  engine.useLoader(jsLoader);
});
