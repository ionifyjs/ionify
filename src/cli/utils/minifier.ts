import type { IonifyConfig } from "../../types/config";

export type MinifierChoice = 'oxc' | 'swc' | 'auto';

function normalize(value: unknown): MinifierChoice | null {
  if (value === 'oxc' || value === 'swc' || value === 'auto') return value;
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v === 'oxc' || v === 'swc' || v === 'auto') return v;
  }
  return null;
}

export interface ResolveMinifierOptions {
  cliFlag?: string | undefined; // e.g., from --minifier
  envVar?: string | undefined; // e.g., process.env.IONIFY_MINIFIER
}

/**
 * Precedence: CLI flag > Env var > ionify.config.ts > default ('auto').
 */
export function resolveMinifier(config: IonifyConfig | null | undefined, opts: ResolveMinifierOptions = {}): MinifierChoice {
  const fromCli = normalize(opts.cliFlag);
  if (fromCli) return fromCli;
  const fromEnv = normalize(opts.envVar);
  if (fromEnv) return fromEnv;
  const fromConfig = normalize(config?.minifier);
  if (fromConfig) return fromConfig;
  return 'auto';
}

/**
 * Minimal wiring: set IONIFY_MINIFIER just-in-time before calling native layer.
 * Keeps existing native behavior intact while honoring resolved selection.
 */
export function applyMinifierEnv(choice: MinifierChoice) {
  process.env.IONIFY_MINIFIER = choice;
}
