import fs from "fs";
import path from "path";
import { getCacheKey } from "@core/cache";

export const DEPS_PREFIX = "/@deps/";
export const IONIFY_VENDOR_PACK_V2_MARKER = "// ionify:vendor-pack-v2";

export type VendorPackEntry = { entryPath: string; fileName: string; packageLabel: string };

export type VendorPackMemberWrapper = {
  baseFileName: string;
  wrapperFileName: string;
  packageLabel?: string;
};

export type VendorPackV2IndexDisk = {
  version: 1;
  depsHash: string;
  outputVersion: number;
  updatedAt: string;
  packIndexHash?: string | null;
  usageIndexHash?: string | null;
  packFileToSharedFile: Record<string, string>;
  packFileToKey?: Record<string, string>;
  packFileToChunkFiles?: Record<string, string[]>;
  fileNameToPackFile: Record<string, string>;
};

export type VendorPackV2Logger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
    // ignore write errors; vendor packs are best-effort metadata
  }
}

export function vendorPackV2MemberKey(fileName: string): string {
  return getCacheKey(`vp2:${fileName}`).slice(0, 12);
}

function readVendorPackV2KeyFromDisk(depsRoot: string, packFileName: string): string | null {
  const packPath = path.join(depsRoot, packFileName);
  if (!fs.existsSync(packPath)) return null;
  try {
    const head = fs.readFileSync(packPath, "utf8").slice(0, 256);
    const match = head.match(/\/\/\s*ionify:vendor-pack-v2\s+([0-9a-fA-F]{32,})/);
    const key = match?.[1] ? String(match[1]).toLowerCase() : null;
    return key && /^[0-9a-f]{32,}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

function uniqueSorted(values: string[]): string[] {
  const normalized = values.map((v) => String(v)).filter(Boolean).slice().sort();
  const unique: string[] = [];
  for (const v of normalized) {
    if (unique.length === 0 || unique[unique.length - 1] !== v) unique.push(v);
  }
  return unique;
}

function parseWrapperForVendorPackV2(
  depsRoot: string,
  fileName: string,
): { entryId: string; cssImports: string[]; exportNames: string[] } | null {
  const wrapperPath = path.join(depsRoot, fileName);
  if (!fs.existsSync(wrapperPath)) return null;
  let code = "";
  try {
    code = fs.readFileSync(wrapperPath, "utf8");
  } catch {
    return null;
  }

  // Pack modules cannot currently preserve `export * from "/@deps/*"` semantics without re-requesting wrappers.
  // Skip these entries to avoid correctness regressions.
  if (code.includes("export * from")) return null;

  const entryIdMatch = code.match(/const __exports = __ionifyRequire\(["']([^"']+)["']\);/);
  const entryId = entryIdMatch?.[1] ?? null;
  if (!entryId) return null;

  const cssImports: string[] = [];
  for (const match of code.matchAll(/import\s+["']([^"']+\?inline)["'];\s*/g)) {
    const url = match[1];
    if (typeof url === "string" && url.length > 0) cssImports.push(url);
  }

  const exportNames: string[] = [];
  for (const match of code.matchAll(
    /export\s+\{\s*__ionify_export_[A-Za-z0-9_$]+\s+as\s+([A-Za-z0-9_$]+)\s*\}\s*;\s*/g,
  )) {
    const name = match[1];
    if (typeof name === "string" && name.length > 0) exportNames.push(name);
  }

  return {
    entryId,
    cssImports: uniqueSorted(cssImports),
    exportNames: uniqueSorted(exportNames),
  };
}

export class VendorPackV2IndexManager {
  private readonly depsRoot: string;
  private readonly depsHash: string;
  private readonly outputVersion: number;
  private readonly indexPath: string;
  private readonly allowPackFilePrefix: string | null;
  private readonly log: VendorPackV2Logger;

  readonly packFileToSharedFile = new Map<string, string>();
  readonly packFileToKey = new Map<string, string>();
  readonly packFileToChunkFiles = new Map<string, string[]>();
  readonly fileNameToPackFile = new Map<string, string>();
  private usageIndexHash: string | null = null;

  constructor(options: {
    depsRoot: string;
    depsHash: string;
    outputVersion: number;
    allowPackFilePrefix?: string | null;
    log?: VendorPackV2Logger;
  }) {
    this.depsRoot = options.depsRoot;
    this.depsHash = options.depsHash;
    this.outputVersion = options.outputVersion;
    this.indexPath = path.join(this.depsRoot, "vendor-pack.v2.index.json");
    this.allowPackFilePrefix = options.allowPackFilePrefix ?? null;
    this.log = options.log ?? {};
  }

  setUsageIndexHash(hash: string | null): void {
    const cleaned = hash && typeof hash === "string" ? hash.trim().toLowerCase() : "";
    const next = cleaned && /^[0-9a-f]{32,}$/.test(cleaned) ? cleaned : null;
    if (this.usageIndexHash === next) return;
    this.usageIndexHash = next;
    // Persist even when routing is unchanged so determinism gates can observe it.
    this.writeIndex();
  }

  private writeIndex(): void {
    const packKeys = Array.from(this.packFileToSharedFile.keys()).sort();
    const packObj: Record<string, string> = {};
    const keyObj: Record<string, string> = {};
    const chunkObj: Record<string, string[]> = {};

    for (const packFile of packKeys) {
      const shared = this.packFileToSharedFile.get(packFile);
      if (shared) packObj[packFile] = shared;
      const key = this.packFileToKey.get(packFile);
      if (key) {
        const cleaned = key.trim().toLowerCase();
        keyObj[packFile] = cleaned;
      }
      const chunkFiles = this.packFileToChunkFiles.get(packFile);
      if (chunkFiles && chunkFiles.length > 0) {
        const unique = uniqueSorted(chunkFiles);
        chunkObj[packFile] = unique;
      }
    }

    const fileObj: Record<string, string> = {};
    const fileKeys = Array.from(this.fileNameToPackFile.keys()).sort();
    for (const fileName of fileKeys) {
      const packFile = this.fileNameToPackFile.get(fileName);
      if (packFile) fileObj[fileName] = packFile;
    }

    // Compute stable routing hash without re-sorting (keys are already sorted above).
    let routingBody = `vendor-pack-v2-index:v1:${this.depsHash}\n`;
    for (const packFile of packKeys) {
      const shared = packObj[packFile];
      if (shared) routingBody += `shared:${packFile}=${shared}\n`;
    }
    for (const packFile of packKeys) {
      const key = keyObj[packFile];
      if (key) routingBody += `key:${packFile}=${key}\n`;
    }
    for (const packFile of packKeys) {
      const files = chunkObj[packFile];
      if (files && files.length > 0) routingBody += `chunks:${packFile}=${files.join(",")}\n`;
    }
    for (const fileName of fileKeys) {
      const packFile = fileObj[fileName];
      if (packFile) routingBody += `route:${fileName}=${packFile}\n`;
    }

    const payload: VendorPackV2IndexDisk = {
      version: 1,
      depsHash: this.depsHash,
      outputVersion: this.outputVersion,
      updatedAt: new Date().toISOString(),
      usageIndexHash: this.usageIndexHash,
      packFileToSharedFile: packObj,
      packFileToKey: keyObj,
      packFileToChunkFiles: chunkObj,
      fileNameToPackFile: fileObj,
    };

    payload.packIndexHash = getCacheKey(routingBody);
    writeJsonFile(this.indexPath, payload);
  }

  loadFromDisk(): void {
    this.packFileToSharedFile.clear();
    this.packFileToKey.clear();
    this.packFileToChunkFiles.clear();
    this.fileNameToPackFile.clear();

    const raw = readJsonFile<VendorPackV2IndexDisk>(this.indexPath);
    if (
      !raw ||
      raw.version !== 1 ||
      raw.depsHash !== this.depsHash ||
      raw.outputVersion !== this.outputVersion
    ) {
      return;
    }
    this.usageIndexHash = typeof raw.usageIndexHash === "string" ? raw.usageIndexHash.trim().toLowerCase() : null;

    const rawPackMap = raw.packFileToSharedFile;
    const rawKeyMap = raw.packFileToKey;
    const rawChunkMap = raw.packFileToChunkFiles;
    const rawFileMap = raw.fileNameToPackFile;

    const packFileToShared = new Map<string, string>();
    const packFileToKey = new Map<string, string>();
    const packFileToChunkFiles = new Map<string, string[]>();
    const fileNameToPackFile = new Map<string, string>();
    const validPackFiles = new Set<string>();

    let rawPackCount = 0;
    if (rawPackMap && typeof rawPackMap === "object") {
      for (const [packFileName, sharedFileName] of Object.entries(rawPackMap)) {
        if (typeof packFileName !== "string" || typeof sharedFileName !== "string") continue;
        if (!packFileName.endsWith(".js") || !sharedFileName.endsWith(".js")) continue;
        rawPackCount += 1;
        const packPath = path.join(this.depsRoot, packFileName);
        const sharedPath = path.join(this.depsRoot, sharedFileName);
        if (!fs.existsSync(packPath) || !fs.existsSync(sharedPath)) continue;
        packFileToShared.set(packFileName, sharedFileName);
        validPackFiles.add(packFileName);
      }
    }

    let rawKeyCount = 0;
    if (rawKeyMap && typeof rawKeyMap === "object") {
      for (const [packFileName, key] of Object.entries(rawKeyMap)) {
        if (typeof packFileName !== "string" || typeof key !== "string") continue;
        if (!validPackFiles.has(packFileName)) continue;
        rawKeyCount += 1;
        const cleaned = key.trim().toLowerCase();
        if (!/^[0-9a-f]{32,}$/.test(cleaned)) continue;
        packFileToKey.set(packFileName, cleaned);
      }
    }

    let rawChunkCount = 0;
    if (rawChunkMap && typeof rawChunkMap === "object") {
      for (const [packFileName, chunkFiles] of Object.entries(rawChunkMap)) {
        if (typeof packFileName !== "string" || !Array.isArray(chunkFiles)) continue;
        if (!validPackFiles.has(packFileName)) continue;
        rawChunkCount += 1;
        const normalized = chunkFiles
          .map((v) => (typeof v === "string" ? v : ""))
          .filter(Boolean);
        if (normalized.length > 0) packFileToChunkFiles.set(packFileName, uniqueSorted(normalized));
      }
    }

    // Validate pack modules. If key/chunk list is missing, recover defaults (upgrade path) and self-heal.
    let needsRewrite = false;
    for (const packFileName of Array.from(validPackFiles.values())) {
      const sharedFileName = packFileToShared.get(packFileName);
      if (!sharedFileName) continue;

      const expectedKey = packFileToKey.get(packFileName) ?? readVendorPackV2KeyFromDisk(this.depsRoot, packFileName);
      if (expectedKey && !packFileToKey.has(packFileName)) {
        packFileToKey.set(packFileName, expectedKey);
        needsRewrite = true;
      }

      const chunkFiles = packFileToChunkFiles.get(packFileName) ?? [sharedFileName];
      if (!packFileToChunkFiles.has(packFileName)) {
        packFileToChunkFiles.set(packFileName, chunkFiles);
        needsRewrite = true;
      }

      const packPath = path.join(this.depsRoot, packFileName);
      const sharedPath = path.join(this.depsRoot, sharedFileName);
      const chunksOk =
        fs.existsSync(packPath) &&
        fs.existsSync(sharedPath) &&
        chunkFiles.every((f) => typeof f === "string" && f.endsWith(".js") && fs.existsSync(path.join(this.depsRoot, f)));
      if (!chunksOk) {
        validPackFiles.delete(packFileName);
        packFileToShared.delete(packFileName);
        packFileToKey.delete(packFileName);
        packFileToChunkFiles.delete(packFileName);
        needsRewrite = true;
        continue;
      }

      if (expectedKey) {
        try {
          const head = fs.readFileSync(packPath, "utf8").slice(0, 256);
          if (!head.includes(`${IONIFY_VENDOR_PACK_V2_MARKER} ${expectedKey}`)) {
            validPackFiles.delete(packFileName);
            packFileToShared.delete(packFileName);
            packFileToKey.delete(packFileName);
            packFileToChunkFiles.delete(packFileName);
            needsRewrite = true;
          }
        } catch {
          validPackFiles.delete(packFileName);
          packFileToShared.delete(packFileName);
          packFileToKey.delete(packFileName);
          packFileToChunkFiles.delete(packFileName);
          needsRewrite = true;
        }
      }
    }

    let rawFileCount = 0;
    if (rawFileMap && typeof rawFileMap === "object") {
      for (const [fileName, packFileName] of Object.entries(rawFileMap)) {
        if (typeof fileName !== "string" || typeof packFileName !== "string") continue;
        if (!fileName.endsWith(".js") || !packFileName.endsWith(".js")) continue;
        rawFileCount += 1;
        if (!validPackFiles.has(packFileName)) continue;
        const wrapperPath = path.join(this.depsRoot, fileName);
        if (!fs.existsSync(wrapperPath)) continue;
        fileNameToPackFile.set(fileName, packFileName);
      }
    }

    if (this.allowPackFilePrefix) {
      for (const packFileName of Array.from(validPackFiles.values())) {
        if (packFileName.startsWith(this.allowPackFilePrefix)) continue;
        validPackFiles.delete(packFileName);
        packFileToShared.delete(packFileName);
        packFileToKey.delete(packFileName);
        packFileToChunkFiles.delete(packFileName);
        needsRewrite = true;
      }
      for (const [fileName, packFileName] of Array.from(fileNameToPackFile.entries())) {
        if (packFileName.startsWith(this.allowPackFilePrefix)) continue;
        fileNameToPackFile.delete(fileName);
        needsRewrite = true;
      }
    }

    for (const [packFileName, sharedFileName] of packFileToShared.entries()) {
      this.packFileToSharedFile.set(packFileName, sharedFileName);
    }
    for (const [packFileName, key] of packFileToKey.entries()) {
      this.packFileToKey.set(packFileName, key);
    }
    for (const [packFileName, chunkFiles] of packFileToChunkFiles.entries()) {
      this.packFileToChunkFiles.set(packFileName, chunkFiles);
    }
    for (const [fileName, packFileName] of fileNameToPackFile.entries()) {
      this.fileNameToPackFile.set(fileName, packFileName);
    }

    if (
      needsRewrite ||
      (rawPackCount > 0 && this.packFileToSharedFile.size !== rawPackCount) ||
      (rawKeyCount > 0 && this.packFileToKey.size !== rawKeyCount) ||
      (rawChunkCount > 0 && this.packFileToChunkFiles.size !== rawChunkCount) ||
      (rawFileCount > 0 && this.fileNameToPackFile.size !== rawFileCount)
    ) {
      this.writeIndex();
    }
  }

  prunePackPrefix(prefix: string): void {
    const cleanedPrefix = typeof prefix === "string" ? prefix.trim() : "";
    if (!cleanedPrefix) return;

    let indexChanged = false;

    for (const [fileName, packFileName] of Array.from(this.fileNameToPackFile.entries())) {
      if (!packFileName.startsWith(cleanedPrefix)) continue;
      this.fileNameToPackFile.delete(fileName);
      indexChanged = true;
    }

    for (const packFileName of Array.from(this.packFileToSharedFile.keys())) {
      if (!packFileName.startsWith(cleanedPrefix)) continue;
      this.packFileToSharedFile.delete(packFileName);
      this.packFileToKey.delete(packFileName);
      this.packFileToChunkFiles.delete(packFileName);
      indexChanged = true;
    }

    if (indexChanged || !fs.existsSync(this.indexPath)) {
      this.writeIndex();
    }
  }

  ensurePackModuleFromEntries(options: {
    label: string;
    packFileName: string;
    sharedFileName: string;
    entries: VendorPackEntry[];
    prunePackPrefix?: string;
  }): { packFileName: string; safeMembers: string[] } | null {
    const { label, packFileName, sharedFileName, entries, prunePackPrefix } = options;
    if (!packFileName.endsWith(".js") || !sharedFileName.endsWith(".js")) return null;
    const sharedPath = path.join(this.depsRoot, sharedFileName);
    if (!fs.existsSync(sharedPath)) return null;

    const parsedByFile = new Map<
      string,
      { entryId: string; cssImports: string[]; exportNames: string[]; memberKey: string }
    >();
    const safeMembers: string[] = [];
    const memberSet = new Set<string>();
    for (const entry of entries) {
      const fileName = entry.fileName;
      if (!fileName || !fileName.endsWith(".js")) continue;
      memberSet.add(fileName);
      const parsed = parseWrapperForVendorPackV2(this.depsRoot, fileName);
      if (!parsed) continue;
      const memberKey = vendorPackV2MemberKey(fileName);
      parsedByFile.set(fileName, { ...parsed, memberKey });
      safeMembers.push(fileName);
    }

    safeMembers.sort();
    if (safeMembers.length === 0) return null;

    const cssSet = new Set<string>();
    for (const fileName of safeMembers) {
      const parsed = parsedByFile.get(fileName);
      if (!parsed) continue;
      for (const url of parsed.cssImports) cssSet.add(url);
    }
    const cssImports = Array.from(cssSet).sort();

    const vendorKey = getCacheKey(
      `vendor-pack-v2:v1:${this.depsHash}:${packFileName}:${sharedFileName}:${safeMembers.join("|")}`,
    );
    const outPath = path.join(this.depsRoot, packFileName);
    let wroteModule = false;
    const moduleIsValidOnDisk = (): boolean => {
      if (!fs.existsSync(outPath)) return false;
      try {
        const head = fs.readFileSync(outPath, "utf8").slice(0, 256);
        return head.includes(`${IONIFY_VENDOR_PACK_V2_MARKER} ${vendorKey}`);
      } catch {
        return false;
      }
    };

    if (!moduleIsValidOnDisk()) {
      const lines: string[] = [];
      lines.push(`${IONIFY_VENDOR_PACK_V2_MARKER} ${vendorKey}`);
      lines.push(`// depsHash: ${this.depsHash}`);
      lines.push(`// pack: ${label}`);
      lines.push(`// shared: ${sharedFileName}`);
      lines.push(`// members: ${safeMembers.length}`);
      lines.push(`import { __ionifyRequire } from "${DEPS_PREFIX}${sharedFileName}";`);
      for (const url of cssImports) {
        lines.push(`import "${url}";`);
      }
      lines.push("");

      for (const fileName of safeMembers) {
        const parsed = parsedByFile.get(fileName);
        if (!parsed) continue;
        const { entryId, exportNames, memberKey } = parsed;
        const prefix = `__ionify_vp_${memberKey}`;
        lines.push(`// member: ${fileName}`);
        lines.push(`const ${prefix}__ns = __ionifyRequire("${entryId}");`);
        lines.push(
          `const ${prefix}__default = ${prefix}__ns && ${prefix}__ns.__esModule && Object.prototype.hasOwnProperty.call(${prefix}__ns, "default") ? ${prefix}__ns.default : ${prefix}__ns;`,
        );
        lines.push(`export { ${prefix}__default, ${prefix}__ns };`);
        for (const name of exportNames) {
          lines.push(`export const ${prefix}__${name} = ${prefix}__ns.${name};`);
        }
        lines.push("");
      }

      const body = lines.join("\n") + "\n";
      try {
        fs.writeFileSync(outPath, body, "utf8");
      } catch (err) {
        this.log.warn?.(
          `[deps] WARN: Failed to write vendor pack v2 module (${label}): ${String(err)}`,
        );
        return null;
      }
      wroteModule = true;
    }

    if (!moduleIsValidOnDisk()) return null;

    // Update routing index (restart-safe). Only write if something actually changed.
    let indexChanged = false;

    if (prunePackPrefix) {
      for (const [fileName, existingPackFile] of Array.from(this.fileNameToPackFile.entries())) {
        if (existingPackFile === packFileName) continue;
        if (!existingPackFile.startsWith(prunePackPrefix)) continue;
        this.fileNameToPackFile.delete(fileName);
        indexChanged = true;
      }
    }

    const previousShared = this.packFileToSharedFile.get(packFileName);
    if (previousShared !== sharedFileName) {
      this.packFileToSharedFile.set(packFileName, sharedFileName);
      indexChanged = true;
    }

    const previousKey = this.packFileToKey.get(packFileName);
    if (previousKey !== vendorKey) {
      this.packFileToKey.set(packFileName, vendorKey);
      indexChanged = true;
    }

    const previousChunks = this.packFileToChunkFiles.get(packFileName);
    const nextChunks = [sharedFileName];
    if (
      !previousChunks ||
      previousChunks.length !== nextChunks.length ||
      previousChunks.some((v, i) => v !== nextChunks[i])
    ) {
      this.packFileToChunkFiles.set(packFileName, nextChunks);
      indexChanged = true;
    }

    for (const fileName of safeMembers) {
      const prev = this.fileNameToPackFile.get(fileName);
      if (prev !== packFileName) {
        this.fileNameToPackFile.set(fileName, packFileName);
        indexChanged = true;
      }
    }

    // Ensure non-packable entries never route to a stale pack for this group.
    if (prunePackPrefix) {
      for (const fileName of memberSet) {
        if (safeMembers.includes(fileName)) continue;
        const prev = this.fileNameToPackFile.get(fileName);
        if (prev && prev.startsWith(prunePackPrefix)) {
          this.fileNameToPackFile.delete(fileName);
          indexChanged = true;
        }
      }
    }

    // Prune unreferenced pack headers to keep the index small.
    if (prunePackPrefix) {
      const referenced = new Set(this.fileNameToPackFile.values());
      for (const packFile of Array.from(this.packFileToSharedFile.keys())) {
        if (!packFile.startsWith(prunePackPrefix)) continue;
        if (referenced.has(packFile)) continue;
        this.packFileToSharedFile.delete(packFile);
        this.packFileToKey.delete(packFile);
        this.packFileToChunkFiles.delete(packFile);
        indexChanged = true;
      }
    }

    if (indexChanged || !fs.existsSync(this.indexPath)) {
      this.writeIndex();
    }

    if (wroteModule) {
      this.log.info?.(
        `[deps] ✓ Vendor pack v2 module ready (${label}): ${DEPS_PREFIX}${packFileName} members=${safeMembers.length}`,
      );
    }
    return { packFileName, safeMembers };
  }

  ensurePackModuleFromWrappers(options: {
    label: string;
    packFileName: string;
    sharedFileName: string;
    members: VendorPackMemberWrapper[];
    prunePackPrefix?: string;
  }): { packFileName: string; safeMembers: string[] } | null {
    const { label, packFileName, sharedFileName, members, prunePackPrefix } = options;
    if (!packFileName.endsWith(".js") || !sharedFileName.endsWith(".js")) return null;
    const sharedPath = path.join(this.depsRoot, sharedFileName);
    if (!fs.existsSync(sharedPath)) return null;

    const parsedByBase = new Map<
      string,
      { entryId: string; cssImports: string[]; exportNames: string[]; memberKey: string; wrapperFileName: string }
    >();
    const safeMembers: string[] = [];
    const memberSet = new Set<string>();
    const wrapperByBase = new Map<string, string>();

    for (const member of members) {
      const baseFileName = member.baseFileName;
      const wrapperFileName = member.wrapperFileName;
      if (!baseFileName || !baseFileName.endsWith(".js")) continue;
      if (!wrapperFileName || !wrapperFileName.endsWith(".js")) continue;
      memberSet.add(baseFileName);
      wrapperByBase.set(baseFileName, wrapperFileName);
      const parsed = parseWrapperForVendorPackV2(this.depsRoot, wrapperFileName);
      if (!parsed) continue;
      const memberKey = vendorPackV2MemberKey(baseFileName);
      parsedByBase.set(baseFileName, { ...parsed, memberKey, wrapperFileName });
      safeMembers.push(baseFileName);
    }

    safeMembers.sort();
    if (safeMembers.length === 0) return null;

    const cssSet = new Set<string>();
    for (const baseFileName of safeMembers) {
      const parsed = parsedByBase.get(baseFileName);
      if (!parsed) continue;
      for (const url of parsed.cssImports) cssSet.add(url);
    }
    const cssImports = Array.from(cssSet).sort();

    const mappingKey = safeMembers
      .map((base) => `${base}=>${wrapperByBase.get(base) ?? ""}`)
      .sort()
      .join("|");
    const vendorKey = getCacheKey(
      `vendor-pack-v2:usage:v1:${this.depsHash}:${packFileName}:${sharedFileName}:${mappingKey}`,
    );
    const outPath = path.join(this.depsRoot, packFileName);
    let wroteModule = false;
    const moduleIsValidOnDisk = (): boolean => {
      if (!fs.existsSync(outPath)) return false;
      try {
        const head = fs.readFileSync(outPath, "utf8").slice(0, 256);
        return head.includes(`${IONIFY_VENDOR_PACK_V2_MARKER} ${vendorKey}`);
      } catch {
        return false;
      }
    };

    if (!moduleIsValidOnDisk()) {
      const lines: string[] = [];
      lines.push(`${IONIFY_VENDOR_PACK_V2_MARKER} ${vendorKey}`);
      lines.push(`// depsHash: ${this.depsHash}`);
      lines.push(`// pack: ${label}`);
      lines.push(`// shared: ${sharedFileName}`);
      lines.push(`// members: ${safeMembers.length}`);
      lines.push(`import { __ionifyRequire } from "${DEPS_PREFIX}${sharedFileName}";`);
      for (const url of cssImports) {
        lines.push(`import "${url}";`);
      }
      lines.push("");

      for (const baseFileName of safeMembers) {
        const parsed = parsedByBase.get(baseFileName);
        if (!parsed) continue;
        const { entryId, exportNames, memberKey, wrapperFileName } = parsed;
        const prefix = `__ionify_vp_${memberKey}`;
        lines.push(`// member: ${baseFileName} (wrapper: ${wrapperFileName})`);
        lines.push(`const ${prefix}__ns = __ionifyRequire("${entryId}");`);
        lines.push(
          `const ${prefix}__default = ${prefix}__ns && ${prefix}__ns.__esModule && Object.prototype.hasOwnProperty.call(${prefix}__ns, "default") ? ${prefix}__ns.default : ${prefix}__ns;`,
        );
        lines.push(`export { ${prefix}__default, ${prefix}__ns };`);
        for (const name of exportNames) {
          lines.push(`export const ${prefix}__${name} = ${prefix}__ns.${name};`);
        }
        lines.push("");
      }

      const body = lines.join("\n") + "\n";
      try {
        fs.writeFileSync(outPath, body, "utf8");
      } catch (err) {
        this.log.warn?.(
          `[deps] WARN: Failed to write vendor pack v2 module (${label}): ${String(err)}`,
        );
        return null;
      }
      wroteModule = true;
    }

    if (!moduleIsValidOnDisk()) return null;

    // Update routing index (restart-safe). Only write if something actually changed.
    let indexChanged = false;

    if (prunePackPrefix) {
      for (const [fileName, existingPackFile] of Array.from(this.fileNameToPackFile.entries())) {
        if (existingPackFile === packFileName) continue;
        if (!existingPackFile.startsWith(prunePackPrefix)) continue;
        this.fileNameToPackFile.delete(fileName);
        indexChanged = true;
      }
    }

    const previousShared = this.packFileToSharedFile.get(packFileName);
    if (previousShared !== sharedFileName) {
      this.packFileToSharedFile.set(packFileName, sharedFileName);
      indexChanged = true;
    }

    const previousKey = this.packFileToKey.get(packFileName);
    if (previousKey !== vendorKey) {
      this.packFileToKey.set(packFileName, vendorKey);
      indexChanged = true;
    }

    const previousChunks = this.packFileToChunkFiles.get(packFileName);
    const nextChunks = [sharedFileName];
    if (
      !previousChunks ||
      previousChunks.length !== nextChunks.length ||
      previousChunks.some((v, i) => v !== nextChunks[i])
    ) {
      this.packFileToChunkFiles.set(packFileName, nextChunks);
      indexChanged = true;
    }

    for (const baseFileName of safeMembers) {
      const prev = this.fileNameToPackFile.get(baseFileName);
      if (prev !== packFileName) {
        this.fileNameToPackFile.set(baseFileName, packFileName);
        indexChanged = true;
      }
    }

    // Ensure non-packable entries never route to a stale pack for this group.
    if (prunePackPrefix) {
      for (const fileName of memberSet) {
        if (safeMembers.includes(fileName)) continue;
        const prev = this.fileNameToPackFile.get(fileName);
        if (prev && prev.startsWith(prunePackPrefix)) {
          this.fileNameToPackFile.delete(fileName);
          indexChanged = true;
        }
      }
    }

    // Prune unreferenced pack headers to keep the index small.
    if (prunePackPrefix) {
      const referenced = new Set(this.fileNameToPackFile.values());
      for (const packFile of Array.from(this.packFileToSharedFile.keys())) {
        if (!packFile.startsWith(prunePackPrefix)) continue;
        if (referenced.has(packFile)) continue;
        this.packFileToSharedFile.delete(packFile);
        this.packFileToKey.delete(packFile);
        this.packFileToChunkFiles.delete(packFile);
        indexChanged = true;
      }
    }

    if (indexChanged || !fs.existsSync(this.indexPath)) {
      this.writeIndex();
    }

    if (wroteModule) {
      this.log.info?.(
        `[deps] ✓ Vendor pack v2 module ready (${label}): ${DEPS_PREFIX}${packFileName} members=${safeMembers.length}`,
      );
    }
    return { packFileName, safeMembers };
  }
}
