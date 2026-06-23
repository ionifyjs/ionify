/**
{
  "description": "Ionify native file watcher (optimized). Watches files known to Graph using hybrid fs.watch + fs.watchFile. Debounced and minimal CPU usage.",
  "phase": 1.5,
  "todo": [
    "Emit unified change events with type (added/changed/deleted).",
    "Integrate with Graph invalidation to trigger incremental rebuild."
  ]
}
*/

import fs from "fs";
import path from "path";
import { EventEmitter } from "events";

export type WatchEvent = "added" | "changed" | "deleted";

export class IonifyWatcher extends EventEmitter {
  private watchers = new Map<string, fs.FSWatcher>();
  private debounce = new Map<string, number>();
  private lastEmitted = new Map<string, string>();
  private polled = new Set<string>();

  constructor(private rootDir: string) {
    super();
  }

  isWatched(filePath: string) {
    const abs = path.resolve(filePath);
    return this.watchers.has(abs) || this.polled.has(abs);
  }

  watchFile(filePath: string) {
    // Normalize to absolute path so map lookups are consistent.
    const abs = path.resolve(filePath);
    if (this.isWatched(abs)) return;
    if (/(node_modules|\.git|\.ionify|dist)/.test(abs)) return;
    if (!fs.existsSync(abs)) return;

    try {
      const dir = path.dirname(abs);
      // fs.watch gives fast change signals; we debounce because editors often emit bursts.
      const watcher = fs.watch(dir, (event, filename) => {
        if (!filename) return;
        const full = path.join(dir, filename.toString());
        if (full !== abs) return;

        const exists = fs.existsSync(abs);
        const stat = exists ? fs.statSync(abs) : null;
        this.emitChange(abs, exists ? "changed" : "deleted", stat);
      });

      this.watchers.set(abs, watcher);
      this.polled.add(abs);

      // Lightweight polling fallback keeps the file in sync on platforms where fs.watch drops events.
      fs.watchFile(abs, { interval: 5000 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) {
          this.emitChange(abs, "changed", curr);
        }
      });
    } catch {
      // fallback polling only
      this.polled.add(abs);
      fs.watchFile(abs, { interval: 8000 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) {
          this.emitChange(abs, "changed", curr);
        }
      });
    }
  }

  private emitChange(abs: string, status: WatchEvent, stat: fs.Stats | null) {
    const now = Date.now();
    const last = this.debounce.get(abs) || 0;
    if (now - last < 100) return;

    const fingerprint =
      status === "deleted"
        ? "deleted"
        : stat
          ? `${status}:${stat.mtimeMs}:${stat.size}`
          : `${status}:unknown`;
    if (this.lastEmitted.get(abs) === fingerprint) return;

    this.debounce.set(abs, now);
    this.lastEmitted.set(abs, fingerprint);
    this.emit("change", abs, status);
  }

  unwatchFile(filePath: string) {
    const abs = path.resolve(filePath);
    const watcher = this.watchers.get(abs);
    if (watcher) watcher.close();
    fs.unwatchFile(abs);
    this.watchers.delete(abs);
    this.polled.delete(abs);
    this.debounce.delete(abs);
    this.lastEmitted.delete(abs);
  }

  closeAll() {
    for (const [abs, w] of this.watchers) {
      w.close();
      fs.unwatchFile(abs);
    }
    this.watchers.clear();
    for (const abs of this.polled) {
      fs.unwatchFile(abs);
    }
    this.polled.clear();
    this.debounce.clear();
    this.lastEmitted.clear();
  }
}

// ===== Next Phase TODOs =====
// Phase 2: recursive dependency invalidation + batch change queues.
// Phase 3: HMR bridge + graph visualization integration.
