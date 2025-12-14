import fs from "fs";
import path from "path";
import { native } from "@native/index";
import { logInfo, logError } from "@cli/utils/logger";

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
}

function readGraphFromDisk(root: string): GraphNodeSummary[] | null {
  const file = path.join(root, ".ionify", "graph.json");
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
  return readGraphFromDisk(process.cwd());
}

export async function runAnalyzeCommand(options: AnalyzeOptions = {}) {
  const nodes = await loadGraphSnapshot();
  if (!nodes || nodes.length === 0) {
    logInfo("No cached graph found. Run `ionify dev` to generate dependency data.");
    return;
  }

  const summary = computeSummary(nodes, options.limit ?? 10);

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
}



