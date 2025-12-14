import { Worker } from "worker_threads";
import os from "os";
import { fileURLToPath } from "url";
import { logWarn } from "@cli/utils/logger";

const workerPath = fileURLToPath(new URL("./worker.cjs", import.meta.url));

export interface TransformJob {
  id: string;
  code: string;
  filePath: string;
  ext: string;
}

export interface TransformJobResult {
  id: string;
  filePath: string;
  code: string;
  map?: string;
  type: "js" | "css" | "asset";
  error?: string;
}

type WorkerMessage = TransformJobResult;

interface QueueItem {
  job: TransformJob;
  size: number;
}

interface PoolOptions {
  size?: number;
  maxQueueBytes?: number;
}

export class TransformWorkerPool {
  private workers: Worker[] = [];
  private queue: QueueItem[] = [];
  private active = new Map<number, QueueItem>();
  private callbacks = new Map<string, (result: TransformJobResult) => void>();
  private waiters: Array<() => void> = [];
  private pendingBytes = 0;
  private closed = false;
  private size: number;
  private maxQueueBytes?: number;

  constructor(options: PoolOptions = {}) {
    const cpuDefault = Math.max(1, os.cpus().length - 1);
    this.size = Math.max(1, options.size ?? cpuDefault);
    this.maxQueueBytes = options.maxQueueBytes;
    for (let i = 0; i < this.size; i++) {
      this.spawnWorker();
    }
  }

  private spawnWorker() {
    const worker = new Worker(workerPath, { env: process.env });
    const id = worker.threadId;

    worker.on("message", (message: WorkerMessage) => {
      const item = this.active.get(id);
      if (item) {
        this.active.delete(id);
        this.pendingBytes -= item.size;
        this.resolveWaiters();
      }
      const cb = message ? this.callbacks.get(message.id) : undefined;
      if (message && cb) cb(message);
      if (message) this.callbacks.delete(message.id);
      this.dequeue(worker);
    });

    worker.on("error", (err) => {
      logWarn(`Transform worker error: ${String(err)}`);
      const item = this.active.get(id);
      if (item) {
        this.active.delete(id);
        this.queue.unshift(item);
      }
      this.spawnWorker();
    });

    worker.on("exit", (code) => {
      const item = this.active.get(id);
      if (item) {
        this.active.delete(id);
        this.queue.unshift(item);
      }
      if (!this.closed && code !== 0) {
        logWarn(`Transform worker exited unexpectedly (${code}), respawning`);
        this.spawnWorker();
      }
    });

    this.workers.push(worker);
  }

  private dequeue(worker: Worker) {
    if (this.queue.length === 0) return;
    const item = this.queue.shift()!;
    this.active.set(worker.threadId, item);
    worker.postMessage(item.job);
  }

  private resolveWaiters() {
    if (!this.maxQueueBytes) return;
    while (this.waiters.length && this.pendingBytes < this.maxQueueBytes) {
      const resolve = this.waiters.shift();
      resolve && resolve();
    }
  }

  async run(job: TransformJob): Promise<TransformJobResult> {
    if (this.closed) {
      throw new Error("Worker pool already closed");
    }
    const size = Buffer.byteLength(job.code, "utf8");
    if (this.maxQueueBytes) {
      while (this.pendingBytes + size > this.maxQueueBytes) {
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
      }
    }
    this.pendingBytes += size;

    return new Promise((resolve) => {
      this.callbacks.set(job.id, resolve);
      const idleWorker = this.workers.find((w) => !this.active.has(w.threadId));
      const item: QueueItem = { job, size };
      if (idleWorker) {
        this.active.set(idleWorker.threadId, item);
        idleWorker.postMessage(job);
      } else {
        this.queue.push(item);
      }
    });
  }

  async runMany(jobs: TransformJob[]): Promise<TransformJobResult[]> {
    const resultMap = new Map<string, TransformJobResult>();
    await Promise.all(
      jobs.map(async (job) => {
        const res = await this.run(job);
        resultMap.set(job.id, res);
      })
    );
    return jobs.map((job) => resultMap.get(job.id)!);
  }

  async close() {
    this.closed = true;
    await Promise.all(this.workers.map((worker) => worker.terminate()));
    this.workers = [];
    this.queue = [];
    this.active.clear();
    this.callbacks.clear();
    this.waiters.forEach((resolve) => resolve());
    this.waiters = [];
    this.pendingBytes = 0;
  }

  async drain() {
    while (!this.closed && (this.queue.length || this.active.size)) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
