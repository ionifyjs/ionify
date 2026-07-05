import fs from "fs";
import path from "path";
import { getCacheKey } from "@core/cache";

export const CSS_DEMAND_PROOF_VERSION = 1;
export const CSS_CLASS_EXTRACTOR_VERSION = 1;

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
  if (/`[^`]*\$\{/.test(code)) {
    uncertain = true;
    reasons.add("dynamic-template-literal");
  }

  return {
    tokens: Array.from(tokens).sort(),
    uncertain,
    reasons: Array.from(reasons).sort(),
  };
}

function loadOrExtractSourceFact(rootDir: string, filePath: string, profile: CssDemandProfile): CssDemandSourceFact | null {
  if (!isCssDemandSourceFile(filePath)) return null;
  let raw: Buffer;
  try {
    raw = fs.readFileSync(filePath);
  } catch {
    return null;
  }

  const contentHash = getCacheKey(raw);
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

  const started = nowMs();
  const extracted = extractClassDemandTokens(raw.toString("utf8"));
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

export function registerCssDemandGraphSourceFiles(rootDir: string, files: string[]): string[] {
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

export function mergeCssDemandProfile(into: CssDemandProfile, from: CssDemandProfile | null | undefined): void {
  if (!from) return;
  addProfile(into, from);
}
