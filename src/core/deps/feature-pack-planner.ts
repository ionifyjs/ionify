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
  packageName?: string | null;
  importerKeys?: string[];
  entryRootKeys?: string[];
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

export type AutoFeaturePackReadyGroup = {
  group: string;
  entries: FeaturePackPlanEntry[];
};

export type AutoFeaturePackPlan = {
  group: string | null;
  seedFileName: string;
  familyKey: string;
  entries: FeaturePackPlanEntry[];
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

function dedupeSortedStrings(values: Iterable<string>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    unique.add(value);
  }
  return Array.from(unique).sort();
}

function deriveFamilyKey(
  packageName: string | null | undefined,
  packageLabel: string | null | undefined,
): string {
  const pkg = String(packageName ?? "").trim();
  if (pkg.startsWith("@")) {
    const scope = pkg.split("/", 1)[0];
    if (scope) return scope;
  }
  if (pkg) {
    const base = pkg.split("/", 1)[0];
    if (base) return base;
  }

  const label = String(packageLabel ?? "").trim();
  if (label.startsWith("@")) {
    const parts = label.split("/");
    if (parts[0]) return parts[0];
  }
  if (label) {
    const base = label.split("/", 1)[0];
    if (base) return base;
  }
  return "";
}

function countIntersection(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): number {
  if (!a?.length || !b?.length) return 0;
  const set = new Set<string>(a);
  let count = 0;
  for (const value of b) {
    if (set.has(value)) count += 1;
  }
  return count;
}

function collectAnchorSignals(
  candidatesByFileName: Map<string, FeaturePackObservedEntry>,
  entries: readonly FeaturePackPlanEntry[],
): { families: string[]; importerKeys: string[]; entryRootKeys: string[] } {
  const families = new Set<string>();
  const importerKeys = new Set<string>();
  const entryRootKeys = new Set<string>();
  for (const entry of entries) {
    const candidate = candidatesByFileName.get(entry.fileName);
    const familyKey = deriveFamilyKey(candidate?.packageName, candidate?.packageLabel ?? entry.packageLabel);
    if (familyKey) families.add(familyKey);
    for (const importer of candidate?.importerKeys ?? []) {
      if (importer) importerKeys.add(importer);
    }
    for (const entryRoot of candidate?.entryRootKeys ?? []) {
      if (entryRoot) entryRootKeys.add(entryRoot);
    }
  }
  return {
    families: dedupeSortedStrings(families),
    importerKeys: dedupeSortedStrings(importerKeys),
    entryRootKeys: dedupeSortedStrings(entryRootKeys),
  };
}

function boostedCandidateOrder(
  candidates: readonly FeaturePackObservedEntry[],
  getBoost: (candidate: FeaturePackObservedEntry) => number,
): FeaturePackObservedEntry[] {
  return candidates
    .slice()
    .sort((a, b) => {
      const scoreDelta = b.score + getBoost(b) - (a.score + getBoost(a));
      if (scoreDelta !== 0) return scoreDelta;
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

type PlanAutoFeaturePackGroupsOptions = {
  candidates: readonly FeaturePackObservedEntry[];
  currentReadyGroups?: readonly AutoFeaturePackReadyGroup[] | null;
  maxMembers: number;
  maxBytes: number;
  minMembers: number;
  maxGroups?: number;
};

export function planAutoFeaturePackGroups(options: PlanAutoFeaturePackGroupsOptions): AutoFeaturePackPlan[] {
  const candidatesByFileName = new Map<string, FeaturePackObservedEntry>();
  for (const candidate of options.candidates) {
    if (!candidate?.fileName || candidatesByFileName.has(candidate.fileName)) continue;
    candidatesByFileName.set(candidate.fileName, candidate);
  }

  const candidates = Array.from(candidatesByFileName.values()).sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    const labelDelta = a.packageLabel.localeCompare(b.packageLabel);
    if (labelDelta !== 0) return labelDelta;
    return a.fileName.localeCompare(b.fileName);
  });
  if (candidates.length === 0) return [];

  const minMembers = Math.max(1, Math.floor(options.minMembers));
  const maxGroups = Math.max(1, Math.floor(options.maxGroups ?? 4));
  const readyGroups = (options.currentReadyGroups ?? [])
    .filter((group) => group?.group && Array.isArray(group.entries) && group.entries.length > 0)
    .slice()
    .sort((a, b) => a.group.localeCompare(b.group));

  const familyToReadyGroup = new Map<string, string>();
  const fileToReadyGroup = new Map<string, string>();
  for (const ready of readyGroups) {
    for (const entry of ready.entries) {
      if (!entry?.fileName) continue;
      fileToReadyGroup.set(entry.fileName, ready.group);
      const candidate = candidatesByFileName.get(entry.fileName);
      const familyKey = deriveFamilyKey(candidate?.packageName, candidate?.packageLabel ?? entry.packageLabel);
      if (familyKey && !familyToReadyGroup.has(familyKey)) {
        familyToReadyGroup.set(familyKey, ready.group);
      }
    }
  }

  const assigned = new Set<string>();
  const plans: AutoFeaturePackPlan[] = [];

  for (const ready of readyGroups) {
    const anchors = collectAnchorSignals(candidatesByFileName, ready.entries);
    const ordered = boostedCandidateOrder(
      candidates.filter((candidate) => {
        if (assigned.has(candidate.fileName)) return false;
        const reservedGroup = fileToReadyGroup.get(candidate.fileName);
        if (reservedGroup && reservedGroup !== ready.group) return false;
        const familyKey = deriveFamilyKey(candidate.packageName, candidate.packageLabel);
        const reservedFamilyGroup = familyKey ? familyToReadyGroup.get(familyKey) : null;
        if (reservedFamilyGroup && reservedFamilyGroup !== ready.group) return false;
        const sameReadyMember = ready.entries.some((entry) => entry.fileName === candidate.fileName);
        const sameFamily = !!familyKey && anchors.families.includes(familyKey);
        const sharedRoots = countIntersection(candidate.entryRootKeys, anchors.entryRootKeys) > 0;
        const sharedImporters = countIntersection(candidate.importerKeys, anchors.importerKeys) > 0;
        if (!sameReadyMember && !sameFamily && !sharedRoots && !sharedImporters) return false;
        return true;
      }),
      (candidate) => {
        let boost = 0;
        if (ready.entries.some((entry) => entry.fileName === candidate.fileName)) boost += 2000;
        const familyKey = deriveFamilyKey(candidate.packageName, candidate.packageLabel);
        if (familyKey && anchors.families.includes(familyKey)) boost += 800;
        boost += Math.min(3, countIntersection(candidate.entryRootKeys, anchors.entryRootKeys)) * 140;
        boost += Math.min(4, countIntersection(candidate.importerKeys, anchors.importerKeys)) * 50;
        return boost;
      },
    );

    const selected = selectStableFeaturePackEntries({
      currentReadyEntries: ready.entries,
      candidates: ordered,
      maxMembers: options.maxMembers,
      maxBytes: options.maxBytes,
    });
    if (selected.length < minMembers) continue;
    for (const entry of selected) assigned.add(entry.fileName);
    const familyKey =
      anchors.families[0] ||
      deriveFamilyKey(candidatesByFileName.get(selected[0]?.fileName ?? "")?.packageName, selected[0]?.packageLabel);
    plans.push({
      group: ready.group,
      seedFileName: selected[0]?.fileName ?? "",
      familyKey,
      entries: selected,
    });
  }

  for (const seed of candidates) {
    if (plans.length >= maxGroups) break;
    if (assigned.has(seed.fileName)) continue;
    const reservedGroup = fileToReadyGroup.get(seed.fileName);
    if (reservedGroup) continue;

    const seedFamily = deriveFamilyKey(seed.packageName, seed.packageLabel);
    const reservedFamilyGroup = seedFamily ? familyToReadyGroup.get(seedFamily) : null;
    if (reservedFamilyGroup) continue;

    const ordered = boostedCandidateOrder(
      candidates.filter((candidate) => {
        if (assigned.has(candidate.fileName)) return false;
        if (fileToReadyGroup.has(candidate.fileName)) return false;
        const candidateFamily = deriveFamilyKey(candidate.packageName, candidate.packageLabel);
        if (candidateFamily && familyToReadyGroup.has(candidateFamily)) return false;
        const sharedRoots = countIntersection(candidate.entryRootKeys, seed.entryRootKeys) > 0;
        const sharedImporters = countIntersection(candidate.importerKeys, seed.importerKeys) > 0;
        const sameFamily = !!seedFamily && candidateFamily === seedFamily;
        if (candidate.fileName !== seed.fileName && !sameFamily && !sharedRoots && !sharedImporters) return false;
        return true;
      }),
      (candidate) => {
        let boost = 0;
        const candidateFamily = deriveFamilyKey(candidate.packageName, candidate.packageLabel);
        if (candidate.fileName === seed.fileName) boost += 2000;
        if (seedFamily && candidateFamily === seedFamily) boost += 900;
        boost += Math.min(3, countIntersection(candidate.entryRootKeys, seed.entryRootKeys)) * 180;
        boost += Math.min(4, countIntersection(candidate.importerKeys, seed.importerKeys)) * 60;
        return boost;
      },
    );

    const selected = selectStableFeaturePackEntries({
      candidates: ordered,
      maxMembers: options.maxMembers,
      maxBytes: options.maxBytes,
    });
    if (selected.length < minMembers) continue;
    for (const entry of selected) assigned.add(entry.fileName);
    plans.push({
      group: null,
      seedFileName: selected[0]?.fileName ?? seed.fileName,
      familyKey: seedFamily,
      entries: selected,
    });
  }

  return plans;
}
