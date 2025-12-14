import type {
  IonifyOptimizationLevel,
} from "../../types/config";
import type { MinifierChoice } from "./minifier";
import type { TreeshakeResolution } from "./treeshake";
import type { ScopeHoistResolution } from "./scope-hoist";

export interface OptimizationPreset {
  minifier: MinifierChoice;
  treeshake: TreeshakeResolution;
  scopeHoist: ScopeHoistResolution;
}

/**
 * Maps optimization level to feature presets.
 * - Level 0: Disabled (debugging)
 * - Level 1: Safe (inline + safe treeshake + minify)
 * - Level 2: Balanced (+ const fold + combine vars)
 * - Level 3: Aggressive (+ aggressive treeshake + all folding)
 */
export function getOptimizationPreset(level: IonifyOptimizationLevel): OptimizationPreset {
  switch (level) {
    case 0:
      return {
        minifier: "swc",
        treeshake: {
          mode: "off",
          include: [],
          exclude: [],
        },
        scopeHoist: {
          enable: false,
          inlineFunctions: false,
          constantFolding: false,
          combineVariables: false,
        },
      };

    case 1:
      return {
        minifier: "oxc",
        treeshake: {
          mode: "safe",
          include: [],
          exclude: [],
        },
        scopeHoist: {
          enable: true,
          inlineFunctions: true,
          constantFolding: false,
          combineVariables: false,
        },
      };

    case 2:
      return {
        minifier: "oxc",
        treeshake: {
          mode: "safe",
          include: [],
          exclude: [],
        },
        scopeHoist: {
          enable: true,
          inlineFunctions: true,
          constantFolding: true,
          combineVariables: true,
        },
      };

    case 3:
      return {
        minifier: "oxc",
        treeshake: {
          mode: "aggressive",
          include: [],
          exclude: [],
        },
        scopeHoist: {
          enable: true,
          inlineFunctions: true,
          constantFolding: true,
          combineVariables: true,
        },
      };

    default:
      return getOptimizationPreset(2); // default to balanced
  }
}

/**
 * Resolves optimization level from CLI flag, env, or config.
 * Precedence: CLI > ENV > Config > Default (2)
 */
export function resolveOptimizationLevel(
  configLevel: IonifyOptimizationLevel | undefined,
  options: {
    cliLevel?: number | string;
    envLevel?: string;
  } = {}
): IonifyOptimizationLevel | null {
  // CLI flag has highest priority
  if (options.cliLevel !== undefined) {
    const parsed = typeof options.cliLevel === "number" ? options.cliLevel : parseInt(options.cliLevel, 10);
    if ([0, 1, 2, 3].includes(parsed)) {
      return parsed as IonifyOptimizationLevel;
    }
  }

  // Env var next
  if (options.envLevel) {
    const parsed = parseInt(options.envLevel, 10);
    if ([0, 1, 2, 3].includes(parsed)) {
      return parsed as IonifyOptimizationLevel;
    }
  }

  // Config last
  if (configLevel !== undefined && [0, 1, 2, 3].includes(configLevel)) {
    return configLevel;
  }

  // Return null to indicate no level specified (let individual settings take precedence)
  return null;
}
