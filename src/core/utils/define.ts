/**
 * Define Plugin - AST-safe global constant replacements
 * Replaces identifiers and member expressions with literal values at compile time
 * Similar to Vite's define feature and webpack's DefinePlugin
 */

import { native } from "@native/index";

export type DefineConfig = Record<string, any>;

/** One entry of the native Define recipe (value-formatted, longest-first). */
export interface DefineRecipeEntry {
  key: string;
  replacement: string;
  isMember: boolean;
}

/**
 * Apply define replacements to transformed code (post-Transform string rewrite).
 *
 * The code-rewrite semantic is the **single canonical native
 * implementation** (`apply_define_replacements`, transform/define_apply.rs).
 * This TS function is transport only — it value-formats the config into a recipe
 * and delegates. `buildDefineRecipe` performs value formatting + longest-first
 * ordering + the `import.meta.env` object literal (config-time), never the code
 * rewrite. The old TS regex scanner was deleted; the native scanner is
 * byte-identical (validated by the parity corpus in tests/).
 */
export function applyDefineReplacements(
  code: string,
  definitions: DefineConfig
): string {
  if (!definitions || Object.keys(definitions).length === 0) {
    return code;
  }
  if (!native?.applyDefineReplacements) {
    throw new Error("[define] canonical native applyDefineReplacements binding is unavailable");
  }
  const { replacements, importMetaEnvLiteral } = buildDefineRecipe(definitions);
  return native.applyDefineReplacements(code, replacements, importMetaEnvLiteral ?? undefined);
}

/**
 * Transport: turn the define config into the native recipe — value formatting
 * (JSON quoting), longest-first key ordering, and the `import.meta.env` object
 * literal. This is config preparation, NOT the code-rewrite semantic (which is
 * native). Exported so the parity corpus can drive the same inputs.
 */
export function buildDefineRecipe(definitions: DefineConfig): {
  replacements: DefineRecipeEntry[];
  importMetaEnvLiteral: string | null;
} {
  // Longest-first so `import.meta.env.VITE_FOO` is replaced before the shorter
  // `import.meta.env` fallback.
  const sortedKeys = Object.keys(definitions).sort((a, b) => b.length - a.length);
  const replacements: DefineRecipeEntry[] = [];
  for (const key of sortedKeys) {
    if (key === "import.meta.env") continue; // handled by the literal fallback
    const value = definitions[key];
    let replacement: string;
    if (typeof value === "string") {
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        replacement = value;
      } else {
        replacement = JSON.stringify(value);
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      replacement = String(value);
    } else if (value === null || value === undefined) {
      replacement = "null";
    } else {
      replacement = JSON.stringify(value);
    }
    replacements.push({ key, replacement, isMember: key.includes(".") });
  }
  let importMetaEnvLiteral: string | null = null;
  if ("import.meta.env" in definitions) {
    const envObj = definitions["import.meta.env"];
    importMetaEnvLiteral =
      typeof envObj === "string" && envObj.startsWith("{") ? envObj : JSON.stringify(envObj);
  }
  return { replacements, importMetaEnvLiteral };
}

/**
 * Build define config from environment variables
 * Auto-exposes variables starting with VITE_ or IONIFY_ as import.meta.env.*
 *
 * Two replacement strategies are used together:
 *  1. Individual key entries (`import.meta.env.VITE_FOO` → `"bar"`) for known vars.
 *     These are replaced first (longest key wins) and become simple literals.
 *  2. The `import.meta.env` object entry — a fallback that replaces any remaining
 *     `import.meta.env` reference (including `import.meta.env.UNKNOWN_KEY`) with the
 *     full env object literal. This prevents TypeError at runtime for unknown keys
 *     and makes the `|| fallback` pattern in user code work correctly.
 */
export function buildDefineConfig(
  userDefine: DefineConfig | undefined,
  envValues: Record<string, string>,
  envPrefix: string | string[] = ["VITE_", "IONIFY_"]
): DefineConfig {
  const define: DefineConfig = { ...(userDefine || {}) };
  
  // Normalize envPrefix to array
  const prefixes = Array.isArray(envPrefix) ? envPrefix : [envPrefix];

  // Collect the prefix-matched env vars for injecting into both individual keys
  // and the full import.meta.env object.
  const prefixedEnvVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(envValues)) {
    const hasPrefix = prefixes.some(prefix => key.startsWith(prefix));
    if (hasPrefix || key === "NODE_ENV" || key === "MODE") {
      prefixedEnvVars[key] = value;
    }
  }

  // 1. Individual key replacements: import.meta.env.VITE_FOO → "bar"
  for (const [key, value] of Object.entries(prefixedEnvVars)) {
    const importMetaKey = `import.meta.env.${key}`;
    if (!(importMetaKey in define)) {
      define[importMetaKey] = value;
    }
  }

  // Always define import.meta.env.DEV and import.meta.env.PROD
  const isProductionRuntime = envValues.NODE_ENV === "production";
  if (!("import.meta.env.DEV" in define)) {
    define["import.meta.env.DEV"] = !isProductionRuntime;
  }
  if (!("import.meta.env.PROD" in define)) {
    define["import.meta.env.PROD"] = isProductionRuntime;
  }

  // Compatibility: many ecosystem packages (React, React Router, etc.) still gate behavior on
  // process.env.NODE_ENV even in ESM builds. Default it so browser builds don't crash.
  if (!("process.env.NODE_ENV" in define) && typeof envValues.NODE_ENV === "string") {
    define["process.env.NODE_ENV"] = envValues.NODE_ENV;
  }
  if (!("process.env.MODE" in define) && typeof envValues.MODE === "string") {
    define["process.env.MODE"] = envValues.MODE;
  }

  // 2. Full import.meta.env object injection (fallback for unknown vars and
  //    bare-object usage patterns like destructuring / spread).
  //    Build the same shape Vite uses so project code can rely on it.
  if (!("import.meta.env" in define)) {
    const envObj: Record<string, unknown> = {
      MODE: envValues.MODE ?? "development",
      DEV: !isProductionRuntime,
      PROD: isProductionRuntime,
      BASE_URL: "/",
      SSR: false,
    };
    // Include all prefix-matched vars so destructuring / unknown-key access works.
    for (const [key, value] of Object.entries(prefixedEnvVars)) {
      envObj[key] = value;
    }
    define["import.meta.env"] = envObj;
  }

  return define;
}

/**
 * Vite-compatible `%ENV%` HTML/JS placeholder pattern: `%KEY%` with an uppercase
 * SCREAMING_SNAKE key (e.g. `%MODE%`, `%VITE_API_URL%`).
 */
export const ENV_PLACEHOLDER_PATTERN = /%([A-Z0-9_]+)%/g;

/**
 * Substitute Vite-style `%ENV%` placeholders in raw text (index.html, served JS).
 *
 * Replaces `%KEY%` with `envValues[KEY]` for `NODE_ENV`, `MODE`, and any
 * prefix-matched var (default `VITE_` / `IONIFY_`). Unknown or undefined keys are
 * left **unchanged** (Vite parity — an un-set `%FOO%` stays literal rather than
 * becoming an empty string, surfacing the missing var instead of silently 404ing).
 *
 * This is the SINGLE source of truth shared by the dev server (serve-time HTML/JS)
 * and the production build (`emitIndexHtml`), so the two pipelines can never drift —
 * the exact unification bug that left `%VITE_*%` un-substituted in `dist/index.html`.
 */
export function substituteEnvPlaceholders(
  input: string,
  envValues: Record<string, string>,
  envPrefix: string | string[] = ["VITE_", "IONIFY_"],
): string {
  const prefixes = Array.isArray(envPrefix) ? envPrefix : [envPrefix];
  return input.replace(ENV_PLACEHOLDER_PATTERN, (match, key) => {
    const known =
      key === "NODE_ENV" || key === "MODE" || prefixes.some((prefix) => key.startsWith(prefix));
    if (!known) return match;
    const replacement = envValues[key];
    return replacement !== undefined ? replacement : match;
  });
}
