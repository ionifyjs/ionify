/**
{
  "description": "Ionify HMR core using Server-Sent Events (SSE). Manages client connections and broadcasts reload events on file changes.",
  "phase": 2,
  "todo": [
    "Create SSE channel at /__ionify_hmr",
    "Broadcast { type:'reload', file } on changes",
    "Expose injectHMRClient(html) helper to inject client script into served pages"
  ]
}
*/

import type { ServerResponse, IncomingMessage } from "http";

type WatchReason = "changed" | "dependent" | "deleted";

type SSEClient = ServerResponse;

export interface PendingHMRModule {
  absPath: string;
  url: string;
  hash: string | null;
  reason: WatchReason;
}

export interface HMRModuleSummary {
  url: string;
  hash: string | null;
  reason: WatchReason;
}

export interface HMRUpdateSummary {
  type: "update";
  id: string;
  timestamp: number;
  modules: HMRModuleSummary[];
}

interface PendingUpdate {
  summary: HMRUpdateSummary;
  modules: PendingHMRModule[];
  createdAt: number;
}

export class HMRServer {
  private clients = new Set<SSEClient>();
  private pending = new Map<string, PendingUpdate>();
  private nextId = 1;
  private closed = false;

  /** Handle an incoming SSE subscription request */
  handleSSE(req: IncomingMessage, res: ServerResponse) {
    if (this.closed) {
      res.writeHead(503);
      res.end();
      return;
    }
    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: ready\ndata: "ok"\n\n`);

    this.clients.add(res);
    // cleanup on close
    req.on("close", () => {
      this.clients.delete(res);
      try { res.end(); } catch {}
    });
  }

  private send(event: string | null, payload: unknown) {
    const data =
      (event ? `event: ${event}\n` : "") +
      `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      try { client.write(data); } catch { /* drop dead client */ }
    }
  }

  /** Broadcast a JSON event to all SSE clients */
  broadcast(payload: unknown) {
    this.send(null, payload);
  }

  broadcastEvent(event: string, payload: unknown) {
    this.send(event, payload);
  }

  queueUpdate(modules: PendingHMRModule[]): HMRUpdateSummary | null {
    if (!modules.length) return null;
    const timestamp = Date.now();
    const id = `${timestamp}-${this.nextId++}`;
    const summary: HMRUpdateSummary = {
      type: "update",
      id,
      timestamp,
      modules: modules.map(({ url, hash, reason }) => ({ url, hash, reason })),
    };
    this.pending.set(id, { summary, modules, createdAt: timestamp });
    this.broadcastEvent("update", summary);
    return summary;
  }

  consumeUpdate(id: string): PendingUpdate | undefined {
    const pending = this.pending.get(id);
    if (pending) {
      this.pending.delete(id);
    }
    return pending;
  }

  broadcastError(payload: { id?: string; message: string }) {
    this.broadcastEvent("error", { type: "error", ...payload });
  }

  close() {
    this.closed = true;
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.pending.clear();
  }
}

/** Injects the HMR client script into an HTML page (before </body>) */
export function injectHMRClient(html: string): string {
  const tag =
    `<script type="module" src="/__ionify_hmr_client.js"></script>`;
  return html.includes("</body>")
    ? html.replace("</body>", `${tag}\n</body>`)
    : html + "\n" + tag;
}
