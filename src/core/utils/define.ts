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
  
  // Sort keys by length (longest first) to avoid partial replacements
  const sortedKeys = Object.keys(definitions).sort((a, b) => b.length - a.length);
  
  for (const key of sortedKeys) {
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
 */
export function buildDefineConfig(
  userDefine: DefineConfig | undefined,
  envValues: Record<string, string>,
  envPrefix: string | string[] = ["VITE_", "IONIFY_"]
): DefineConfig {
  const define: DefineConfig = { ...(userDefine || {}) };
  
  // Normalize envPrefix to array
  const prefixes = Array.isArray(envPrefix) ? envPrefix : [envPrefix];
  
  // Auto-expose env vars with matching prefixes
  for (const [key, value] of Object.entries(envValues)) {
    // Check if key starts with any of the prefixes
    const hasPrefix = prefixes.some(prefix => key.startsWith(prefix));
    
    if (hasPrefix || key === "NODE_ENV" || key === "MODE") {
      const importMetaKey = `import.meta.env.${key}`;
      // Only add if not already defined by user
      if (!(importMetaKey in define)) {
        define[importMetaKey] = value;
      }
    }
  }
  
  // Always define import.meta.env.DEV and import.meta.env.PROD
  if (!("import.meta.env.DEV" in define)) {
    define["import.meta.env.DEV"] = envValues.MODE !== "production";
  }
  if (!("import.meta.env.PROD" in define)) {
    define["import.meta.env.PROD"] = envValues.MODE === "production";
  }
  
  return define;
}
