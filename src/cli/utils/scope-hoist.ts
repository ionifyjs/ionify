import type { IonifyScopeHoistConfig } from "../../types/config";

export interface ScopeHoistResolution {
  enable: boolean;
  inlineFunctions: boolean;
  constantFolding: boolean;
  combineVariables: boolean;
}

export interface ResolveScopeHoistOptions {
  envMode?: string | undefined;
  inlineEnv?: string | undefined;
  constantEnv?: string | undefined;
  combineEnv?: string | undefined;
}

const DEFAULT_SCOPE_HOIST: ScopeHoistResolution = {
  enable: true,
  inlineFunctions: true,
  constantFolding: true,
  combineVariables: true,
};

function parseBool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "1", "yes", "on", "enable"].includes(normalized)) return true;
    if (["false", "0", "no", "off", "disable"].includes(normalized)) return false;
  }
  return null;
}

function parseEnvFlag(value: string | undefined): boolean | null {
  if (!value) return null;
  return parseBool(value);
}

function normalizeConfigFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

export function resolveScopeHoist(
  configValue: IonifyScopeHoistConfig | boolean | null | undefined,
  options: ResolveScopeHoistOptions = {}
): ScopeHoistResolution {
  let resolved: ScopeHoistResolution = { ...DEFAULT_SCOPE_HOIST };
  const scopeConfig = configValue;

  if (typeof scopeConfig === "boolean") {
    resolved.enable = scopeConfig;
  } else if (scopeConfig && typeof scopeConfig === "object") {
    resolved.enable = true;
    if (scopeConfig.inlineFunctions !== undefined) {
      resolved.inlineFunctions = !!scopeConfig.inlineFunctions;
    }
    if (scopeConfig.constantFolding !== undefined) {
      resolved.constantFolding = !!scopeConfig.constantFolding;
    }
    if (scopeConfig.combineVariables !== undefined) {
      resolved.combineVariables = !!scopeConfig.combineVariables;
    }
  }

  const envMode = parseEnvFlag(options.envMode);
  if (envMode !== null) {
    resolved.enable = envMode;
  }

  const inlineEnv = parseEnvFlag(options.inlineEnv);
  if (inlineEnv !== null) {
    resolved.inlineFunctions = inlineEnv;
  } else if (!resolved.enable) {
    resolved.inlineFunctions = false;
  }

  const constantEnv = parseEnvFlag(options.constantEnv);
  if (constantEnv !== null) {
    resolved.constantFolding = constantEnv;
  } else if (!resolved.enable) {
    resolved.constantFolding = false;
  }

  const combineEnv = parseEnvFlag(options.combineEnv);
  if (combineEnv !== null) {
    resolved.combineVariables = combineEnv;
  } else if (!resolved.enable) {
    resolved.combineVariables = false;
  }

  return resolved;
}

export function applyScopeHoistEnv(result: ScopeHoistResolution) {
  process.env.IONIFY_SCOPE_HOIST = result.enable ? "true" : "false";
  process.env.IONIFY_SCOPE_HOIST_INLINE = result.inlineFunctions ? "true" : "false";
  process.env.IONIFY_SCOPE_HOIST_CONST = result.constantFolding ? "true" : "false";
  process.env.IONIFY_SCOPE_HOIST_COMBINE = result.combineVariables ? "true" : "false";
}
