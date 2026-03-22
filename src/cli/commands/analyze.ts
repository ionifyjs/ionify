/**
{
  "description": "Implements the 'analyze' CLI command for visualizing Ionify build statistics, cache hits, dependency graph size, and performance metrics.",
  "phase": 0,
  "todo": [
    "Create analyzeCommand() entry point.",
    "Load and summarize graph + cache metrics.",
    "Print analysis summary to terminal.",
    "Prepare JSON output for later Analyzer UI integration.",
    "Integrate with logger and spinner utilities."
  ]
}
*/

import fs from "fs";
import path from "path";
import { native } from "@native/index";
import { logInfo, logError } from "@cli/utils/logger";
import { resolveWorkspace } from "@core/workspace";
import { hashVendorPackV2RoutingIndex } from "@core/deps/routing-hash";

interface AnalyzeOptions {
  json?: boolean;
  limit?: number;
}

interface GraphNodeSummary {
  id: string;
  hash: string | null;
  deps: string[];
}

interface AnalyzeSummary {
  modules: number;
  edges: number;
  averageDeps: number;
  densest: Array<{ id: string; deps: number }>;
  mostDepended: Array<{ id: string; dependents: number }>;
  orphans: string[];
  vendorPacks?: VendorPackAnalyzeSummary | null;
}

type VendorPackAnalyzePack = {
  packFileName: string;
  members: number;
  chunkFiles: string[];
  requestsPacked: number;
  requestsUnpacked: number;
  requestsSaved: number;
  bytesPacked: number | null;
  bytesWrappers: number | null;
};

type VendorPackAnalyzeSlimGroup = {
  label: string;
  baseSharedBytes: number | null;
  slimSharedBytes: number | null;
  savedBytes: number | null;
};

type VendorPackAnalyzeSummary = {
  depsHash: string;
  packIndexHash: string | null;
  usageIndexHash: string | null;
  packs: VendorPackAnalyzePack[];
  slimGroups: VendorPackAnalyzeSlimGroup[];
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "n/a";
  const value = Math.max(0, Math.floor(bytes));
  if (value < 1024) return `${value}B`;
  const kb = value / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)}GB`;
}

function findLatestDepsRoot(ionifyDir: string): { depsHash: string; depsRoot: string } | null {
  const depsDir = path.join(ionifyDir, "deps");
  if (!fs.existsSync(depsDir)) return null;
  const candidates = fs
    .readdirSync(depsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const depsHash = entry.name;
      const depsRoot = path.join(depsDir, depsHash);
      const indexPath = path.join(depsRoot, "vendor-pack.v2.index.json");
      const statPath = fs.existsSync(indexPath) ? indexPath : depsRoot;
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(statPath).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { depsHash, depsRoot, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const best = candidates[0];
  if (!best) return null;
  return { depsHash: best.depsHash, depsRoot: best.depsRoot };
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function statSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function analyzeVendorPacks(depsRoot: string, depsHash: string, limit: number): VendorPackAnalyzeSummary | null {
  const indexPath = path.join(depsRoot, "vendor-pack.v2.index.json");
  const index = readJson<any>(indexPath);
  if (!index || index.version !== 1 || index.depsHash !== depsHash) return null;

  const packIndexHash = typeof index.packIndexHash === "string" ? index.packIndexHash : hashVendorPackV2RoutingIndex(index, depsHash);
  const usageIndexHash = typeof index.usageIndexHash === "string" ? index.usageIndexHash : null;

  const routing: Record<string, string> = index.fileNameToPackFile && typeof index.fileNameToPackFile === "object" ? index.fileNameToPackFile : {};
  const packToChunks: Record<string, string[]> =
    index.packFileToChunkFiles && typeof index.packFileToChunkFiles === "object" ? index.packFileToChunkFiles : {};

  const membersByPack = new Map<string, string[]>();
  for (const [fileName, packFileName] of Object.entries(routing)) {
    if (typeof fileName !== "string" || typeof packFileName !== "string") continue;
    const list = membersByPack.get(packFileName) ?? [];
    list.push(fileName);
    membersByPack.set(packFileName, list);
  }

  const packs: VendorPackAnalyzePack[] = [];
  for (const [packFileName, members] of membersByPack.entries()) {
    const chunkFilesRaw = Array.isArray(packToChunks[packFileName]) ? packToChunks[packFileName] : [];
    const chunkFiles = chunkFilesRaw.filter((v) => typeof v === "string" && v.endsWith(".js"));
    const uniqueChunks = Array.from(new Set(chunkFiles)).sort();
    const requestsPacked = 1 + uniqueChunks.length;
    const requestsUnpacked = members.length;
    const requestsSaved = Math.max(0, requestsUnpacked - requestsPacked);

    const packBytes = statSize(path.join(depsRoot, packFileName));
    let chunksBytes = 0;
    let chunksKnown = true;
    for (const chunk of uniqueChunks) {
      const b = statSize(path.join(depsRoot, chunk));
      if (b === null) chunksKnown = false;
      chunksBytes += b ?? 0;
    }
    const bytesPacked = packBytes === null || !chunksKnown ? null : packBytes + chunksBytes;

    let wrappersBytes = 0;
    let wrappersKnown = true;
    for (const fileName of members) {
      const b = statSize(path.join(depsRoot, fileName));
      if (b === null) wrappersKnown = false;
      wrappersBytes += b ?? 0;
    }
    const bytesWrappers = wrappersKnown ? wrappersBytes : null;

    packs.push({
      packFileName,
      members: members.length,
      chunkFiles: uniqueChunks,
      requestsPacked,
      requestsUnpacked,
      requestsSaved,
      bytesPacked,
      bytesWrappers,
    });
  }

  packs.sort((a, b) => b.requestsSaved - a.requestsSaved || b.members - a.members || a.packFileName.localeCompare(b.packFileName));

  const slimGroups: VendorPackAnalyzeSlimGroup[] = [];
  const files = fs.existsSync(depsRoot) ? fs.readdirSync(depsRoot) : [];
  const stateFiles = files.filter((f) => f.startsWith("vendor-pack.") && f.endsWith(".json"));
  for (const file of stateFiles) {
    if (file.endsWith(".slim.json")) continue;
    const base = readJson<any>(path.join(depsRoot, file));
    if (!base || base.version !== 1 || base.depsHash !== depsHash) continue;
    const slimFile = file.replace(/\.json$/, ".slim.json");
    const slim = readJson<any>(path.join(depsRoot, slimFile));
    if (!slim || slim.version !== 1 || slim.depsHash !== depsHash) continue;
    if (base.status !== "ready" || slim.status !== "ready") continue;
    const baseShared = typeof base.sharedFileName === "string" ? base.sharedFileName : null;
    const slimShared = typeof slim.sharedFileName === "string" ? slim.sharedFileName : null;
    const baseBytes = baseShared ? statSize(path.join(depsRoot, baseShared)) : null;
    const slimBytes = slimShared ? statSize(path.join(depsRoot, slimShared)) : null;
    const savedBytes =
      baseBytes !== null && slimBytes !== null && baseBytes > 0 && slimBytes > 0 ? baseBytes - slimBytes : null;
    const label = file.replace(/^vendor-pack\./, "").replace(/\.json$/, "");
    slimGroups.push({ label, baseSharedBytes: baseBytes, slimSharedBytes: slimBytes, savedBytes });
  }
  slimGroups.sort((a, b) => (b.savedBytes ?? -1) - (a.savedBytes ?? -1) || a.label.localeCompare(b.label));

  return {
    depsHash,
    packIndexHash,
    usageIndexHash,
    packs: packs.slice(0, Math.max(1, limit)),
    slimGroups: slimGroups.slice(0, Math.max(1, limit)),
  };
}

function readGraphFromDisk(ionifyDir: string): GraphNodeSummary[] | null {
  const file = path.join(ionifyDir, "graph.json");
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const snapshot = JSON.parse(raw);
    if (snapshot?.version !== 1 || !snapshot?.nodes) return null;
    return Object.entries<Record<string, any>>(snapshot.nodes).map(([id, node]) => ({
      id,
      hash: node.hash ?? null,
      deps: Array.isArray(node.deps) ? node.deps : [],
    }));
  } catch (err) {
    logError("Failed to read graph snapshot", err);
    return null;
  }
}

function computeSummary(nodes: GraphNodeSummary[], limit = 10): AnalyzeSummary {
  const modules = nodes.length;
  let edgeCount = 0;
  const dependentCounts = new Map<string, number>();

  for (const node of nodes) {
    for (const dep of node.deps) {
      edgeCount += 1;
      dependentCounts.set(dep, (dependentCounts.get(dep) ?? 0) + 1);
    }
  }

  const densest = [...nodes]
    .sort((a, b) => b.deps.length - a.deps.length)
    .slice(0, limit)
    .map((node) => ({ id: node.id, deps: node.deps.length }));

  const mostDepended = [...dependentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, dependents: count }));

  const orphanSet = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    for (const dep of node.deps) {
      orphanSet.delete(dep);
    }
  }

  return {
    modules,
    edges: edgeCount,
    averageDeps: modules === 0 ? 0 : edgeCount / modules,
    densest,
    mostDepended,
    orphans: Array.from(orphanSet),
  };
}

async function loadGraphSnapshot(): Promise<GraphNodeSummary[] | null> {
  if (native?.graphLoad) {
    try {
      const nodes = native.graphLoad();
      if (Array.isArray(nodes)) {
        return nodes.map((node) => ({
          id: node.id,
          hash: node.hash ?? null,
          deps: Array.isArray(node.deps) ? node.deps : [],
        }));
      }
    } catch (err) {
      logError("Failed to load native graph snapshot", err);
    }
  }
  const ws = resolveWorkspace(process.cwd());
  return readGraphFromDisk(ws.ionifyDir);
}

export async function runAnalyzeCommand(options: AnalyzeOptions = {}) {
  const nodes = await loadGraphSnapshot();
  if (!nodes || nodes.length === 0) {
    logInfo("No cached graph found. Run `ionify dev` to generate dependency data.");
    return;
  }

  const limit = options.limit ?? 10;
  const summary = computeSummary(nodes, limit);
  const ws = resolveWorkspace(process.cwd());
  const depsInfo = findLatestDepsRoot(ws.ionifyDir);
  const vendorPacks =
    depsInfo && fs.existsSync(path.join(depsInfo.depsRoot, "vendor-pack.v2.index.json"))
      ? analyzeVendorPacks(depsInfo.depsRoot, depsInfo.depsHash, limit)
      : null;
  summary.vendorPacks = vendorPacks;

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  logInfo("Ionify Graph Summary");
  console.log(` Modules: ${summary.modules}`);
  console.log(` Dependencies: ${summary.edges}`);
  console.log(` Avg deps / module: ${summary.averageDeps.toFixed(2)}`);

  if (summary.densest.length > 0) {
    console.log("\n Top modules by dependency count:");
    for (const entry of summary.densest) {
      console.log(`  • ${entry.id} (${entry.deps})`);
    }
  }

  if (summary.mostDepended.length > 0) {
    console.log("\n Top modules by inbound dependents:");
    for (const entry of summary.mostDepended) {
      console.log(`  • ${entry.id} (${entry.dependents})`);
    }
  }

  if (summary.orphans.length) {
    console.log("\n Orphan modules (no dependents):");
    for (const file of summary.orphans.slice(0, options.limit ?? 10)) {
      console.log(`  • ${file}`);
    }
    if (summary.orphans.length > (options.limit ?? 10)) {
      console.log(`  • …and ${summary.orphans.length - (options.limit ?? 10)} more`);
    }
  }

  if (vendorPacks) {
    console.log("\n Vendor packs (v2)");
    console.log(` depsHash: ${vendorPacks.depsHash}`);
    if (vendorPacks.packIndexHash) console.log(` packIndexHash: ${vendorPacks.packIndexHash}`);
    if (vendorPacks.usageIndexHash) console.log(` usageIndexHash: ${vendorPacks.usageIndexHash}`);

    if (vendorPacks.packs.length > 0) {
      console.log("\n Top packs by request savings (approx):");
      for (const p of vendorPacks.packs) {
        const reqLabel = `${p.requestsUnpacked}→${p.requestsPacked} (saved ${p.requestsSaved})`;
        const bytesLabel =
          p.bytesWrappers !== null && p.bytesPacked !== null
            ? `${formatBytes(p.bytesWrappers)}→${formatBytes(p.bytesPacked)}`
            : "n/a";
        console.log(`  • ${p.packFileName} members=${p.members} requests=${reqLabel} bytes=${bytesLabel}`);
      }
    }

    if (vendorPacks.slimGroups.length > 0) {
      console.log("\n Slimming (base → slim shared bytes):");
      for (const g of vendorPacks.slimGroups) {
        const saved = g.savedBytes !== null && g.savedBytes > 0 ? `saved ${formatBytes(g.savedBytes)}` : "saved n/a";
        console.log(
          `  • ${g.label}: ${formatBytes(g.baseSharedBytes)}→${formatBytes(g.slimSharedBytes)} (${saved})`,
        );
      }
    }
  }
}



// ===== Next Phase TODOs =====
// Phase 5: Connect to Analyzer dashboard React UI.
// Phase 6: Enable AI-based recommendations for optimization.
