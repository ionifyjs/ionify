/**
 * React Refresh Instrumentation Layer
 * 
 * NOTE:
 * This instrumentation layer is intentionally implemented outside OXC.
 * It mirrors what an eventual OXC-native React Refresh transform would emit.
 * Once OXC React Refresh support is stable, this file should be deleted and
 * its logic ported into an OXC transform/plugin.
 * 
 * ARCHITECTURE: This is a PURE EXTRACTION from js.ts (d63add4).
 * No logic changes - just organization for better testability and maintainability.
 */


export interface InstrumentOptions {
  code: string;
  filePath: string;
  ext: string;
  isDev: boolean;
  isEntry?: boolean;
}

export const REACT_REFRESH_RUNTIME_MODULE = "/__ionify_hmr_client.js";
export const REACT_REFRESH_HMR_CONTRACT_VERSION = "entry-root-full-reload-v1";

export interface InstrumentResult {
  shouldInstrument: boolean;
  prologue: string;
  registrations: string;
  epilogue: string;
}

// --- EXACT COPIES FROM js.ts (d63add4) ---


function isPascalCaseIdentifier(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(name);
}


function hasRefreshRegistrationsAlready(code: string): boolean {
  // Idempotency: if a future transform already injected refresh hooks, do nothing.
  // Keep it broad but safe.
  return /\$RefreshReg\$/.test(code);
}

function dedupeByExportName(
  items: Array<{ exportName: string; localName: string }>,
): Array<{ exportName: string; localName: string }> {
  const seen = new Set<string>();
  const out: Array<{ exportName: string; localName: string }> = [];
  for (const it of items) {
    const key = `${it.exportName}::${it.localName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function detectRefreshBoundaryExports(code: string): Array<{ exportName: string; localName: string }> {
  const out: Array<{ exportName: string; localName: string }> = [];

  function isValidIdentifier(name: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
  }

  // 1) exported function declarations: export function Foo() {} / export async function Foo() {}
  {
    const re = /export\s+(?:async\s+)?function\s+([A-Z][A-Za-z0-9_$]*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const name = m[1];
      out.push({ exportName: name, localName: name });
    }
  }

  // 2) exported const/let assigned to function/arrow:
  // export const Foo = () => {}
  // export const Foo = function() {}
  // export let Foo = async () => {}
  {
    const re =
      /export\s+(?:const|let)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const name = m[1];
      out.push({ exportName: name, localName: name });
    }
  }

  // 3) default export function named: export default function Foo() {}
  {
    const re = /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
    const m = re.exec(code);
    if (m?.[1]) {
      const local = m[1];
      if (isPascalCaseIdentifier(local)) {
        out.push({ exportName: "default", localName: local });
      }
    }
  }

  // 4) default export identifier: export default Foo;
  // (avoid matching "export default function" by checking that first)
  {
    const re = /export\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*;?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const local = m[1];
      // Skip if it's actually "export default function" or "export default class"
      if (local === "function" || local === "class") continue;
      if (isPascalCaseIdentifier(local)) {
        out.push({ exportName: "default", localName: local });
      }
    }
  }

  // 4.1) exported class declarations:
  // export class Foo extends React.Component {}
  // export default class Foo extends Component {}
  {
    const re = /export\s+(default\s+)?class\s+([A-Z][A-Za-z0-9_$]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const isDefault = Boolean(m[1]);
      const local = m[2];
      if (!isPascalCaseIdentifier(local)) continue;
      out.push({ exportName: isDefault ? "default" : local, localName: local });
    }
  }

  // 4.2) exported const/let assigned to class expressions:
  // export const Foo = class Foo extends React.Component {}
  // export const Foo = class extends React.Component {}
  {
    const re = /export\s+(?:const|let)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*class\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const name = m[1];
      if (!isPascalCaseIdentifier(name)) continue;
      out.push({ exportName: name, localName: name });
    }
  }

  // 5) export specifier list for local bindings:
  // export { Foo };
  // export { Foo as Bar };
  // export { Foo as default };
  // (skip re-exports: export { Foo } from "./x";)
  {
    const re = /export\s*{\s*([^}]+)\s*}\s*(?:from\s*(['"][^'"]+['"]))?\s*;?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const from = m[2];
      if (from) continue;

      const specList = m[1] ?? "";
      const parts = specList
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      for (const part of parts) {
        // TS can include "type" in export lists: export { type Foo }
        // Keep this pass value-safe by ignoring those.
        if (part.startsWith("type ")) continue;

        const asMatch = part.split(/\s+as\s+/);
        const local = (asMatch[0] ?? "").trim();
        const exported = (asMatch[1] ?? local).trim();

        if (!local || !exported) continue;
        if (local === "default") continue;
        if (!isValidIdentifier(local) || !isValidIdentifier(exported)) continue;
        if (!isPascalCaseIdentifier(local)) continue;
        if (exported !== "default" && !isPascalCaseIdentifier(exported)) continue;

        out.push({ exportName: exported, localName: local });
      }
    }
  }

  return dedupeByExportName(out);
}

async function buildReactRefreshRegistrations(code: string, _filePath: string): Promise<string> {
  if (hasRefreshRegistrationsAlready(code)) return "";

  const candidates = detectRefreshBoundaryExports(code);
  if (!candidates.length) return "";

  // Stable IDs: normalizeRefreshModuleId(import.meta.url) + ":" + exportName
  const lines = candidates.map(({ exportName, localName }) => {
    return (
      `window.$RefreshReg$?.(` +
      `${localName}, ` +
      `normalizeRefreshModuleId(import.meta.url) + ":" + ${JSON.stringify(exportName)}` +
      `);`
    );
  });

  return "\n" + lines.join("\n") + "\n";
}


function needsReactRefresh(ext: string, isDev: boolean): boolean {
  // Dev-only: production builds must not depend on dev server runtime routes.
  if (!isDev) return false;
  return ext === ".jsx" || ext === ".tsx";
}

export function hasReactRootRenderSideEffect(code: string): boolean {
  const sample = code.slice(0, 64 * 1024);
  return (
    /\bcreateRoot\s*\(/.test(sample) ||
    /\bhydrateRoot\s*\(/.test(sample) ||
    /\bReactDOM\s*\.\s*createRoot\s*\(/.test(sample) ||
    /\bReactDOM\s*\.\s*hydrateRoot\s*\(/.test(sample) ||
    /\bReactDOM\s*\.\s*render\s*\(/.test(sample)
  );
}

// --- PUBLIC API (wraps existing functions, preserves exact behavior) ---

/**
 * Instrument code with React Refresh hooks.
 * 
 * This function is a pure wrapper around the extracted helper functions.
 * It preserves the exact behavior from js.ts (d63add4).
 * 
 * @param options - Instrumentation options
 * @returns Instrumentation parts (prologue, registrations, epilogue)
 */
export async function instrumentReactRefresh(options: InstrumentOptions): Promise<InstrumentResult> {
  const { code, filePath, ext, isDev, isEntry = false } = options;

  if (!needsReactRefresh(ext, isDev)) {
    return { shouldInstrument: false, prologue: "", registrations: "", epilogue: "" };
  }

  const registrations = isEntry ? "" : await buildReactRefreshRegistrations(code, filePath);

  const prologue =
    `import { setupReactRefresh, normalizeRefreshModuleId } from "${REACT_REFRESH_RUNTIME_MODULE}";\n` +
    `const __ionifyRefresh__ = setupReactRefresh(import.meta.hot ?? { accept() {}, dispose() {} }, normalizeRefreshModuleId(import.meta.url));\n`;

  const shouldSelfAccept = !(isEntry && hasReactRootRenderSideEffect(code));
  const epilogue = shouldSelfAccept
    ? (
      `\n__ionifyRefresh__?.finalize?.();\n\n` +
      `if (import.meta.hot) {\n` +
      `  import.meta.hot.accept((newModule) => {\n` +
      `    __ionifyRefresh__?.refresh?.(newModule);\n` +
      `  });\n` +
      `  import.meta.hot.dispose(() => {\n` +
      `    __ionifyRefresh__?.dispose?.();\n` +
      `  });\n` +
      `}\n`
    )
    : `\n__ionifyRefresh__?.finalize?.();\n`;

  return { shouldInstrument: true, prologue, registrations, epilogue };
}
