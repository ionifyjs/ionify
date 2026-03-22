import { getCacheKey } from "@core/cache";

type FeaturePackIndex = {
  version: number;
  depsHash: string;
  outputVersion?: number;
  fileNameToChunkGroupId?: Record<string, unknown>;
};

type VendorPackV2Index = {
  version: number;
  depsHash: string;
  outputVersion?: number;
  packFileToSharedFile?: Record<string, unknown>;
  packFileToKey?: Record<string, unknown>;
  packFileToChunkFiles?: Record<string, unknown>;
  fileNameToPackFile?: Record<string, unknown>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

// Hash only the content that affects import routing decisions.
// Never include timestamps (`updatedAt`) to preserve determinism across machines and restarts.
export function hashFeaturePackRoutingIndex(
  index: unknown,
  depsHash: string,
  outputVersion: number,
): string | null {
  if (!isObject(index)) return null;
  const parsed = index as FeaturePackIndex;
  if (
    parsed.version !== 1 ||
    parsed.depsHash !== depsHash ||
    parsed.outputVersion !== outputVersion
  ) {
    return null;
  }

  const mapping = parsed.fileNameToChunkGroupId;
  const entries: Array<[string, string]> = [];
  if (isObject(mapping)) {
    for (const [fileName, chunkGroupId] of Object.entries(mapping)) {
      if (typeof fileName !== "string" || typeof chunkGroupId !== "string") continue;
      entries.push([fileName, chunkGroupId]);
    }
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  let body = `feature-pack-index:v1:${depsHash}\n`;
  for (const [fileName, chunkGroupId] of entries) {
    body += `${fileName}=${chunkGroupId}\n`;
  }
  return getCacheKey(body);
}

export function hashVendorPackV2RoutingIndex(
  index: unknown,
  depsHash: string,
  outputVersion: number,
): string | null {
  if (!isObject(index)) return null;
  const parsed = index as VendorPackV2Index;
  if (
    parsed.version !== 1 ||
    parsed.depsHash !== depsHash ||
    parsed.outputVersion !== outputVersion
  ) {
    return null;
  }

  const packShared = isObject(parsed.packFileToSharedFile) ? parsed.packFileToSharedFile : {};
  const packKey = isObject(parsed.packFileToKey) ? parsed.packFileToKey : {};
  const packChunks = isObject(parsed.packFileToChunkFiles) ? parsed.packFileToChunkFiles : {};
  const routing = isObject(parsed.fileNameToPackFile) ? parsed.fileNameToPackFile : {};

  const sharedEntries: Array<[string, string]> = [];
  for (const [packFile, sharedFile] of Object.entries(packShared)) {
    if (typeof packFile !== "string" || typeof sharedFile !== "string") continue;
    sharedEntries.push([packFile, sharedFile]);
  }
  sharedEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const keyEntries: Array<[string, string]> = [];
  for (const [packFile, key] of Object.entries(packKey)) {
    if (typeof packFile !== "string" || typeof key !== "string") continue;
    keyEntries.push([packFile, key.trim().toLowerCase()]);
  }
  keyEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const chunkEntries: Array<[string, string[]]> = [];
  for (const [packFile, chunkFiles] of Object.entries(packChunks)) {
    if (typeof packFile !== "string" || !Array.isArray(chunkFiles)) continue;
    const normalized = chunkFiles
      .map((v) => (typeof v === "string" ? v : ""))
      .filter(Boolean)
      .slice()
      .sort();
    const unique: string[] = [];
    for (const file of normalized) {
      if (unique.length === 0 || unique[unique.length - 1] !== file) unique.push(file);
    }
    chunkEntries.push([packFile, unique]);
  }
  chunkEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const routeEntries: Array<[string, string]> = [];
  for (const [fileName, packFile] of Object.entries(routing)) {
    if (typeof fileName !== "string" || typeof packFile !== "string") continue;
    routeEntries.push([fileName, packFile]);
  }
  routeEntries.sort((a, b) => a[0].localeCompare(b[0]));

  let body = `vendor-pack-v2-index:v1:${depsHash}\n`;
  for (const [packFile, sharedFile] of sharedEntries) {
    body += `shared:${packFile}=${sharedFile}\n`;
  }
  for (const [packFile, key] of keyEntries) {
    body += `key:${packFile}=${key}\n`;
  }
  for (const [packFile, files] of chunkEntries) {
    body += `chunks:${packFile}=${files.join(",")}\n`;
  }
  for (const [fileName, packFile] of routeEntries) {
    body += `route:${fileName}=${packFile}\n`;
  }
  return getCacheKey(body);
}
