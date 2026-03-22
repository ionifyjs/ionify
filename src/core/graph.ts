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
import { fromWsModuleId, resolveWorkspaceRoot, toWsModuleId } from "@core/module-id";

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
  version: 2;
  nodes: Record<string, StoredGraphNode>; // key = module ID
}

function resolveIonifyDir(explicit?: string | null): string {
  if (explicit) return path.resolve(explicit);
  const fromEnv = process.env.IONIFY_STATE_DIR;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  return path.join(process.cwd(), ".ionify");
}

interface StoredGraphNode {
  id: string; // workspace module ID (ws://...)
  hash: string | null;
  deps: string[];
  dynamicDeps?: string[];
  kind?: string;
  configHash?: string | null;
  mtimeMs: number | null;
}

export class Graph {
  private readonly ionifyDir: string;
  private readonly graphFile: string;
  private readonly graphDbPath: string;
  private readonly workspaceRoot: string;
  private nodes: Map<string, StoredGraphNode> = new Map();
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private native = nativeBinding ?? null;
  private nativeFlushTimer: NodeJS.Timeout | null = null;

  private queueSave() {
    if (this.native) return;
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  constructor(
    versionInputs?: Parameters<typeof computeGraphVersion>[0],
    opts: { ionifyDir?: string | null } = {},
  ) {
    this.ionifyDir = resolveIonifyDir(opts.ionifyDir ?? null);
    this.graphFile = path.join(this.ionifyDir, "graph.json");
    this.graphDbPath = path.join(this.ionifyDir, "graph.db");
    this.workspaceRoot = resolveWorkspaceRoot(null);

    if (!fs.existsSync(this.ionifyDir)) {
      fs.mkdirSync(this.ionifyDir, { recursive: true });
    }
    if (this.native) {
      const version = versionInputs ? computeGraphVersion(versionInputs) : undefined;
      const ok = ensureNativeGraph(this.graphDbPath, version);
      if (!ok) {
        // If the native graph can't be initialized (e.g. another process holds the sled lock),
        // fall back to the JSON graph to avoid breaking the dev/build lifecycle.
        this.native = null;
      }
    }
    this.load();
  }

  private load() {
    if (this.native) {
      try {
        // Prefer sled snapshot when native bindings are available.
        const snapshot = this.native.graphLoad();
        for (const node of snapshot) {
          const id = node.id;
          const fsPath = fromWsModuleId(id, this.workspaceRoot);
          const stat = fsPath && fs.existsSync(fsPath) ? fs.statSync(fsPath) : null;
          const dynamicDeps = Array.isArray((node as any).dynamicDeps)
            ? (node as any).dynamicDeps
            : Array.isArray((node as any).dynamic_deps)
              ? (node as any).dynamic_deps
              : [];
          this.nodes.set(id, {
            id,
            hash: node.hash,
            deps: Array.isArray(node.deps) ? node.deps : [],
            dynamicDeps,
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
    if (!fs.existsSync(this.graphFile)) return;
    try {
      const raw = fs.readFileSync(this.graphFile, "utf8");
      const snap = JSON.parse(raw) as GraphSnapshot;
      if (snap.version === 2 && snap.nodes) {
        for (const [id, node] of Object.entries(snap.nodes)) {
          if (!id.startsWith("ws://")) continue;
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
        version: 2,
        nodes: Object.fromEntries(this.nodes.entries()),
      };
      fs.writeFileSync(this.graphFile, JSON.stringify(snap, null, 2), "utf8");
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

  private moduleIdForPath(absPath: string): string | null {
    return toWsModuleId(absPath, this.workspaceRoot);
  }

  private pathForModuleId(moduleId: string): string | null {
    return fromWsModuleId(moduleId, this.workspaceRoot);
  }

  private depsToPaths(ids: string[]): string[] {
    const out: string[] = [];
    for (const id of ids) {
      const abs = this.pathForModuleId(id);
      if (abs) out.push(abs);
    }
    return out;
  }

  /** Upsert a node and its deps; returns true if hash changed */
  recordFile(absPath: string, contentHash: string, depsAbs: string[], dynamicDeps?: string[], kind?: string): boolean {
    const moduleId = this.moduleIdForPath(absPath);
    if (!moduleId) return false;
    const stat = fs.existsSync(absPath) ? fs.statSync(absPath) : null;
    const mtimeMs = stat ? stat.mtimeMs : null;
    const configHash = process.env.IONIFY_CONFIG_HASH || null;

    const prev = this.nodes.get(moduleId);
    let changed = !prev || prev.hash !== contentHash;

    const deps = Array.from(new Set(depsAbs.map((p) => this.moduleIdForPath(p)).filter((v): v is string => !!v)));
    const dyn = dynamicDeps
      ? Array.from(new Set(dynamicDeps.map((p) => this.moduleIdForPath(p)).filter((v): v is string => !!v)))
      : undefined;

    const node: StoredGraphNode = {
      id: moduleId,
      hash: contentHash,
      deps,
      dynamicDeps: dyn,
      kind: kind || this.inferKind(absPath),
      configHash,
      mtimeMs,
    };
    this.nodes.set(moduleId, node);
    if (this.native) {
      try {
        changed = this.native.graphRecord(
          moduleId,
          contentHash,
          deps,
          dyn || [],
          node.kind,
          node.configHash ?? null
        );
        this.scheduleNativeFlush();
      } catch (err) {
        console.error(`[Graph] Failed to record ${moduleId}:`, err);
        // fall back to JS-determined change flag
      }
    }
    this.scheduleSave();
    return changed;
  }

  /** Infer module kind from file extension */
  private inferKind(absPath: string): string {
    const ext = path.extname(absPath).toLowerCase();
    if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(ext)) return "js";
    if (ext === ".css") return "css";
    if ([".json"].includes(ext)) return "json";
    return "asset";
  }

  getNode(absPath: string): GraphNode | undefined {
    const moduleId = this.moduleIdForPath(absPath);
    if (!moduleId) return undefined;
    const node = this.nodes.get(moduleId);
    if (!node) return undefined;
    return {
      id: absPath,
      hash: node.hash,
      deps: this.depsToPaths(node.deps),
      dynamicDeps: node.dynamicDeps ? this.depsToPaths(node.dynamicDeps) : undefined,
      kind: node.kind,
      configHash: node.configHash,
      mtimeMs: node.mtimeMs,
    };
  }

  getDeps(absPath: string): string[] {
    return this.getNode(absPath)?.deps ?? [];
  }

  /** Reverse edges: who depends on target? */
  getDependents(targetAbs: string): string[] {
    const targetId = this.moduleIdForPath(targetAbs);
    if (!targetId) return [];
    const candidates = new Set<string>();
    // Native path uses sled reverse index for O(1) lookups.
    if (this.native?.graphDependents) {
      try {
        for (const dep of this.native.graphDependents(targetId) ?? []) {
          candidates.add(dep);
        }
      } catch {
        // ignore native errors and fall back to JS map
      }
    }
    for (const [id, node] of this.nodes) {
      if (node.deps.includes(targetId)) candidates.add(id);
    }
    const out: string[] = [];
    for (const id of candidates) {
      const abs = this.pathForModuleId(id);
      if (abs) out.push(abs);
    }
    return out;
  }

  /** Collect dependents recursively (breadth-first) */
  collectDependentsDeep(targetAbs: string): string[] {
    const targetId = this.moduleIdForPath(targetAbs);
    if (!targetId) return [];
    const result = new Set<string>();
    const queue: string[] = [targetId];
    while (queue.length) {
      const current = queue.shift()!;
      const abs = this.pathForModuleId(current);
      if (!abs) continue;
      const deps = this.getDependents(abs);
      for (const depAbs of deps) {
        const depId = this.moduleIdForPath(depAbs);
        if (!depId) continue;
        if (!result.has(depId)) {
          result.add(depId);
          queue.push(depId);
        }
      }
    }
    const out: string[] = [];
    for (const id of result) {
      const abs = this.pathForModuleId(id);
      if (abs) out.push(abs);
    }
    return out;
  }

  /** Includes changed files and all dependents */
  collectAffected(changed: string[]): string[] {
    const resultIds = new Set<string>();
    const resultAbs = new Set<string>();
    const changedIds = changed.map((p) => this.moduleIdForPath(p)).filter((v): v is string => !!v);
    let usedNative = false;
    if (this.native?.graphCollectAffected) {
      try {
        const nativeList = this.native.graphCollectAffected(changedIds);
        for (const item of nativeList ?? []) {
          resultIds.add(item);
        }
        usedNative = true;
      } catch {
        // ignore native failure, fall back to JS traversal
      }
    }

    for (const targetAbs of changed) {
      resultAbs.add(targetAbs);
      const id = this.moduleIdForPath(targetAbs);
      if (id) resultIds.add(id);
    }

    if (!usedNative || resultIds.size === 0) {
      // Fallback to JS BFS to ensure correctness without native bindings.
      for (const targetAbs of changed) {
        const targetId = this.moduleIdForPath(targetAbs);
        if (targetId) resultIds.add(targetId);
        for (const depAbs of this.collectDependentsDeep(targetAbs)) {
          resultAbs.add(depAbs);
          const depId = this.moduleIdForPath(depAbs);
          if (depId) resultIds.add(depId);
        }
      }
    }

    for (const id of resultIds) {
      const abs = this.pathForModuleId(id);
      if (abs) resultAbs.add(abs);
    }
    return Array.from(resultAbs);
  }

  /** Remove file from graph and clean up dependents lists */
  removeFile(absPath: string) {
    const moduleId = this.moduleIdForPath(absPath);
    if (!moduleId) return;
    const existed = this.nodes.delete(moduleId);
    if (existed) {
      for (const node of this.nodes.values()) {
        if (node.deps.includes(moduleId)) {
          node.deps = node.deps.filter((dep) => dep !== moduleId);
        }
      }
      if (this.native) {
        try {
          this.native.graphRemove(moduleId);
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
