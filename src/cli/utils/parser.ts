import type { IonifyConfig } from "@types/config";

export type ParserMode = "oxc" | "swc" | "hybrid";

function normalize(mode?: string | null): ParserMode | null {
  if (typeof mode !== "string") return null;
  const lower = mode.toLowerCase();
  if (lower === "swc") return "swc";
  if (lower === "hybrid") return "hybrid";
  if (lower === "oxc") return "oxc";
  return null;
}

export function resolveParser(config?: IonifyConfig | null, opts?: { envMode?: string | undefined | null }): ParserMode {
  const envRaw = opts?.envMode ?? process.env.IONIFY_PARSER;
  const env = normalize(envRaw);
  if (env) return env;
  const fromConfig = normalize((config as any)?.parser);
  return fromConfig ?? "hybrid"; // Default to hybrid for production safety
}

export function applyParserEnv(mode: ParserMode) {
  process.env.IONIFY_PARSER = mode;
}
