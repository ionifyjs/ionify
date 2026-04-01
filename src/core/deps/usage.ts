import fs from "fs";
import path from "path";
import { parseSync } from "@swc/core";

import { resolveImport } from "@core/resolver";
import { native } from "@native/index";
import { computeSubpathFromEntryPath, registerDepEntry } from "@core/deps/registry";

export type DepUsage = {
  fileName: string;
  entryPath: string;
  packageName: string;
  packageVersion: string;
  usedExports: string[];
  hasNamespace: boolean;
  hasExportStar: boolean;
  importerKeys: string[];
  entryRootKeys: string[];
};

export type DepUsageIndex = Map<string, DepUsage>;

export type CanonicalDepFileNameIndex = Map<string, string>;

const SCAN_EXTS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

function isBareSpecifier(spec: string): boolean {
  if (!spec) return false;
  return (
    !spec.startsWith(".") &&
    !spec.startsWith("/") &&
    !spec.startsWith("http://") &&
    !spec.startsWith("https://")
  );
}

function getStringLiteralValue(node: any): string | null {
  if (!node || typeof node !== "object") return null;
  const type = node.type;
  if (type === "StringLiteral" || type === "Str") {
    const value = (node as any).value;
    return typeof value === "string" ? value : null;
  }
  if (type === "Literal") {
    const value = (node as any).value;
    return typeof value === "string" ? value : null;
  }
  return null;
}

function collectDynamicImports(node: any, out: string[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectDynamicImports(item, out);
    return;
  }

  if (node.type === "CallExpression" || node.type === "CallExpr") {
    const callee = (node as any).callee;
    if (callee && typeof callee === "object" && callee.type === "Import") {
      const args = (node as any).arguments ?? (node as any).args ?? [];
      const first = Array.isArray(args) ? args[0] : null;
      const expr = first?.expression ?? first?.expr ?? first;
      const value = getStringLiteralValue(expr);
      if (value) out.push(value);
    }
  }

  for (const value of Object.values(node)) {
    collectDynamicImports(value as any, out);
  }
}

function parseModuleForUsage(
  absPath: string,
  code: string,
): Array<{
  source: string;
  imported: { kind: "default" | "namespace" | "named" | "export-star"; name?: string }[];
}> {
  const ext = path.extname(absPath).toLowerCase();
  const isTypeScript = ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts";
  const isTsx = ext === ".tsx";
  const isJsx = ext === ".jsx";

  let ast: any;
  try {
    ast = parseSync(code, {
      syntax: isTypeScript ? "typescript" : "ecmascript",
      tsx: isTypeScript ? isTsx : false,
      jsx: !isTypeScript ? isJsx : false,
      decorators: true,
      dynamicImport: true,
      importAssertions: true,
    } as any);
  } catch {
    return [];
  }

  const out: Array<{
    source: string;
    imported: { kind: "default" | "namespace" | "named" | "export-star"; name?: string }[];
  }> = [];

  const body: any[] = Array.isArray(ast?.body) ? ast.body : [];
  for (const item of body) {
    if (!item || typeof item.type !== "string") continue;

    if (item.type === "ImportDeclaration") {
      const source = item.source?.value;
      if (typeof source !== "string") continue;
      const imported: { kind: "default" | "namespace" | "named" | "export-star"; name?: string }[] = [];
      const specs: any[] = Array.isArray(item.specifiers) ? item.specifiers : [];
      for (const spec of specs) {
        if (!spec || typeof spec.type !== "string") continue;
        if (spec.isTypeOnly === true) continue;
        if (spec.type === "ImportDefaultSpecifier") {
          imported.push({ kind: "default" });
        } else if (spec.type === "ImportNamespaceSpecifier") {
          imported.push({ kind: "namespace" });
        } else if (spec.type === "ImportSpecifier") {
          const importedName = spec.imported?.value ?? spec.local?.value;
          if (typeof importedName === "string" && importedName.length > 0) {
            imported.push({
              kind: importedName === "default" ? "default" : "named",
              name: importedName,
            });
          }
        }
      }
      out.push({ source, imported });
      continue;
    }

    if (item.type === "ExportNamedDeclaration") {
      const source = item.source?.value;
      if (typeof source !== "string") continue;
      const imported: { kind: "default" | "namespace" | "named" | "export-star"; name?: string }[] = [];
      const specs: any[] = Array.isArray(item.specifiers) ? item.specifiers : [];
      for (const spec of specs) {
        if (!spec || typeof spec.type !== "string") continue;
        if (spec.type === "ExportSpecifier") {
          const named = spec?.orig ?? spec?.local ?? spec?.exported;
          const exported = spec?.exported ?? named;
          const name = exported?.value ?? named?.value;
          if (typeof name === "string" && name.length > 0) {
            imported.push({
              kind: name === "default" ? "default" : "named",
              name,
            });
          }
        } else if (spec.type === "ExportNamespaceSpecifier") {
          imported.push({ kind: "namespace" });
        }
      }
      out.push({ source, imported });
      continue;
    }

    if (item.type === "ExportAllDeclaration") {
      const source = item.source?.value;
      if (typeof source !== "string") continue;
      out.push({ source, imported: [{ kind: "export-star" }] });
      continue;
    }
  }

  // Dynamic imports: we only use them for graph traversal (local deps),
  // but they don't contribute stable named-export usage in Phase 5.5.
  const dynamic: string[] = [];
  collectDynamicImports(ast, dynamic);
  for (const source of dynamic) {
    if (typeof source === "string" && source.length > 0) {
      out.push({ source, imported: [] });
    }
  }

  return out;
}

function resolveDepEntryForBareImport(
  spec: string,
  importerAbs: string,
): { fileName: string; entryPath: string; packageName: string; packageVersion: string } | null {
  const resolved = native?.resolveModule ? native.resolveModule(spec, importerAbs) : null;
  const kind = (resolved as any)?.kind;
  if (!resolved || kind === "Builtin" || kind === "Virtual" || kind === "NotFound") return null;
  const fsPath = (resolved as any)?.fsPath ?? (resolved as any)?.fs_path ?? null;
  if (typeof fsPath !== "string" || fsPath.length === 0) return null;

  const pkg = (resolved as any)?.pkg ?? null;
  const packageName = (pkg && typeof pkg.name === "string" && pkg.name.length > 0) ? pkg.name : spec;
  const packageVersion = (pkg && typeof pkg.version === "string" && pkg.version.length > 0) ? pkg.version : "0.0.0";
  const subpath = computeSubpathFromEntryPath(fsPath);

  const dep = registerDepEntry({
    entryPath: fsPath,
    packageName,
    packageVersion,
    subpath,
  });

  return { fileName: dep.fileName, entryPath: fsPath, packageName, packageVersion };
}

function safeRealpath(absPath: string): string {
  const resolved = path.resolve(absPath);
  try {
    const nativeFn = (fs.realpathSync as any).native as ((p: string) => string) | undefined;
    return nativeFn ? nativeFn(resolved) : fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function dedupeSortedStrings(values: Iterable<string>): string[] {
  const sorted = Array.from(values)
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean)
    .sort();
  const unique: string[] = [];
  for (const name of sorted) {
    if (unique.length === 0 || unique[unique.length - 1] !== name) unique.push(name);
  }
  return unique;
}

export function buildCanonicalDepFileNameIndex(
  entries: Iterable<{ fileName: string; entryPath: string }>,
): CanonicalDepFileNameIndex {
  const out: CanonicalDepFileNameIndex = new Map();
  for (const entry of entries) {
    const fileName = typeof entry?.fileName === "string" ? entry.fileName : "";
    const entryPath = typeof entry?.entryPath === "string" ? entry.entryPath : "";
    if (!fileName || !entryPath) continue;
    const key = safeRealpath(entryPath);
    if (!out.has(key)) out.set(key, fileName);
  }
  return out;
}

export function canonicalizeDepFileName(
  fileName: string,
  entryPath: string,
  canonicalFileNamesByEntryPath?: CanonicalDepFileNameIndex | null,
): string {
  if (!fileName || !entryPath || !canonicalFileNamesByEntryPath || canonicalFileNamesByEntryPath.size === 0) {
    return fileName;
  }
  return canonicalFileNamesByEntryPath.get(safeRealpath(entryPath)) ?? fileName;
}

export function canonicalizeDepUsageIndex(
  index: DepUsageIndex,
  canonicalFileNamesByEntryPath?: CanonicalDepFileNameIndex | null,
): DepUsageIndex {
  if (!canonicalFileNamesByEntryPath || canonicalFileNamesByEntryPath.size === 0) {
    return index;
  }

  const out: DepUsageIndex = new Map();
  for (const usage of index.values()) {
    const canonicalFileName = canonicalizeDepFileName(
      usage.fileName,
      usage.entryPath,
      canonicalFileNamesByEntryPath,
    );
    const existing = out.get(canonicalFileName);
    if (!existing) {
      out.set(canonicalFileName, {
        ...usage,
        fileName: canonicalFileName,
        usedExports: dedupeSortedStrings(usage.usedExports),
        importerKeys: dedupeSortedStrings(usage.importerKeys),
        entryRootKeys: dedupeSortedStrings(usage.entryRootKeys),
      });
      continue;
    }

    existing.usedExports = dedupeSortedStrings([
      ...existing.usedExports,
      ...(Array.isArray(usage.usedExports) ? usage.usedExports : []),
    ]);
    existing.hasNamespace = existing.hasNamespace || usage.hasNamespace;
    existing.hasExportStar = existing.hasExportStar || usage.hasExportStar;
    existing.importerKeys = dedupeSortedStrings([
      ...(Array.isArray(existing.importerKeys) ? existing.importerKeys : []),
      ...(Array.isArray(usage.importerKeys) ? usage.importerKeys : []),
    ]);
    existing.entryRootKeys = dedupeSortedStrings([
      ...(Array.isArray(existing.entryRootKeys) ? existing.entryRootKeys : []),
      ...(Array.isArray(usage.entryRootKeys) ? usage.entryRootKeys : []),
    ]);
  }

  return out;
}

function normalizeAllowedRoots(roots: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (typeof root !== "string" || root.length === 0) continue;
    const normalized = safeRealpath(root).replace(/[\\\/]+$/, "");
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  out.sort();
  return out;
}

function isWithinAllowedRoots(absPath: string, allowedRoots: string[]): boolean {
  for (const root of allowedRoots) {
    if (absPath === root) return true;
    if (absPath.startsWith(root + path.sep)) return true;
  }
  return false;
}

function normalizeProjectKey(rootDir: string, absPath: string): string {
  const normalizedRoot = safeRealpath(rootDir);
  const normalizedPath = safeRealpath(absPath);
  const rel = path.relative(normalizedRoot, normalizedPath).replace(/\\/g, "/");
  if (!rel || rel === ".") return ".";
  return rel;
}

export async function scanDepUsage(options: {
  rootDir: string;
  entries: string[];
  allowedRoots?: string[] | null;
}): Promise<DepUsageIndex> {
  const { rootDir, entries } = options;
  const allowedRoots = normalizeAllowedRoots(
    Array.isArray(options.allowedRoots) && options.allowedRoots.length
      ? options.allowedRoots
      : [rootDir],
  );
  const usage = new Map<
    string,
    {
      fileName: string;
      entryPath: string;
      packageName: string;
      packageVersion: string;
      used: Set<string>;
      hasNamespace: boolean;
      hasExportStar: boolean;
      importers: Set<string>;
      entryRoots: Set<string>;
    }
  >();

  const queue: Array<{ absPath: string; entryRootKey: string }> = [];
  const visitedFiles = new Set<string>();

  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    const abs = path.isAbsolute(entry) ? entry : path.resolve(rootDir, entry);
    queue.push({
      absPath: abs,
      entryRootKey: normalizeProjectKey(rootDir, abs),
    });
  }

  while (queue.length) {
    const queued = queue.shift()!;
    const absPath = safeRealpath(queued.absPath);
    const entryRootKey = queued.entryRootKey;
    const visitKey = `${absPath}\u0000${entryRootKey}`;
    if (visitedFiles.has(visitKey)) continue;
    visitedFiles.add(visitKey);

    if (!isWithinAllowedRoots(absPath, allowedRoots)) continue;
    if (absPath.includes(`${path.sep}node_modules${path.sep}`)) continue;

    const ext = path.extname(absPath).toLowerCase();
    if (!SCAN_EXTS.has(ext)) continue;
    if (absPath.endsWith(".d.ts")) continue;
    if (!fs.existsSync(absPath)) continue;

    let code = "";
    try {
      code = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const records = parseModuleForUsage(absPath, code);
    for (const record of records) {
      const source = record.source;
      if (typeof source !== "string" || source.length === 0) continue;

      const resolvedImport = resolveImport(source, absPath);
      const resolvedLocalImport =
        resolvedImport &&
        isWithinAllowedRoots(safeRealpath(resolvedImport), allowedRoots) &&
        !resolvedImport.includes(`${path.sep}node_modules${path.sep}`)
          ? resolvedImport
          : null;
      if (resolvedLocalImport) {
        queue.push({ absPath: resolvedLocalImport, entryRootKey });
        continue;
      }

      if (isBareSpecifier(source)) {
        const resolved = resolveDepEntryForBareImport(source, absPath);
        if (!resolved) continue;
        const key = resolved.fileName;
        let item = usage.get(key);
        if (!item) {
          item = {
            fileName: resolved.fileName,
            entryPath: resolved.entryPath,
            packageName: resolved.packageName,
            packageVersion: resolved.packageVersion,
            used: new Set(),
            hasNamespace: false,
            hasExportStar: false,
            importers: new Set(),
            entryRoots: new Set(),
          };
          usage.set(key, item);
        }
        item.importers.add(normalizeProjectKey(rootDir, absPath));
        item.entryRoots.add(entryRootKey);
        for (const imp of record.imported) {
          if (imp.kind === "namespace") item.hasNamespace = true;
          if (imp.kind === "export-star") item.hasExportStar = true;
          if (imp.kind === "default") item.used.add("default");
          if (imp.kind === "named" && imp.name) item.used.add(imp.name);
        }
        continue;
      }
    }
  }

  const out: DepUsageIndex = new Map();
  for (const item of usage.values()) {
    out.set(item.fileName, {
      fileName: item.fileName,
      entryPath: item.entryPath,
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      usedExports: dedupeSortedStrings(item.used.values()),
      hasNamespace: item.hasNamespace,
      hasExportStar: item.hasExportStar,
      importerKeys: dedupeSortedStrings(item.importers.values()),
      entryRootKeys: dedupeSortedStrings(item.entryRoots.values()),
    });
  }

  return out;
}

export async function scanDepEntryPaths(options: {
  rootDir: string;
  entries: string[];
  allowedRoots?: string[] | null;
}): Promise<Array<{ entryPath: string; packageName: string }>> {
  const { rootDir, entries } = options;
  const allowedRoots = normalizeAllowedRoots(
    Array.isArray(options.allowedRoots) && options.allowedRoots.length
      ? options.allowedRoots
      : [rootDir],
  );

  const queue: string[] = [];
  const visitedFiles = new Set<string>();
  const entryPaths = new Map<string, { entryPath: string; packageName: string }>();

  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    queue.push(path.isAbsolute(entry) ? entry : path.resolve(rootDir, entry));
  }

  while (queue.length) {
    const absPath = safeRealpath(queue.shift()!);
    if (visitedFiles.has(absPath)) continue;
    visitedFiles.add(absPath);

    if (!isWithinAllowedRoots(absPath, allowedRoots)) continue;
    if (absPath.includes(`${path.sep}node_modules${path.sep}`)) continue;

    const ext = path.extname(absPath).toLowerCase();
    if (!SCAN_EXTS.has(ext)) continue;
    if (absPath.endsWith(".d.ts")) continue;
    if (!fs.existsSync(absPath)) continue;

    let code = "";
    try {
      code = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const records = parseModuleForUsage(absPath, code);
    for (const record of records) {
      const source = record.source;
      if (typeof source !== "string" || source.length === 0) continue;

      const resolvedImport = resolveImport(source, absPath);
      const resolvedLocalImport =
        resolvedImport &&
        isWithinAllowedRoots(safeRealpath(resolvedImport), allowedRoots) &&
        !resolvedImport.includes(`${path.sep}node_modules${path.sep}`)
          ? resolvedImport
          : null;
      if (resolvedLocalImport) {
        queue.push(resolvedLocalImport);
        continue;
      }

      if (!isBareSpecifier(source)) continue;
      const resolved = resolveDepEntryForBareImport(source, absPath);
      if (!resolved || !resolved.entryPath.includes("node_modules")) continue;
      const canonicalEntryPath = safeRealpath(resolved.entryPath);
      if (!entryPaths.has(canonicalEntryPath)) {
        entryPaths.set(canonicalEntryPath, {
          entryPath: canonicalEntryPath,
          packageName: resolved.packageName,
        });
      }
    }
  }

  return Array.from(entryPaths.values()).sort((a, b) => a.entryPath.localeCompare(b.entryPath));
}
