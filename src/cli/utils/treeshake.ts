import type { IonifyConfig, IonifyTreeShakeConfig } from "../../types/config";

export type TreeshakeResolvedMode = "off" | "safe" | "aggressive";

export interface TreeshakeResolution {
  mode: TreeshakeResolvedMode;
  include: string[];
  exclude: string[];
}

export interface ResolveTreeshakeOptions {
  envMode?: string | undefined;
  includeEnv?: string | undefined;
  excludeEnv?: string | undefined;
}

const DEFAULT_RESOLUTION: TreeshakeResolution = {
  mode: "safe",
  include: [],
  exclude: [],
};

function parseMode(value: string | undefined | null): TreeshakeResolvedMode | null {
  if (!value) return null;
  switch (value.toLowerCase()) {
    case "off":
    case "false":
      return "off";
    case "aggressive":
      return "aggressive";
    case "safe":
    case "true":
      return "safe";
    default:
      return null;
  }
}

function normalizeList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }
  return [];
}

function parseEnvList(raw: string | undefined): string[] | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeList(parsed);
  } catch {
    return null;
  }
}

function extractConfigObject(
  value: IonifyConfig["treeshake"]
): IonifyTreeShakeConfig | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as IonifyTreeShakeConfig;
  }
  return null;
}

export function resolveTreeshake(
  input?: IonifyConfig["treeshake"],
  options: ResolveTreeshakeOptions = {}
): TreeshakeResolution {
  let resolved: TreeshakeResolution = { ...DEFAULT_RESOLUTION };

  const objectValue = extractConfigObject(input);
  if (objectValue) {
    resolved.include = normalizeList(objectValue.include);
    resolved.exclude = normalizeList(objectValue.exclude);
    if (objectValue.mode) {
      const objectMode = parseMode(objectValue.mode);
      if (objectMode) {
        resolved.mode = objectMode;
      }
    }
  } else if (typeof input === "boolean") {
    resolved.mode = input ? "safe" : "off";
  } else if (typeof input === "string") {
    resolved.mode = parseMode(input) ?? DEFAULT_RESOLUTION.mode;
  }

  const envMode = parseMode(options.envMode);
  if (envMode) {
    resolved.mode = envMode;
  }

  const includeOverride = parseEnvList(options.includeEnv);
  if (includeOverride) {
    resolved.include = includeOverride;
  }

  const excludeOverride = parseEnvList(options.excludeEnv);
  if (excludeOverride) {
    resolved.exclude = excludeOverride;
  }

  return resolved;
}

export function applyTreeshakeEnv(resolved: TreeshakeResolution) {
  process.env.IONIFY_TREESHAKE = resolved.mode;
  process.env.IONIFY_TREESHAKE_INCLUDE = JSON.stringify(resolved.include);
  process.env.IONIFY_TREESHAKE_EXCLUDE = JSON.stringify(resolved.exclude);
}
