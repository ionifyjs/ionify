import fs from "fs";

export type RouteHintKind = "dep" | "source";

type RouteHintAssetDisk = {
  kind: RouteHintKind;
  requestCount: number;
  minDepth: number;
  lastSeenAt: string;
};

type RouteHintRouteDisk = {
  documents: number;
  updatedAt: string;
  assets: Record<string, RouteHintAssetDisk>;
};

type RouteHintStateDisk = {
  version: 1;
  updatedAt: string;
  routes: Record<string, RouteHintRouteDisk>;
};

type RouteHintAssetState = {
  kind: RouteHintKind;
  requestCount: number;
  minDepth: number;
  lastSeenAtMs: number;
};

type RouteHintRouteState = {
  documents: number;
  updatedAtMs: number;
  assets: Map<string, RouteHintAssetState>;
};

type RequestRouteContext = {
  routeKey: string;
  depth: number;
  observedAtMs: number;
};

export type RouteHintAssetSummary = {
  url: string;
  kind: RouteHintKind;
  totalRequestCount: number;
  minDepth: number;
  routeKeys: string[];
  routeRequestCounts: Record<string, number>;
};

export type RouteHintPreloadSelection = {
  url: string;
  kind: RouteHintKind;
  routeRequestCount: number;
  totalRequestCount: number;
  minDepth: number;
};

const ROUTE_HINT_STATE_VERSION = 1;
const CLIENT_CONTEXT_TTL_MS = 30_000;
const MAX_TRACKED_ROUTES = 64;
const MAX_TRACKED_ASSETS_PER_ROUTE = 256;

function toIsoString(value: number): string {
  const safe = Number.isFinite(value) ? value : Date.now();
  return new Date(safe).toISOString();
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeHintUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed, "http://ionify.local");
    if (!parsed.pathname.startsWith("/")) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function normalizeDocumentRouteKey(value: string): string {
  const normalized = normalizeHintUrl(value) ?? "/";
  const queryIndex = normalized.indexOf("?");
  let pathname = queryIndex === -1 ? normalized : normalized.slice(0, queryIndex);
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/index\.html$/i, "/");
  if (pathname.endsWith(".html") && pathname.length > ".html".length) {
    pathname = pathname.slice(0, -".html".length);
  }
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  return pathname || "/";
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
    // Route hints are best-effort metadata.
  }
}

export class RouteHintIndex {
  private readonly statePath: string;
  private readonly routes = new Map<string, RouteHintRouteState>();
  private readonly requestRouteContext = new Map<string, RequestRouteContext>();
  private readonly clientRouteContext = new Map<string, { routeKey: string; observedAtMs: number }>();
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(statePath: string) {
    this.statePath = statePath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const raw = readJsonFile<RouteHintStateDisk>(this.statePath);
    if (!raw || raw.version !== ROUTE_HINT_STATE_VERSION || typeof raw.routes !== "object" || !raw.routes) {
      return;
    }

    for (const [routeKeyRaw, routeRaw] of Object.entries(raw.routes)) {
      const routeKey = normalizeDocumentRouteKey(routeKeyRaw);
      const documents =
        typeof routeRaw?.documents === "number" && Number.isFinite(routeRaw.documents) && routeRaw.documents > 0
          ? Math.floor(routeRaw.documents)
          : 0;
      const updatedAtMs = parseTimestamp(routeRaw?.updatedAt);
      const assets = new Map<string, RouteHintAssetState>();
      const rawAssets = routeRaw?.assets && typeof routeRaw.assets === "object" ? routeRaw.assets : {};
      for (const [url, assetRaw] of Object.entries(rawAssets)) {
        const normalizedUrl = normalizeHintUrl(url);
        if (!normalizedUrl) continue;
        if (assetRaw?.kind !== "dep" && assetRaw?.kind !== "source") continue;
        const requestCount =
          typeof assetRaw?.requestCount === "number" && Number.isFinite(assetRaw.requestCount) && assetRaw.requestCount > 0
            ? Math.floor(assetRaw.requestCount)
            : 0;
        if (requestCount <= 0) continue;
        const minDepth =
          typeof assetRaw?.minDepth === "number" && Number.isFinite(assetRaw.minDepth) && assetRaw.minDepth >= 0
            ? Math.floor(assetRaw.minDepth)
            : 0;
        assets.set(normalizedUrl, {
          kind: assetRaw.kind,
          requestCount,
          minDepth,
          lastSeenAtMs: parseTimestamp(assetRaw.lastSeenAt),
        });
      }
      if (documents <= 0 && assets.size === 0) continue;
      this.routes.set(routeKey, {
        documents,
        updatedAtMs,
        assets,
      });
    }
    this.prunePersistedState();
  }

  private queueSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }

  private pruneEphemeralContexts(nowMs: number): void {
    for (const [key, value] of this.requestRouteContext) {
      if (nowMs - value.observedAtMs > CLIENT_CONTEXT_TTL_MS) {
        this.requestRouteContext.delete(key);
      }
    }
    for (const [key, value] of this.clientRouteContext) {
      if (nowMs - value.observedAtMs > CLIENT_CONTEXT_TTL_MS) {
        this.clientRouteContext.delete(key);
      }
    }
  }

  private prunePersistedState(): void {
    const sortedRoutes = Array.from(this.routes.entries()).sort((a, b) => {
      const updatedDelta = b[1].updatedAtMs - a[1].updatedAtMs;
      if (updatedDelta !== 0) return updatedDelta;
      return a[0].localeCompare(b[0]);
    });

    for (const [, route] of sortedRoutes) {
      const sortedAssets = Array.from(route.assets.entries()).sort((a, b) => {
        const depthDelta = a[1].minDepth - b[1].minDepth;
        if (depthDelta !== 0) return depthDelta;
        const requestDelta = b[1].requestCount - a[1].requestCount;
        if (requestDelta !== 0) return requestDelta;
        return a[0].localeCompare(b[0]);
      });
      for (const [url] of sortedAssets.slice(MAX_TRACKED_ASSETS_PER_ROUTE)) {
        route.assets.delete(url);
      }
    }

    for (const [routeKey] of sortedRoutes.slice(MAX_TRACKED_ROUTES)) {
      this.routes.delete(routeKey);
    }
  }

  private getOrCreateRoute(routeKey: string, observedAtMs: number): RouteHintRouteState {
    const normalized = normalizeDocumentRouteKey(routeKey);
    const existing = this.routes.get(normalized);
    if (existing) {
      existing.updatedAtMs = Math.max(existing.updatedAtMs, observedAtMs);
      return existing;
    }
    const created: RouteHintRouteState = {
      documents: 0,
      updatedAtMs: observedAtMs,
      assets: new Map(),
    };
    this.routes.set(normalized, created);
    return created;
  }

  beginDocument(options: {
    routeKey: string;
    documentUrl: string;
    clientKey?: string | null;
    observedAtMs?: number;
  }): void {
    const observedAtMs = options.observedAtMs ?? Date.now();
    const routeKey = normalizeDocumentRouteKey(options.routeKey);
    const documentUrl = normalizeHintUrl(options.documentUrl);
    if (!documentUrl) return;

    this.pruneEphemeralContexts(observedAtMs);
    const route = this.getOrCreateRoute(routeKey, observedAtMs);
    route.documents += 1;
    route.updatedAtMs = observedAtMs;

    this.requestRouteContext.set(documentUrl, {
      routeKey,
      depth: 0,
      observedAtMs,
    });
    const clientKey = typeof options.clientKey === "string" ? options.clientKey.trim() : "";
    if (clientKey) {
      this.clientRouteContext.set(clientKey, { routeKey, observedAtMs });
    }

    this.prunePersistedState();
    this.queueSave();
  }

  private resolveRouteContext(options: {
    refererUrl?: string | null;
    clientKey?: string | null;
    observedAtMs: number;
  }): { routeKey: string; depth: number } | null {
    const refererUrl = normalizeHintUrl(options.refererUrl);
    if (refererUrl) {
      const routeContext = this.requestRouteContext.get(refererUrl);
      if (routeContext) {
        return {
          routeKey: routeContext.routeKey,
          depth: routeContext.depth + 1,
        };
      }
    }

    const clientKey = typeof options.clientKey === "string" ? options.clientKey.trim() : "";
    if (clientKey) {
      const clientContext = this.clientRouteContext.get(clientKey);
      if (clientContext && options.observedAtMs - clientContext.observedAtMs <= CLIENT_CONTEXT_TTL_MS) {
        return {
          routeKey: clientContext.routeKey,
          depth: 1,
        };
      }
    }

    return null;
  }

  noteRequest(options: {
    url: string;
    kind: RouteHintKind;
    refererUrl?: string | null;
    clientKey?: string | null;
    observedAtMs?: number;
  }): boolean {
    const observedAtMs = options.observedAtMs ?? Date.now();
    const url = normalizeHintUrl(options.url);
    if (!url) return false;

    this.pruneEphemeralContexts(observedAtMs);
    const resolved = this.resolveRouteContext({
      refererUrl: options.refererUrl,
      clientKey: options.clientKey,
      observedAtMs,
    });
    if (!resolved) return false;

    const route = this.getOrCreateRoute(resolved.routeKey, observedAtMs);
    const existing = route.assets.get(url);
    if (existing) {
      existing.requestCount += 1;
      existing.minDepth = Math.min(existing.minDepth, resolved.depth);
      existing.lastSeenAtMs = observedAtMs;
      if (existing.kind !== options.kind && existing.kind === "source") {
        existing.kind = options.kind;
      }
    } else {
      route.assets.set(url, {
        kind: options.kind,
        requestCount: 1,
        minDepth: resolved.depth,
        lastSeenAtMs: observedAtMs,
      });
    }
    route.updatedAtMs = observedAtMs;
    this.requestRouteContext.set(url, {
      routeKey: resolved.routeKey,
      depth: resolved.depth,
      observedAtMs,
    });

    this.prunePersistedState();
    this.queueSave();
    return true;
  }

  getPrimaryRouteKey(): string | null {
    const routes = Array.from(this.routes.entries()).sort((a, b) => {
      const documentDelta = b[1].documents - a[1].documents;
      if (documentDelta !== 0) return documentDelta;
      const updatedDelta = b[1].updatedAtMs - a[1].updatedAtMs;
      if (updatedDelta !== 0) return updatedDelta;
      return a[0].localeCompare(b[0]);
    });
    return routes[0]?.[0] ?? null;
  }

  summarizeAssets(kind?: RouteHintKind): RouteHintAssetSummary[] {
    const aggregated = new Map<
      string,
      {
        kind: RouteHintKind;
        totalRequestCount: number;
        minDepth: number;
        routeRequestCounts: Map<string, number>;
      }
    >();

    for (const [routeKey, route] of this.routes) {
      for (const [url, asset] of route.assets) {
        if (kind && asset.kind !== kind) continue;
        const existing = aggregated.get(url);
        if (existing) {
          existing.totalRequestCount += asset.requestCount;
          existing.minDepth = Math.min(existing.minDepth, asset.minDepth);
          existing.routeRequestCounts.set(routeKey, (existing.routeRequestCounts.get(routeKey) ?? 0) + asset.requestCount);
          continue;
        }
        aggregated.set(url, {
          kind: asset.kind,
          totalRequestCount: asset.requestCount,
          minDepth: asset.minDepth,
          routeRequestCounts: new Map([[routeKey, asset.requestCount]]),
        });
      }
    }

    return Array.from(aggregated.entries())
      .map(([url, asset]) => {
        const routeRequestCounts: Record<string, number> = {};
        const routeKeys = Array.from(asset.routeRequestCounts.keys()).sort();
        for (const routeKey of routeKeys) {
          routeRequestCounts[routeKey] = asset.routeRequestCounts.get(routeKey) ?? 0;
        }
        return {
          url,
          kind: asset.kind,
          totalRequestCount: asset.totalRequestCount,
          minDepth: asset.minDepth,
          routeKeys,
          routeRequestCounts,
        } satisfies RouteHintAssetSummary;
      })
      .sort((a, b) => {
        const requestDelta = b.totalRequestCount - a.totalRequestCount;
        if (requestDelta !== 0) return requestDelta;
        const depthDelta = a.minDepth - b.minDepth;
        if (depthDelta !== 0) return depthDelta;
        return a.url.localeCompare(b.url);
      });
  }

  selectPreloads(
    routeKey: string | null | undefined,
    options?: {
      maxEntries?: number;
      maxDepEntries?: number;
      maxSourceEntries?: number;
      minRequestCount?: number;
    },
  ): RouteHintPreloadSelection[] {
    const normalizedRouteKey = normalizeDocumentRouteKey(routeKey || this.getPrimaryRouteKey() || "/");
    const maxEntries =
      typeof options?.maxEntries === "number" && Number.isFinite(options.maxEntries) && options.maxEntries > 0
        ? Math.floor(options.maxEntries)
        : 24;
    const maxDepEntries =
      typeof options?.maxDepEntries === "number" && Number.isFinite(options.maxDepEntries) && options.maxDepEntries >= 0
        ? Math.floor(options.maxDepEntries)
        : maxEntries;
    const maxSourceEntries =
      typeof options?.maxSourceEntries === "number" &&
      Number.isFinite(options.maxSourceEntries) &&
      options.maxSourceEntries >= 0
        ? Math.floor(options.maxSourceEntries)
        : maxEntries;
    const minRequestCount =
      typeof options?.minRequestCount === "number" &&
      Number.isFinite(options.minRequestCount) &&
      options.minRequestCount > 0
        ? Math.floor(options.minRequestCount)
        : 1;

    const candidates = this.summarizeAssets()
      .map((summary) => ({
        ...summary,
        routeRequestCount: summary.routeRequestCounts[normalizedRouteKey] ?? 0,
      }))
      .filter((summary) => summary.totalRequestCount >= minRequestCount)
      .filter((summary) => {
        if (summary.routeKeys.length === 0) return true;
        if (summary.routeRequestCount > 0) return true;
        return summary.routeKeys.length === 1 && summary.routeKeys[0] === normalizedRouteKey;
      })
      .sort((a, b) => {
        const routeDelta = b.routeRequestCount - a.routeRequestCount;
        if (routeDelta !== 0) return routeDelta;
        const depthDelta = a.minDepth - b.minDepth;
        if (depthDelta !== 0) return depthDelta;
        const totalDelta = b.totalRequestCount - a.totalRequestCount;
        if (totalDelta !== 0) return totalDelta;
        if (a.kind !== b.kind) return a.kind === "dep" ? -1 : 1;
        return a.url.localeCompare(b.url);
      });

    const selected: RouteHintPreloadSelection[] = [];
    let depCount = 0;
    let sourceCount = 0;
    for (const candidate of candidates) {
      if (selected.length >= maxEntries) break;
      if (candidate.kind === "dep") {
        if (depCount >= maxDepEntries) continue;
        depCount += 1;
      } else {
        if (sourceCount >= maxSourceEntries) continue;
        sourceCount += 1;
      }
      selected.push({
        url: candidate.url,
        kind: candidate.kind,
        routeRequestCount: candidate.routeRequestCount,
        totalRequestCount: candidate.totalRequestCount,
        minDepth: candidate.minDepth,
      });
    }

    return selected;
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;

    const routeEntries = Array.from(this.routes.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const routes: Record<string, RouteHintRouteDisk> = {};
    for (const [routeKey, route] of routeEntries) {
      const assetEntries = Array.from(route.assets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const assets: Record<string, RouteHintAssetDisk> = {};
      for (const [url, asset] of assetEntries) {
        assets[url] = {
          kind: asset.kind,
          requestCount: asset.requestCount,
          minDepth: asset.minDepth,
          lastSeenAt: toIsoString(asset.lastSeenAtMs),
        };
      }
      routes[routeKey] = {
        documents: route.documents,
        updatedAt: toIsoString(route.updatedAtMs),
        assets,
      };
    }

    writeJsonFile(this.statePath, {
      version: ROUTE_HINT_STATE_VERSION,
      updatedAt: new Date().toISOString(),
      routes,
    } satisfies RouteHintStateDisk);
    this.dirty = false;
  }
}
