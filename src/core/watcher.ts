import fs from "fs";
import path from "path";
import { EventEmitter } from "events";

export type WatchEvent = "added" | "changed" | "deleted";

export class IonifyWatcher extends EventEmitter {
  private watchers = new Map<string, fs.FSWatcher>();
  private debounce = new Map<string, number>();
  private polled = new Set<string>();

  constructor(private rootDir: string) {
    super();
  }

  watchFile(filePath: string) {
    // Normalize to absolute path so map lookups are consistent.
    const abs = path.resolve(filePath);
    if (this.watchers.has(abs)) return;
    if (/(node_modules|\.git|\.ionify|dist)/.test(abs)) return;
    if (!fs.existsSync(abs)) return;

    try {
      const dir = path.dirname(abs);
      // fs.watch gives fast change signals; we debounce because editors often emit bursts.
      const watcher = fs.watch(dir, (event, filename) => {
        if (!filename) return;
        const full = path.join(dir, filename.toString());
        if (full !== abs) return;

        const now = Date.now();
        const last = this.debounce.get(abs) || 0;
        if (now - last < 100) return; // debounce duplicates
        this.debounce.set(abs, now);

        const exists = fs.existsSync(abs);
        this.emit("change", abs, exists ? "changed" : "deleted");
      });

      this.watchers.set(abs, watcher);
      this.polled.add(abs);

      // Lightweight polling fallback keeps the file in sync on platforms where fs.watch drops events.
      fs.watchFile(abs, { interval: 5000 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) {
          this.emit("change", abs, "changed");
        }
      });
    } catch {
      // fallback polling only
      this.polled.add(abs);
      fs.watchFile(abs, { interval: 8000 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) {
          this.emit("change", abs, "changed");
        }
      });
    }
  }

  unwatchFile(filePath: string) {
    const abs = path.resolve(filePath);
    const watcher = this.watchers.get(abs);
    if (watcher) watcher.close();
    fs.unwatchFile(abs);
    this.watchers.delete(abs);
    this.polled.delete(abs);
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
  }
}

