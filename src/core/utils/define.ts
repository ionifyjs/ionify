/**
 * Define Plugin - AST-safe global constant replacements
 * Replaces identifiers and member expressions with literal values at compile time
 * Similar to Vite's define feature and webpack's DefinePlugin
 */

export type DefineConfig = Record<string, any>;

/**
 * Apply define replacements to transformed code
 * This performs simple string replacement for common patterns
 * 
 * IMPORTANT: This is applied AFTER transform, so it works on valid JS
 * More complex cases (like nested scope shadowing) are handled by Rust visitor (Phase 5.4.4)
 */
export function applyDefineReplacements(
  code: string,
  definitions: DefineConfig
): string {
  if (!definitions || Object.keys(definitions).length === 0) {
    return code;
  }

  let result = code;
  
  // Sort keys by length (longest first) to avoid partial replacements.
  // This ensures import.meta.env.VITE_FOO (longer) is replaced before
  // the fallback import.meta.env object replacement (shorter).
  const sortedKeys = Object.keys(definitions).sort((a, b) => b.length - a.length);
  
  for (const key of sortedKeys) {
    // Skip the special import.meta.env object key — handled in the final pass below.
    if (key === "import.meta.env") continue;

    const value = definitions[key];
    
    // Convert value to string representation
    let replacement: string;
    if (typeof value === "string") {
      // If value already looks like a JSON string (starts with quote), use as-is
      // Otherwise, JSON.stringify it
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        replacement = value;
      } else {
        replacement = JSON.stringify(value);
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      replacement = String(value);
    } else if (value === null || value === undefined) {
      replacement = "null";
    } else {
      // Objects/arrays - JSON stringify
      replacement = JSON.stringify(value);
    }
    
    // Handle different patterns
    if (key.includes(".")) {
      // Member expression like "process.env.NODE_ENV" or "import.meta.env.MODE"
      result = replaceMemberExpression(result, key, replacement);
    } else {
      // Simple identifier like "__VERSION__"
      result = replaceIdentifier(result, key, replacement);
    }
  }

  // Final pass: replace any remaining `import.meta.env` references with the
  // full env object literal. This pass deliberately uses a lookahead that
  // allows the match even when followed by `.UNKNOWN_KEY` — which is exactly
  // the pattern that breaks at browser runtime when left unreplaced.
  //
  // Why this is safe:
  //   - All KNOWN `import.meta.env.VITE_FOO` references were already replaced
  //     in the main loop above (longer key = higher sort priority), so only
  //     references to UNKNOWN keys remain.
  //   - Replacing `import.meta.env.VITE_UNKNOWN` with `{...obj...}.VITE_UNKNOWN`
  //     yields `undefined` at runtime — safe, and unblocks the `||` fallback.
  //   - Bare `import.meta.env` references (destructuring, spread, assignments)
  //     are also covered here even if not caught by the main loop.
  if ("import.meta.env" in definitions) {
    const envObj = definitions["import.meta.env"];
    let envObjLiteral: string;
    if (typeof envObj === "string" && envObj.startsWith("{")) {
      envObjLiteral = envObj;
    } else {
      envObjLiteral = JSON.stringify(envObj);
    }
    // Pattern: `import.meta.env` NOT preceded by word/dot, NOT followed by
    // a word character. The critical difference from replaceMemberExpression is
    // that `.` is NOT in the negative lookahead — so `import.meta.env.FOO`
    // (where FOO is unknown) is matched and `import.meta.env` is replaced by
    // the object literal, yielding `{...}.FOO` → undefined (not TypeError).
    result = result.replace(/(?<![\w.$])import\.meta\.env(?!\w)/g, envObjLiteral);
  }
  
  return result;
}

/**
 * Replace a simple identifier (e.g., __VERSION__)
 * Uses word boundaries to avoid partial matches
 */
function replaceIdentifier(code: string, identifier: string, replacement: string): string {
  // Match identifier as whole word (not part of another identifier)
  // Negative lookbehind: not preceded by word char or dot
  // Negative lookahead: not followed by word char
  const regex = new RegExp(
    `(?<![\\w.$])${escapeRegExp(identifier)}(?![\\w])`,
    'g'
  );
  return code.replace(regex, replacement);
}

/**
 * Replace a member expression (e.g., process.env.NODE_ENV)
 * Handles optional chaining and different quote styles
 */
function replaceMemberExpression(code: string, expression: string, replacement: string): string {
  // Split into parts: "process.env.NODE_ENV" -> ["process", "env", "NODE_ENV"]
  const parts = expression.split('.');
  
  // Build regex pattern: process\.env\.NODE_ENV
  // Allow optional spaces around dots
  const pattern = parts.map(escapeRegExp).join('\\s*\\.\\s*');
  
  // Match the pattern, but not when it's part of a larger expression
  // Negative lookbehind: not preceded by word char or dot
  // Negative lookahead: not followed by word char or dot
  const regex = new RegExp(
    `(?<![\\w.$])${pattern}(?![\\w.])`,
    'g'
  );
  
  return code.replace(regex, replacement);
}

/**
 * Escape special regex characters
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  if (!("import.meta.env.DEV" in define)) {
    define["import.meta.env.DEV"] = envValues.MODE !== "production";
  }
  if (!("import.meta.env.PROD" in define)) {
    define["import.meta.env.PROD"] = envValues.MODE === "production";
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
    const isDev = envValues.MODE !== "production";
    const envObj: Record<string, unknown> = {
      MODE: envValues.MODE ?? "development",
      DEV: isDev,
      PROD: !isDev,
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
