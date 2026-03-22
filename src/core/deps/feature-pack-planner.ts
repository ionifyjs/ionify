import fs from "fs";
import path from "path";

export type FeaturePackPlanEntry = {
  entryPath: string;
  fileName: string;
  packageLabel: string;
};

export type FeaturePackObservedEntry = FeaturePackPlanEntry & {
  score: number;
  sizeBytes: number;
};

export type FeaturePackReadyState = {
  status: string;
  chunkGroupId: string | null;
  entries: FeaturePackPlanEntry[];
};

export type FeaturePackSlimEntry = {
  baseFileName: string;
  wrapperFileName: string;
};

export type ChunkedPackResultEntry = {
  entryPath?: string | null;
  outPath?: string | null;
};

function realpathOrSelf(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function sortPackEntries<T extends FeaturePackPlanEntry>(entries: readonly T[]): T[] {
  return entries.slice().sort((a, b) => {
    const labelDelta = a.packageLabel.localeCompare(b.packageLabel);
    if (labelDelta !== 0) return labelDelta;
    return a.fileName.localeCompare(b.fileName);
  });
}

export function reconcilePackEntries<T extends FeaturePackPlanEntry>(
  entries: readonly T[] | null | undefined,
  canonicalizeFileName: (fileName: string, entryPath: string) => string,
): T[] {
  const byEntryPath = new Map<string, T>();
  for (const entry of entries ?? []) {
    if (!entry?.entryPath || !entry?.fileName) continue;
    const next = {
      ...entry,
      fileName: canonicalizeFileName(entry.fileName, entry.entryPath) || entry.fileName,
    } as T;
    byEntryPath.set(realpathOrSelf(next.entryPath), next);
  }

  const deduped: T[] = [];
  const seenFileNames = new Set<string>();
  for (const entry of sortPackEntries(Array.from(byEntryPath.values()))) {
    if (seenFileNames.has(entry.fileName)) continue;
    seenFileNames.add(entry.fileName);
    deduped.push(entry);
  }

  return deduped;
}

export function resolveChunkedPackEntries<T extends FeaturePackPlanEntry>(
  entries: readonly T[] | null | undefined,
  chunkedEntries: readonly ChunkedPackResultEntry[] | null | undefined,
): T[] {
  const outByEntryPath = new Map<string, string>();
  for (const item of chunkedEntries ?? []) {
    const entryPath = typeof item?.entryPath === "string" ? item.entryPath : "";
    const outPath = typeof item?.outPath === "string" ? item.outPath : "";
    if (!entryPath || !outPath) continue;
    outByEntryPath.set(realpathOrSelf(entryPath), path.basename(outPath));
  }

  const resolved = (entries ?? []).map((entry) => {
    const nextFileName = outByEntryPath.get(realpathOrSelf(entry.entryPath)) ?? entry.fileName;
    return { ...entry, fileName: nextFileName } as T;
  });

  return reconcilePackEntries(resolved, (fileName) => fileName);
}

export function deriveFeaturePackRoutingMap(
  states: Iterable<FeaturePackReadyState | null | undefined>,
): Map<string, string> {
  const routing = new Map<string, string>();
  for (const state of states) {
    if (!state || state.status !== "ready" || !state.chunkGroupId) continue;
    for (const entry of Array.isArray(state.entries) ? state.entries : []) {
      if (!entry?.fileName) continue;
      routing.set(entry.fileName, state.chunkGroupId);
    }
  }
  return routing;
}

export function isFeaturePackSlimAligned(
  baseEntries: readonly FeaturePackPlanEntry[] | null | undefined,
  slimEntries: readonly FeaturePackSlimEntry[] | null | undefined,
): boolean {
  const base = Array.isArray(baseEntries) ? baseEntries : [];
  const slim = Array.isArray(slimEntries) ? slimEntries : [];
  if (base.length === 0 || slim.length === 0) return false;

  const baseFileNames = base
    .map((entry) => entry?.fileName ?? "")
    .filter(Boolean)
    .slice()
    .sort();
  const slimBaseFileNames = slim
    .map((entry) => entry?.baseFileName ?? "")
    .filter(Boolean)
    .slice()
    .sort();

  if (baseFileNames.length !== slimBaseFileNames.length) return false;
  for (let i = 0; i < baseFileNames.length; i += 1) {
    if (baseFileNames[i] !== slimBaseFileNames[i]) return false;
  }

  return true;
}

type SelectStableFeaturePackEntriesOptions = {
  currentReadyEntries?: readonly FeaturePackPlanEntry[] | null;
  candidates: readonly FeaturePackObservedEntry[];
  maxMembers: number;
  maxBytes: number;
};

export function selectStableFeaturePackEntries(
  options: SelectStableFeaturePackEntriesOptions,
): FeaturePackPlanEntry[] {
  const selected: FeaturePackPlanEntry[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  const candidateByFileName = new Map<string, FeaturePackObservedEntry>();
  for (const candidate of options.candidates) {
    if (!candidate?.fileName || candidateByFileName.has(candidate.fileName)) continue;
    candidateByFileName.set(candidate.fileName, candidate);
  }

  // Preserve the current ready membership first so a logical feature pack cannot
  // shrink mid-session and split singleton/context ecosystems across groups.
  for (const entry of options.currentReadyEntries ?? []) {
    const candidate = candidateByFileName.get(entry.fileName);
    if (!candidate || seen.has(candidate.fileName)) continue;
    seen.add(candidate.fileName);
    totalBytes += Math.max(0, candidate.sizeBytes);
    selected.push({
      entryPath: candidate.entryPath,
      fileName: candidate.fileName,
      packageLabel: candidate.packageLabel,
    });
  }

  for (const candidate of options.candidates) {
    if (selected.length >= options.maxMembers) break;
    if (seen.has(candidate.fileName)) continue;
    const nextTotal = totalBytes + Math.max(0, candidate.sizeBytes);
    if (nextTotal > options.maxBytes) continue;
    seen.add(candidate.fileName);
    totalBytes = nextTotal;
    selected.push({
      entryPath: candidate.entryPath,
      fileName: candidate.fileName,
      packageLabel: candidate.packageLabel,
    });
  }

  return selected;
}
