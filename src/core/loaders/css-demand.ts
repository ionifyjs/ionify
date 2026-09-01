import fs from "fs";
import path from "path";
import { getCacheKey } from "@core/cache";

export const CSS_DEMAND_PROOF_VERSION = 1;
export const CSS_CLASS_EXTRACTOR_VERSION = 2;

export type CssDemandSourceFact = {
  version: number;
  extractorVersion: number;
  filePath: string;
  contentHash: string;
  tokens: string[];
  tokenCount: number;
  uncertain: boolean;
  uncertaintyReasons: string[];
};

export type CssDemandProof = {
  proofVersion: number;
  extractorVersion: number;
  cssFile: string;
  cssHash: string;
  pipelineHash: string;
  dependencyCount: number;
  dependencyHash: string;
  classDemandHash: string;
  tokenCount: number;
  sourceFiles: Array<{ filePath: string; contentHash: string; tokenCount: number; uncertain: boolean }>;
  uncertain: boolean;
  uncertaintyReasons: string[];
};

export type CssDemandProfile = {
  extractionMs: number;
  filesScanned: number;
  cacheHits: number;
  cacheMisses: number;
  tokens: number;
  proofWriteMs: number;
};

export type CssDemandAnalysis = {
  proof: CssDemandProof;
  profile: CssDemandProfile;
};

const EMPTY_PROFILE: CssDemandProfile = {
  extractionMs: 0,
  filesScanned: 0,
  cacheHits: 0,
  cacheMisses: 0,
  tokens: 0,
  proofWriteMs: 0,
};

const inMemorySourceFacts = new Map<string, CssDemandSourceFact>();
const graphSourceFilesByRoot = new Map<string, string[]>();

// Stat-keyed content-hash memo: reuse a proven content hash while the file's
// stat identity (dev/ino/size/mtime/ctime) is unchanged, so demand freshness
// checks cost one stat per file instead of one full read+hash per file.
// Same per-source proof strategy as the build source-freshness scan.
const statKeyedContentHashes = new Map<string, { statKey: string; contentHash: string }>();

function statIdentityKey(stat: fs.Stats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function getSourceContentHash(filePath: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    statKeyedContentHashes.delete(filePath);
    return null;
  }
  if (!stat.isFile()) {
    statKeyedContentHashes.delete(filePath);
    return null;
  }
  const statKey = statIdentityKey(stat);
  const memo = statKeyedContentHashes.get(filePath);
  if (memo && memo.statKey === statKey) return memo.contentHash;
  let raw: Buffer;
  try {
    raw = fs.readFileSync(filePath);
  } catch {
    statKeyedContentHashes.delete(filePath);
    return null;
  }
  const contentHash = getCacheKey(raw);
  statKeyedContentHashes.set(filePath, { statKey, contentHash });
  return contentHash;
}

function nowMs(): number {
  return Date.now();
}

function cloneProfile(profile: CssDemandProfile): CssDemandProfile {
  return { ...profile };
}

function addProfile(into: CssDemandProfile, from: CssDemandProfile): void {
  into.extractionMs += from.extractionMs;
  into.filesScanned += from.filesScanned;
  into.cacheHits += from.cacheHits;
  into.cacheMisses += from.cacheMisses;
  into.tokens += from.tokens;
  into.proofWriteMs += from.proofWriteMs;
}

export function createCssDemandProfile(): CssDemandProfile {
  return cloneProfile(EMPTY_PROFILE);
}

export function isCssDemandSourceFile(filePath: string): boolean {
  const clean = filePath.split("?")[0]!.split("#")[0]!.toLowerCase();
  return (
    clean.endsWith(".js") ||
    clean.endsWith(".jsx") ||
    clean.endsWith(".ts") ||
    clean.endsWith(".tsx") ||
    clean.endsWith(".mdx") ||
    clean.endsWith(".html")
  );
}

function cssDemandRoot(rootDir: string): string {
  return path.join(process.env.IONIFY_STATE_DIR || path.join(rootDir, ".ionify"), "css-demand");
}

function canonicalPath(filePath: string): string {
  const abs = path.resolve(filePath);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
}

function sourceFactPath(rootDir: string, filePath: string, contentHash: string): string {
  const key = getCacheKey(`css-demand-source:v${CSS_CLASS_EXTRACTOR_VERSION}:${canonicalPath(filePath)}:${contentHash}`);
  return path.join(cssDemandRoot(rootDir), "sources", `${key}.json`);
}

function proofPath(rootDir: string, cssFile: string, cssHash: string, pipelineHash: string): string {
  const key = getCacheKey(`css-demand-proof:v${CSS_DEMAND_PROOF_VERSION}:${canonicalPath(cssFile)}:${cssHash}:${pipelineHash}`);
  return path.join(cssDemandRoot(rootDir), "proofs", `${key}.json`);
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function normalizeToken(token: string): string | null {
  const value = token.trim();
  if (!value || value.length > 240) return null;
  if (/[\s"'`<>]/.test(value)) return null;
  if (!/[A-Za-z0-9_\-\[\]():/%#.!]/.test(value)) return null;
  return value;
}

function addTokensFromClassString(value: string, tokens: Set<string>): void {
  for (const raw of value.split(/\s+/g)) {
    const token = normalizeToken(raw);
    if (token) tokens.add(token);
  }
}

function dynamicTemplateCanAffectClassDemand(code: string, templateStart: number): boolean {
  const prefix = code.slice(Math.max(0, templateStart - 160), templateStart);
  const jsxAttribute = prefix.match(/\b([A-Za-z_:][-A-Za-z0-9_:]*)\s*=\s*\{\s*$/);
  if (!jsxAttribute) return true;
  const attribute = jsxAttribute[1]!.toLowerCase();
  // These attributes publish accessibility/media text, never a class token.
  // Unknown attributes remain fail-closed because a component may interpret
  // their value as styling demand.
  return attribute !== "alt" && attribute !== "src" && !attribute.startsWith("aria-");
}

function extractClassDemandTokens(code: string): { tokens: string[]; uncertain: boolean; reasons: string[] } {
  const tokens = new Set<string>();
  const reasons = new Set<string>();
  let uncertain = false;

  const classAttrRe = /\b(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*\})/g;
  let match: RegExpExecArray | null;
  while ((match = classAttrRe.exec(code))) {
    addTokensFromClassString(match[1] || match[2] || match[3] || match[4] || match[5] || match[6] || "", tokens);
  }

  const classMapKeyRe = /(?:^|[\s,{])(?:"([^"]+)"|'([^']+)'|`([^`$]+)`)\s*:/g;
  while ((match = classMapKeyRe.exec(code))) {
    const value = match[1] || match[2] || match[3] || "";
    if (value.includes(" ") || /[:\[\]\/!-]/.test(value)) addTokensFromClassString(value, tokens);
  }

  const quotedUtilityRe = /(?:"([^"]*[\w\]-](?:[:\[\]\/!-][^"]*)?)"|'([^']*[\w\]-](?:[:\[\]\/!-][^']*)?)'|`([^`$]*[\w\]-](?:[:\[\]\/!-][^`$]*)?)`)/g;
  while ((match = quotedUtilityRe.exec(code))) {
    const value = match[1] || match[2] || match[3] || "";
    if (value.includes(" ") || /[:\[\]\/!-]/.test(value)) addTokensFromClassString(value, tokens);
  }

  if (/\b(?:class|className)\s*=\s*\{(?!\s*["'`])/.test(code)) {
    uncertain = true;
    reasons.add("dynamic-class-expression");
  }
  const dynamicTemplateRe = /`[^`]*\$\{/g;
  while ((match = dynamicTemplateRe.exec(code))) {
    if (!dynamicTemplateCanAffectClassDemand(code, match.index)) continue;
    uncertain = true;
    reasons.add("dynamic-template-literal");
    break;
  }

  return {
    tokens: Array.from(tokens).sort(),
    uncertain,
    reasons: Array.from(reasons).sort(),
  };
}

function loadOrExtractSourceFact(rootDir: string, filePath: string, profile: CssDemandProfile): CssDemandSourceFact | null {
  if (!isCssDemandSourceFile(filePath)) return null;
  const contentHash = getSourceContentHash(filePath);
  if (!contentHash) return null;
  const canonical = canonicalPath(filePath);
  const cacheKey = `${canonical}:${contentHash}`;
  const memory = inMemorySourceFacts.get(cacheKey);
  if (memory) {
    profile.cacheHits += 1;
    profile.tokens += memory.tokenCount;
    return memory;
  }

  const diskPath = sourceFactPath(rootDir, filePath, contentHash);
  const disk = readJson<CssDemandSourceFact>(diskPath);
  if (
    disk &&
    disk.version === CSS_DEMAND_PROOF_VERSION &&
    disk.extractorVersion === CSS_CLASS_EXTRACTOR_VERSION &&
    disk.filePath === canonical &&
    disk.contentHash === contentHash &&
    Array.isArray(disk.tokens)
  ) {
    inMemorySourceFacts.set(cacheKey, disk);
    profile.cacheHits += 1;
    profile.tokens += disk.tokenCount;
    return disk;
  }

  // Extraction miss: only now read the full content (the stat-memo hash above
  // guarantees the bytes match contentHash unless the file races a write, in
  // which case the next stat-key change re-extracts).
  let code: string;
  try {
    code = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const started = nowMs();
  const extracted = extractClassDemandTokens(code);
  const fact: CssDemandSourceFact = {
    version: CSS_DEMAND_PROOF_VERSION,
    extractorVersion: CSS_CLASS_EXTRACTOR_VERSION,
    filePath: canonical,
    contentHash,
    tokens: extracted.tokens,
    tokenCount: extracted.tokens.length,
    uncertain: extracted.uncertain,
    uncertaintyReasons: extracted.reasons,
  };
  profile.extractionMs += nowMs() - started;
  profile.filesScanned += 1;
  profile.cacheMisses += 1;
  profile.tokens += fact.tokenCount;
  inMemorySourceFacts.set(cacheKey, fact);
  try {
    writeJson(diskPath, fact);
  } catch {
    // Demand facts are reusable proof only; CSS compilation remains authoritative.
  }
  return fact;
}

export function buildCssDemandAnalysis(options: {
  rootDir: string;
  cssFile: string;
  cssHash: string;
  pipelineHash: string;
  deps: string[];
}): CssDemandAnalysis | null {
  const profile = createCssDemandProfile();
  const sourceFacts: CssDemandSourceFact[] = [];
  const seen = new Set<string>();
  const sortedDeps = Array.from(new Set(options.deps.map((dep) => canonicalPath(dep)))).sort();

  for (const dep of sortedDeps) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    const fact = loadOrExtractSourceFact(options.rootDir, dep, profile);
    if (fact) sourceFacts.push(fact);
  }

  if (sourceFacts.length === 0) return null;

  const tokenSet = new Set<string>();
  const uncertaintyReasons = new Set<string>();
  let uncertain = false;
  for (const fact of sourceFacts) {
    for (const token of fact.tokens) tokenSet.add(token);
    if (fact.uncertain) uncertain = true;
    for (const reason of fact.uncertaintyReasons) uncertaintyReasons.add(reason);
  }
  const tokens = Array.from(tokenSet).sort();
  const dependencyHash = getCacheKey(sortedDeps.map((dep) => {
    const fact = sourceFacts.find((item) => item.filePath === dep);
    return `${dep}:${fact?.contentHash ?? "unknown"}`;
  }).join("|"));

  const proof: CssDemandProof = {
    proofVersion: CSS_DEMAND_PROOF_VERSION,
    extractorVersion: CSS_CLASS_EXTRACTOR_VERSION,
    cssFile: canonicalPath(options.cssFile),
    cssHash: options.cssHash,
    pipelineHash: options.pipelineHash,
    dependencyCount: sortedDeps.length,
    dependencyHash,
    classDemandHash: getCacheKey(tokens.join(" ")),
    tokenCount: tokens.length,
    sourceFiles: sourceFacts
      .map((fact) => ({
        filePath: fact.filePath,
        contentHash: fact.contentHash,
        tokenCount: fact.tokenCount,
        uncertain: fact.uncertain,
      }))
      .sort((a, b) => a.filePath.localeCompare(b.filePath)),
    uncertain,
    uncertaintyReasons: Array.from(uncertaintyReasons).sort(),
  };

  const writeStart = nowMs();
  try {
    writeJson(proofPath(options.rootDir, options.cssFile, options.cssHash, options.pipelineHash), proof);
  } catch {
    // Demand proof persistence must not affect CSS output correctness.
  } finally {
    profile.proofWriteMs += nowMs() - writeStart;
  }

  return { proof, profile };
}

export function registerCssDemandGraphSourceFiles(
  rootDir: string,
  files: string[],
  options?: { stableTopology?: boolean },
): string[] {
  if (options?.stableTopology) {
    const persisted = readJson<CssDemandGraphStampIndex>(graphStampIndexPath(rootDir));
    const persistedPaths =
      persisted?.version === 2 && persisted.extractorVersion === CSS_CLASS_EXTRACTOR_VERSION
        ? Object.keys(persisted.entries)
        : [];
    if (persistedPaths.length > 0) {
      const canonicalRoot = canonicalPath(rootDir);
      const stableFiles = persistedPaths
        .sort()
        .map((relative) => path.join(canonicalRoot, relative));
      graphSourceFilesByRoot.set(canonicalRoot, stableFiles);
      return stableFiles;
    }
  }
  const canonicalFiles = files
    .map((item) => canonicalPath(item))
    .filter((item) => isCssDemandSourceFile(item))
    .sort();
  const unique = Array.from(new Set(canonicalFiles));
  graphSourceFilesByRoot.set(canonicalPath(rootDir), unique);
  return unique;
}

export function prewarmCssDemandSourceFacts(rootDir: string, files: string[]): CssDemandProfile {
  const profile = createCssDemandProfile();
  const seen = new Set<string>();
  const canonicalFiles = registerCssDemandGraphSourceFiles(rootDir, files);
  for (const file of canonicalFiles) {
    if (seen.has(file)) continue;
    seen.add(file);
    loadOrExtractSourceFact(rootDir, file, profile);
  }
  return profile;
}

export function getCssDemandGraphSourceFiles(rootDir: string): string[] {
  return graphSourceFilesByRoot.get(canonicalPath(rootDir))?.slice() ?? [];
}

export type CssDemandGraphContentStamp = {
  files: number;
  stamp: string;
  changed: boolean;
};

type CssDemandGraphStampIndex = {
  version: 2;
  extractorVersion: number;
  /** CSSA-owned aggregate identity for `entries`; absent only on legacy v2 indexes. */
  stamp?: string;
  files?: number;
  entries: Record<string, { statKey: string; demandEntry: string }>;
};

function graphStampIndexPath(rootDir: string): string {
  return path.join(cssDemandRoot(rootDir), "graph-stamp.v2.json");
}

function computePersistedStableTopologyStamp(
  rootDir: string,
  changedFiles: readonly string[],
  persisted: CssDemandGraphStampIndex,
): CssDemandGraphContentStamp | null {
  const rootCanonical = canonicalPath(rootDir);
  const previousEntries = persisted.entries;
  const persistedFileCount =
    Number.isInteger(persisted.files) && persisted.files! > 0
      ? persisted.files!
      : Object.keys(previousEntries).length;
  if (persistedFileCount === 0) return null;
  let previousStamp =
    typeof persisted.stamp === "string" && persisted.stamp.length > 0
      ? persisted.stamp
      : null;
  if (!previousStamp) {
    const previousDemandEntries = Object.values(previousEntries)
      .map((entry) => entry.demandEntry)
      .sort();
    if (previousDemandEntries.length === 0) return null;
    previousStamp = getCacheKey(
      `css-demand-graph-stamp:v2\n${previousDemandEntries.join("\n")}`,
    );
  }
  const profile = createCssDemandProfile();
  const changedEntries = new Map<string, CssDemandGraphStampIndex["entries"][string]>();
  for (const changedFile of changedFiles) {
    const canonical = canonicalPath(changedFile);
    const rel = path.relative(rootCanonical, canonical).split(path.sep).join("/");
    if (rel.startsWith("../")) return null;
    if (!previousEntries[rel]) {
      // Planner proved graph topology stable and CSSA's persisted index owns
      // the content membership. A changed non-member cannot affect CSS demand.
      continue;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(canonical);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    const fact = loadOrExtractSourceFact(rootDir, canonical, profile);
    if (!fact) return null;
    const demandIdentity = fact.uncertain
      ? `content:${fact.contentHash}`
      : `demand:${getCacheKey(fact.tokens.join("\n"))}`;
    const nextEntry = {
      statKey: statIdentityKey(stat),
      demandEntry: `${rel}:extractor=${fact.extractorVersion}:uncertain=${fact.uncertain ? 1 : 0}:reasons=${fact.uncertaintyReasons.join(",")}:${demandIdentity}`,
    };
    if (previousEntries[rel].demandEntry !== nextEntry.demandEntry) {
      changedEntries.set(rel, nextEntry);
    }
  }
  if (changedEntries.size === 0) {
    if (persisted.stamp !== previousStamp || persisted.files !== persistedFileCount) {
      try {
        writeJson(graphStampIndexPath(rootDir), {
          ...persisted,
          stamp: previousStamp,
          files: persistedFileCount,
        } satisfies CssDemandGraphStampIndex);
      } catch {
        // Local aggregate index is an accelerator only.
      }
    }
    return {
      files: persistedFileCount,
      stamp: previousStamp,
      changed: false,
    };
  }
  const nextEntries = { ...previousEntries };
  for (const [relative, entry] of changedEntries) nextEntries[relative] = entry;
  const entries = Object.values(nextEntries).map((entry) => entry.demandEntry).sort();
  const stamp = getCacheKey(`css-demand-graph-stamp:v2\n${entries.join("\n")}`);
  try {
    writeJson(graphStampIndexPath(rootDir), {
      version: 2,
      extractorVersion: CSS_CLASS_EXTRACTOR_VERSION,
      stamp,
      files: entries.length,
      entries: nextEntries,
    } satisfies CssDemandGraphStampIndex);
  } catch {
    // Local aggregate index is an accelerator only.
  }
  return {
    files: entries.length,
    stamp,
    changed: previousStamp !== stamp,
  };
}

/**
 * CSSA-owned compact refresh for a Planner-proven topology-stable mutation.
 * Missing, incompatible, or incomplete CSSA state returns null so the caller
 * can rebuild the authoritative content set from the canonical plan.
 */
export function refreshCssDemandGraphContentStamp(
  rootDir: string,
  changedFiles: readonly string[],
): CssDemandGraphContentStamp | null {
  const persisted = readJson<CssDemandGraphStampIndex>(graphStampIndexPath(rootDir));
  if (
    persisted?.version !== 2 ||
    persisted.extractorVersion !== CSS_CLASS_EXTRACTOR_VERSION
  ) {
    return null;
  }
  return computePersistedStableTopologyStamp(rootDir, changedFiles, persisted);
}

export type CssDemandGraphContentAuthorityFact = {
  enabled: boolean;
  files: number;
};

/**
 * CSSA is the sole authority for whether emitted CSS consumes graph-admitted
 * source content. Missing facts fail closed because the next CSS compile may
 * discover a Tailwind content pipeline.
 */
export function requiresCssDemandGraphContentStamp(
  facts: Array<CssDemandGraphContentAuthorityFact | null>,
): boolean {
  if (facts.length === 0) return false;
  return facts.some((fact) => fact === null || (fact.enabled === true && fact.files > 0));
}

/**
 * One CSSA-owned aggregated demand stamp over the graph-admitted Tailwind
 * content set. Proven static sources contribute their extracted utility demand,
 * so unrelated source edits do not invalidate CSS. Uncertain sources contribute
 * their complete content identity and therefore fail closed.
 *
 * Paths inside the stamp are workspace-relative (posix) so identical trees
 * produce identical stamps across machines (global CSS artifact cache).
 * Cost: one stat per registered file plus extraction for changed source facts.
 */
export function computeCssDemandGraphContentStamp(
  rootDir: string,
  options?: {
    /**
     * Planner has proven that graph topology is unchanged and the build source
     * audit has identified the complete changed-file set. CSSA still computes
     * demand identity; it may reuse its own entries for every other source.
     */
    stableTopologyChangedFiles?: string[];
  },
): CssDemandGraphContentStamp | null {
  const files = getCssDemandGraphSourceFiles(rootDir);
  if (files.length === 0) return null;
  const rootCanonical = canonicalPath(rootDir);
  const profile = createCssDemandProfile();
  const indexPath = graphStampIndexPath(rootDir);
  const persisted = readJson<CssDemandGraphStampIndex>(indexPath);
  const previousEntries =
    persisted?.version === 2 && persisted.extractorVersion === CSS_CLASS_EXTRACTOR_VERSION
      ? persisted.entries
      : {};
  const previousStamp =
    typeof persisted?.stamp === "string" && persisted.stamp.length > 0
      ? persisted.stamp
      : (() => {
          const previousDemandEntries = Object.values(previousEntries)
            .map((entry) => entry.demandEntry)
            .sort();
          return previousDemandEntries.length > 0
            ? getCacheKey(`css-demand-graph-stamp:v2\n${previousDemandEntries.join("\n")}`)
            : null;
        })();
  const stableChangedFiles = options?.stableTopologyChangedFiles;
  if (
    stableChangedFiles &&
    previousStamp &&
    Object.keys(previousEntries).length === files.length
  ) {
    return computePersistedStableTopologyStamp(rootDir, stableChangedFiles, persisted!);
  }
  const nextEntries: CssDemandGraphStampIndex["entries"] = {};
  const entries: string[] = [];
  for (const file of files) {
    const rel = path.relative(rootCanonical, file).split(path.sep).join("/");
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue; // deleted files leave the content set
    }
    if (!stat.isFile()) continue;
    const statKey = statIdentityKey(stat);
    const previous = previousEntries[rel];
    if (previous?.statKey === statKey && typeof previous.demandEntry === "string") {
      nextEntries[rel] = previous;
      entries.push(previous.demandEntry);
      continue;
    }
    const fact = loadOrExtractSourceFact(rootDir, file, profile);
    if (!fact) continue;
    const demandIdentity = fact.uncertain
      ? `content:${fact.contentHash}`
      : `demand:${getCacheKey(fact.tokens.join("\n"))}`;
    const demandEntry = `${rel}:extractor=${fact.extractorVersion}:uncertain=${fact.uncertain ? 1 : 0}:reasons=${fact.uncertaintyReasons.join(",")}:${demandIdentity}`;
    nextEntries[rel] = { statKey, demandEntry };
    entries.push(demandEntry);
  }
  entries.sort();
  const stamp = getCacheKey(`css-demand-graph-stamp:v2\n${entries.join("\n")}`);
  try {
    writeJson(indexPath, {
      version: 2,
      extractorVersion: CSS_CLASS_EXTRACTOR_VERSION,
      stamp,
      files: entries.length,
      entries: nextEntries,
    } satisfies CssDemandGraphStampIndex);
  } catch {
    // Local aggregate index is an accelerator only; per-source facts remain authoritative.
  }
  return {
    files: entries.length,
    stamp,
    changed: previousStamp !== stamp,
  };
}

export function mergeCssDemandProfile(into: CssDemandProfile, from: CssDemandProfile | null | undefined): void {
  if (!from) return;
  addProfile(into, from);
}
