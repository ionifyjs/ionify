/**
{
  "description": "Persistent dependency graph manager. Builds and maintains relationships between modules, tracks hashes, and invalidates nodes when sources change.",
  "phase": 1,
  "todo": [
    "Implement GraphNode and Edge types.",
    "Create addNode(), addEdge(), and updateNodeHash().",
    "Persist graph using SQLite or sled.",
    "Expose query API for dependencies and dependents.",
    "Integrate with cache.ts for cache validation."
  ]
}
*/


import fs from "fs";
import path from "path";
import { native as nativeBinding, ensureNativeGraph, computeGraphVersion } from "@native/index";

export interface GraphNode {
  id: string;            // absolute path
  hash: string | null;   // content hash (sha256) or null
  deps: string[];        // absolute paths of static dependencies
  dynamicDeps?: string[]; // absolute paths of dynamic dependencies
  kind?: string;         // module kind (e.g., "js", "css", "asset")
  configHash?: string | null; // config hash used when this node was recorded
  mtimeMs: number | null;
}

export interface GraphSnapshot {
  version: 1;
  nodes: Record<string, GraphNode>; // key = absolute path
}

const IONIFY_DIR = path.join(process.cwd(), ".ionify");
const GRAPH_FILE = path.join(IONIFY_DIR, "graph.json");
const GRAPH_DB_FILE = path.join(IONIFY_DIR, "graph.db");

function ensureIonifyDir() {
  if (!fs.existsSync(IONIFY_DIR)) fs.mkdirSync(IONIFY_DIR, { recursive: true });
}

export class Graph {
  private nodes: Map<string, GraphNode> = new Map();
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly native = nativeBinding ?? null;
  private nativeFlushTimer: NodeJS.Timeout | null = null;

  private queueSave() {
    if (this.native) return;
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  constructor(versionInputs?: Parameters<typeof computeGraphVersion>[0]) {
    ensureIonifyDir();
    if (this.native) {
      const version = versionInputs ? computeGraphVersion(versionInputs) : undefined;
      ensureNativeGraph(GRAPH_DB_FILE, version);
    }
    this.load();
  }

  private load() {
    if (this.native) {
      try {
        // Prefer sled snapshot when native bindings are available.
        const snapshot = this.native.graphLoad();
        for (const node of snapshot) {
          const stat = fs.existsSync(node.id) ? fs.statSync(node.id) : null;
          this.nodes.set(node.id, {
            id: node.id,
            hash: node.hash,
            deps: node.deps,
            dynamicDeps: node.dynamicDeps,
            kind: node.kind,
            configHash: (node as any).config_hash ?? (node as any).configHash ?? null,
            mtimeMs: stat ? stat.mtimeMs : null,
          });
        }
      } catch {
        // fallback to JSON if native load fails
        this.loadFromDisk();
      }
      return;
    }
    this.loadFromDisk();
  }

  private loadFromDisk() {
    if (!fs.existsSync(GRAPH_FILE)) return;
    try {
      const raw = fs.readFileSync(GRAPH_FILE, "utf8");
      const snap = JSON.parse(raw) as GraphSnapshot;
      if (snap.version === 1 && snap.nodes) {
        for (const [id, node] of Object.entries(snap.nodes)) {
          this.nodes.set(id, node);
        }
      }
    } catch {
      // ignore parse errors for now (fresh start)
    }
  }

  private scheduleNativeFlush() {
    if (!this.native?.graphFlush) return;
    if (this.nativeFlushTimer) return;
    this.nativeFlushTimer = setTimeout(() => {
      this.nativeFlushTimer = null;
      try {
        this.native?.graphFlush?.();
      } catch {
        // ignore flush errors; next cycle will retry
      }
    }, 250);
  }

  private scheduleSave() {
    if (this.native) return; // sled handles persistence
    this.queueSave();
  }

  private save() {
    if (this.native) return; // sled handles persistence
    try {
      const snap: GraphSnapshot = {
        version: 1,
        nodes: Object.fromEntries(this.nodes.entries()),
      };
      fs.writeFileSync(GRAPH_FILE, JSON.stringify(snap, null, 2), "utf8");
      this.dirty = false;
    } catch {
      // swallow for now
    } finally {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
    }
  }

  /** Upsert a node and its deps; returns true if hash changed */
  recordFile(absPath: string, contentHash: string, depsAbs: string[], dynamicDeps?: string[], kind?: string): boolean {
    const stat = fs.existsSync(absPath) ? fs.statSync(absPath) : null;
    const mtimeMs = stat ? stat.mtimeMs : null;
    const configHash = process.env.IONIFY_CONFIG_HASH || null;

    const prev = this.nodes.get(absPath);
    let changed = !prev || prev.hash !== contentHash;

    const node: GraphNode = {
      id: absPath,
      hash: contentHash,
      deps: Array.from(new Set(depsAbs)),
      dynamicDeps: dynamicDeps ? Array.from(new Set(dynamicDeps)) : undefined,
      kind: kind || this.inferKind(absPath),
      configHash,
      mtimeMs,
    };
    this.nodes.set(absPath, node);
    if (this.native) {
      try {
        changed = this.native.graphRecord(
          absPath,
          contentHash,
          node.deps,
          node.dynamicDeps || [],
          node.kind,
          node.configHash ?? null
        );
        this.scheduleNativeFlush();
      } catch (err) {
        console.error(`[Graph] Failed to record ${absPath}:`, err);
        // fall back to JS-determined change flag
      }
    }
    this.scheduleSave();
    return changed;
  }

  /** Infer module kind from file extension */
  private inferKind(absPath: string): string {
    const ext = path.extname(absPath).toLowerCase();
    if (/\.(module)\.css$/i.test(absPath)) return "css-module";
    if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(ext)) return "js";
    if (ext === ".css") return "css";
    if ([".json"].includes(ext)) return "json";
    return "asset";
  }

  getNode(absPath: string): GraphNode | undefined {
    return this.nodes.get(absPath);
  }

  getDeps(absPath: string): string[] {
    return this.nodes.get(absPath)?.deps ?? [];
  }

  /** Reverse edges: who depends on target? */
  getDependents(targetAbs: string): string[] {
    const candidates = new Set<string>();
    // Native path uses sled reverse index for O(1) lookups.
    if (this.native?.graphDependents) {
      try {
        for (const dep of this.native.graphDependents(targetAbs) ?? []) {
          candidates.add(dep);
        }
      } catch {
        // ignore native errors and fall back to JS map
      }
    }
    for (const [id, node] of this.nodes) {
      if (node.deps.includes(targetAbs)) candidates.add(id);
    }
    return Array.from(candidates);
  }

  /** Collect dependents recursively (breadth-first) */
  collectDependentsDeep(targetAbs: string): string[] {
    const result = new Set<string>();
    const queue: string[] = [targetAbs];
    while (queue.length) {
      const current = queue.shift()!;
      for (const dep of this.getDependents(current)) {
        if (!result.has(dep)) {
          result.add(dep);
          queue.push(dep);
        }
      }
    }
    return Array.from(result);
  }

  /** Includes changed files and all dependents */
  collectAffected(changed: string[]): string[] {
    const result = new Set<string>();
    let usedNative = false;
    if (this.native?.graphCollectAffected) {
      try {
        const nativeList = this.native.graphCollectAffected(changed);
        for (const item of nativeList ?? []) {
          result.add(item);
        }
        usedNative = true;
      } catch {
        // ignore native failure, fall back to JS traversal
      }
    }

    for (const target of changed) {
      result.add(target);
    }

    if (!usedNative || result.size === 0) {
      // Fallback to JS BFS to ensure correctness without native bindings.
      for (const target of changed) {
        result.add(target);
        for (const dep of this.collectDependentsDeep(target)) {
          result.add(dep);
        }
      }
    }

    return Array.from(result);
  }

  /** Remove file from graph and clean up dependents lists */
  removeFile(absPath: string) {
    const existed = this.nodes.delete(absPath);
    if (existed) {
      for (const node of this.nodes.values()) {
        if (node.deps.includes(absPath)) {
          node.deps = node.deps.filter((dep) => dep !== absPath);
        }
      }
      if (this.native) {
        try {
          this.native.graphRemove(absPath);
          this.scheduleNativeFlush();
        } catch {
          // ignore
        }
      }
      this.queueSave();
    }
  }

  /** Persist immediately (e.g., on shutdown) */
  flush() {
    if (this.nativeFlushTimer) {
      clearTimeout(this.nativeFlushTimer);
      this.nativeFlushTimer = null;
    }
    if (this.native?.graphFlush) {
      try {
        this.native.graphFlush();
      } catch {
        // ignore flush failure on shutdown
      }
    }
    if (this.dirty) this.save();
  }
}



// ===== Next Phase TODOs =====
// Phase 2: Integrate with HMR diffing.
// Phase 3: Serialize build plans for bundler.
// Phase 4: Support monorepo multi-workspace graphs.
// Phase 5: Expose metrics for Analyzer visualization.
