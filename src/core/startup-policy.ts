import fs from "fs";

import type { RouteHintAssetSummary, RouteHintKind, RouteHintPreloadSelection, RouteHintRouteAssetEntry } from "@core/route-hints";

export type StartupPolicyClass = "entry-critical" | "shared-later" | "route-lazy" | "background";

export type StartupObservationAssetKind = "dep" | "source";

export type StartupObservationRouteAsset = {
  count: number;
  kind: StartupObservationAssetKind;
};

export type StartupObservationRouteState = {
  documents: number;
  preFcpLoaded: Record<string, StartupObservationRouteAsset>;
  preFcpEvaluated: Record<string, StartupObservationRouteAsset>;
  updatedAt: string;
};

export type StartupObservationStateDisk = {
  version: 1;
  updatedAt: string;
  routes: Record<string, StartupObservationRouteState>;
};

export type StartupPolicyAsset = {
  url: string;
  kind: RouteHintKind;
  classification: StartupPolicyClass;
  sizeBytes: number | null;
  requestCount: number;
  totalRequestCount: number;
  minDepth: number;
  routeCount: number;
  routeRequestCount: number;
  observedPreFcpLoadedCount: number;
  observedPreFcpEvaluatedCount: number;
  eagerReason:
    | "pre-fcp-evaluated"
    | "pre-fcp-loaded"
    | "entry-shell-fallback"
    | "shared-route-history"
    | "route-local-history"
    | "background-history";
};

export type StartupPolicyRouteSummary = {
  routeKey: string;
  policyHash: string;
  generatedAt: string;
  assets: StartupPolicyAsset[];
  eagerAssets: StartupPolicyAsset[];
  stats: {
    entryCritical: number;
    sharedLater: number;
    routeLazy: number;
    background: number;
    preFcpLoadedModules: number;
    preFcpEvaluatedModules: number;
    preFcpLoadedDepModules: number;
    preFcpLoadedSourceModules: number;
    preFcpEvaluatedDepModules: number;
    preFcpEvaluatedSourceModules: number;
  };
};

export type StartupPolicySnapshot = {
  version: 1;
  updatedAt: string;
  policyHash: string;
  routes: Record<string, StartupPolicyRouteSummary>;
};

export type StartupPolicyEagerBudget = {
  minRouteDocuments?: number;
  maxEagerDepAssets?: number;
  maxEagerSourceAssets?: number;
  maxEagerTotalAssets?: number;
  maxEagerDepBytes?: number;
  maxEagerSourceBytes?: number;
  maxEagerTotalBytes?: number;
};

const STARTUP_OBSERVATION_VERSION = 1;
const STARTUP_POLICY_VERSION = 1;
const MAX_EAGER_DEP_ASSETS = 10;
const MAX_EAGER_SOURCE_ASSETS = 16;

const DEFAULT_EAGER_BUDGET: Required<StartupPolicyEagerBudget> = {
  minRouteDocuments: 1,
  maxEagerDepAssets: MAX_EAGER_DEP_ASSETS,
  maxEagerSourceAssets: MAX_EAGER_SOURCE_ASSETS,
  maxEagerTotalAssets: MAX_EAGER_DEP_ASSETS + MAX_EAGER_SOURCE_ASSETS,
  maxEagerDepBytes: Number.POSITIVE_INFINITY,
  maxEagerSourceBytes: Number.POSITIVE_INFINITY,
  maxEagerTotalBytes: Number.POSITIVE_INFINITY,
};

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
    // Best-effort metadata only.
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort((a, b) => a[0].localeCompare(b[0]));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function countObservationAssets(
  assets: Record<string, StartupObservationRouteAsset>,
  kind: StartupObservationAssetKind,
): number {
  return Object.values(assets).reduce((sum, asset) => sum + (asset.kind === kind ? asset.count : 0), 0);
}

function finitePositiveOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function resolveEagerBudget(budget: StartupPolicyEagerBudget | null | undefined): Required<StartupPolicyEagerBudget> {
  return {
    minRouteDocuments: finitePositiveOrDefault(budget?.minRouteDocuments, DEFAULT_EAGER_BUDGET.minRouteDocuments),
    maxEagerDepAssets: finitePositiveOrDefault(budget?.maxEagerDepAssets, DEFAULT_EAGER_BUDGET.maxEagerDepAssets),
    maxEagerSourceAssets: finitePositiveOrDefault(
      budget?.maxEagerSourceAssets,
      DEFAULT_EAGER_BUDGET.maxEagerSourceAssets,
    ),
    maxEagerTotalAssets: finitePositiveOrDefault(
      budget?.maxEagerTotalAssets,
      DEFAULT_EAGER_BUDGET.maxEagerTotalAssets,
    ),
    maxEagerDepBytes: finitePositiveOrDefault(budget?.maxEagerDepBytes, DEFAULT_EAGER_BUDGET.maxEagerDepBytes),
    maxEagerSourceBytes: finitePositiveOrDefault(
      budget?.maxEagerSourceBytes,
      DEFAULT_EAGER_BUDGET.maxEagerSourceBytes,
    ),
    maxEagerTotalBytes: finitePositiveOrDefault(
      budget?.maxEagerTotalBytes,
      DEFAULT_EAGER_BUDGET.maxEagerTotalBytes,
    ),
  };
}

function sumAssetBytes(assets: readonly StartupPolicyAsset[]): number {
  return assets.reduce((sum, asset) => sum + Math.max(0, asset.sizeBytes ?? 0), 0);
}

function selectBudgetedEagerAssets(
  assets: readonly StartupPolicyAsset[],
  routeDocuments: number,
  rawBudget: StartupPolicyEagerBudget | null | undefined,
): StartupPolicyAsset[] {
  const budget = resolveEagerBudget(rawBudget);
  if (routeDocuments < budget.minRouteDocuments) return [];

  const eagerCandidates = assets.filter((asset) => asset.classification === "entry-critical");
  const eagerDepAssets = eagerCandidates.filter((asset) => asset.kind === "dep");
  const eagerSourceAssets = eagerCandidates.filter((asset) => asset.kind === "source");
  const depBytes = sumAssetBytes(eagerDepAssets);
  const sourceBytes = sumAssetBytes(eagerSourceAssets);
  const totalBytes = depBytes + sourceBytes;

  const closureFits =
    eagerCandidates.length <= budget.maxEagerTotalAssets &&
    eagerDepAssets.length <= budget.maxEagerDepAssets &&
    eagerSourceAssets.length <= budget.maxEagerSourceAssets &&
    depBytes <= budget.maxEagerDepBytes &&
    sourceBytes <= budget.maxEagerSourceBytes &&
    totalBytes <= budget.maxEagerTotalBytes;

  if (!closureFits) return [];

  return eagerCandidates.slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dep" ? -1 : 1;
    const evalDelta = b.observedPreFcpEvaluatedCount - a.observedPreFcpEvaluatedCount;
    if (evalDelta !== 0) return evalDelta;
    const loadDelta = b.observedPreFcpLoadedCount - a.observedPreFcpLoadedCount;
    if (loadDelta !== 0) return loadDelta;
    const sizeDelta = Math.max(0, a.sizeBytes ?? 0) - Math.max(0, b.sizeBytes ?? 0);
    if (sizeDelta !== 0) return sizeDelta;
    return a.url.localeCompare(b.url);
  });
}

export class StartupObservationIndex {
  private readonly statePath: string;
  private readonly routes = new Map<string, StartupObservationRouteState>();

  constructor(statePath: string) {
    this.statePath = statePath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const raw = readJsonFile<StartupObservationStateDisk>(this.statePath);
    if (!raw || raw.version !== STARTUP_OBSERVATION_VERSION || typeof raw.routes !== "object" || !raw.routes) return;
    for (const [routeKey, state] of Object.entries(raw.routes)) {
      if (!routeKey || !state || typeof state !== "object") continue;
      this.routes.set(routeKey, {
        documents: Math.max(0, Math.floor(state.documents ?? 0)),
        preFcpLoaded: { ...(state.preFcpLoaded ?? {}) },
        preFcpEvaluated: { ...(state.preFcpEvaluated ?? {}) },
        updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date(0).toISOString(),
      });
    }
  }

  private getOrCreateRoute(routeKey: string): StartupObservationRouteState {
    const existing = this.routes.get(routeKey);
    if (existing) return existing;
    const created: StartupObservationRouteState = {
      documents: 0,
      preFcpLoaded: {},
      preFcpEvaluated: {},
      updatedAt: new Date().toISOString(),
    };
    this.routes.set(routeKey, created);
    return created;
  }

  recordRouteObservation(options: {
    routeKey: string;
    preFcpLoadedUrls?: readonly string[] | null;
    preFcpEvaluatedUrls?: readonly string[] | null;
  }): void {
    const routeKey = String(options.routeKey || "/").trim() || "/";
    const route = this.getOrCreateRoute(routeKey);
    route.documents += 1;
    route.updatedAt = new Date().toISOString();

    const apply = (
      target: Record<string, StartupObservationRouteAsset>,
      urls: readonly string[] | null | undefined,
    ) => {
      for (const url of urls ?? []) {
        if (typeof url !== "string" || !url.startsWith("/")) continue;
        const kind: StartupObservationAssetKind = url.startsWith("/@deps/") ? "dep" : "source";
        const existing = target[url];
        if (existing) {
          existing.count += 1;
        } else {
          target[url] = { count: 1, kind };
        }
      }
    };

    apply(route.preFcpLoaded, options.preFcpLoadedUrls);
    apply(route.preFcpEvaluated, options.preFcpEvaluatedUrls);
    this.flush();
  }

  getRoute(routeKey: string): StartupObservationRouteState | null {
    return this.routes.get(routeKey) ?? null;
  }

  flush(): void {
    const routes: Record<string, StartupObservationRouteState> = {};
    for (const routeKey of Array.from(this.routes.keys()).sort()) {
      const route = this.routes.get(routeKey)!;
      routes[routeKey] = {
        documents: route.documents,
        preFcpLoaded: Object.fromEntries(Object.entries(route.preFcpLoaded).sort((a, b) => a[0].localeCompare(b[0]))),
        preFcpEvaluated: Object.fromEntries(
          Object.entries(route.preFcpEvaluated).sort((a, b) => a[0].localeCompare(b[0])),
        ),
        updatedAt: route.updatedAt,
      };
    }
    writeJsonFile(this.statePath, {
      version: STARTUP_OBSERVATION_VERSION,
      updatedAt: new Date().toISOString(),
      routes,
    } satisfies StartupObservationStateDisk);
  }
}

export function buildStartupPolicySnapshot(options: {
  routeKeys: readonly string[];
  routeAssetsForRoute: (routeKey: string) => RouteHintRouteAssetEntry[];
  assetSummaries: readonly RouteHintAssetSummary[];
  observations: StartupObservationIndex;
  assetSizeBytes?: (url: string, kind: RouteHintKind) => number | null | undefined;
  isAssetValid?: (url: string, kind: RouteHintKind) => boolean;
  eagerBudget?: StartupPolicyEagerBudget | null;
}): StartupPolicySnapshot {
  const assetSummaryByUrl = new Map(options.assetSummaries.map((summary) => [summary.url, summary] as const));
  const routes: Record<string, StartupPolicyRouteSummary> = {};
  const normalizedRouteKeys = Array.from(new Set(options.routeKeys.filter(Boolean))).sort();

  for (const routeKey of normalizedRouteKeys) {
    const routeAssets = options
      .routeAssetsForRoute(routeKey)
      .filter((asset) => options.isAssetValid?.(asset.url, asset.kind) ?? true);
    const validRouteAssetUrls = new Set(routeAssets.map((asset) => asset.url));
    const observation = options.observations.getRoute(routeKey);
    const filterObservedAssets = (
      assets: Record<string, StartupObservationRouteAsset> | undefined,
    ): Record<string, StartupObservationRouteAsset> => {
      const filtered: Record<string, StartupObservationRouteAsset> = {};
      for (const [assetUrl, asset] of Object.entries(assets ?? {})) {
        if (!validRouteAssetUrls.has(assetUrl)) continue;
        if (!(options.isAssetValid?.(assetUrl, asset.kind) ?? true)) continue;
        filtered[assetUrl] = asset;
      }
      return filtered;
    };
    const preFcpLoaded = filterObservedAssets(observation?.preFcpLoaded);
    const preFcpEvaluated = filterObservedAssets(observation?.preFcpEvaluated);

    const assets = routeAssets
      .map((asset) => {
        const summary = assetSummaryByUrl.get(asset.url);
        const totalRequestCount = summary?.totalRequestCount ?? asset.requestCount;
        const routeCount = summary?.routeKeys.length ?? 1;
        const routeRequestCount = summary?.routeRequestCounts?.[routeKey] ?? asset.requestCount;
        const observedPreFcpLoadedCount = preFcpLoaded[asset.url]?.count ?? 0;
        const observedPreFcpEvaluatedCount = preFcpEvaluated[asset.url]?.count ?? 0;
        const rawSizeBytes = options.assetSizeBytes?.(asset.url, asset.kind);
        const sizeBytes =
          typeof rawSizeBytes === "number" && Number.isFinite(rawSizeBytes) && rawSizeBytes >= 0
            ? Math.floor(rawSizeBytes)
            : null;

        let classification: StartupPolicyClass;
        let eagerReason: StartupPolicyAsset["eagerReason"];
        if (observedPreFcpEvaluatedCount > 0) {
          classification = "entry-critical";
          eagerReason = "pre-fcp-evaluated";
        } else if (observedPreFcpLoadedCount > 0) {
          classification = "entry-critical";
          eagerReason = "pre-fcp-loaded";
        } else if (asset.kind === "source" && asset.minDepth <= 1) {
          classification = "entry-critical";
          eagerReason = "entry-shell-fallback";
        } else if (asset.kind === "dep" && routeCount > 1) {
          classification = "shared-later";
          eagerReason = "shared-route-history";
        } else if (asset.requestCount > 0) {
          classification = "route-lazy";
          eagerReason = "route-local-history";
        } else {
          classification = "background";
          eagerReason = "background-history";
        }

        return {
          url: asset.url,
          kind: asset.kind,
          classification,
          sizeBytes,
          requestCount: asset.requestCount,
          totalRequestCount,
          minDepth: asset.minDepth,
          routeCount,
          routeRequestCount,
          observedPreFcpLoadedCount,
          observedPreFcpEvaluatedCount,
          eagerReason,
        } satisfies StartupPolicyAsset;
      })
      .sort((a, b) => {
        const classOrder = (value: StartupPolicyClass): number =>
          value === "entry-critical" ? 0 : value === "shared-later" ? 1 : value === "route-lazy" ? 2 : 3;
        const classDelta = classOrder(a.classification) - classOrder(b.classification);
        if (classDelta !== 0) return classDelta;
        const evalDelta = b.observedPreFcpEvaluatedCount - a.observedPreFcpEvaluatedCount;
        if (evalDelta !== 0) return evalDelta;
        const loadDelta = b.observedPreFcpLoadedCount - a.observedPreFcpLoadedCount;
        if (loadDelta !== 0) return loadDelta;
        const requestDelta = b.routeRequestCount - a.routeRequestCount;
        if (requestDelta !== 0) return requestDelta;
        const depthDelta = a.minDepth - b.minDepth;
        if (depthDelta !== 0) return depthDelta;
        return a.url.localeCompare(b.url);
      });

    const eagerAssets = selectBudgetedEagerAssets(assets, observation?.documents ?? 0, options.eagerBudget);

    const routePayload = {
      routeKey,
      assets: assets.map((asset) => ({
        url: asset.url,
        classification: asset.classification,
        kind: asset.kind,
        requestCount: asset.requestCount,
        totalRequestCount: asset.totalRequestCount,
        minDepth: asset.minDepth,
        routeCount: asset.routeCount,
        routeRequestCount: asset.routeRequestCount,
        sizeBytes: asset.sizeBytes,
        observedPreFcpLoadedCount: asset.observedPreFcpLoadedCount,
        observedPreFcpEvaluatedCount: asset.observedPreFcpEvaluatedCount,
        eagerReason: asset.eagerReason,
      })),
    };
    const policyHash = stableStringify(routePayload);

    routes[routeKey] = {
      routeKey,
      policyHash,
      generatedAt: new Date().toISOString(),
      assets,
      eagerAssets,
      stats: {
        entryCritical: assets.filter((asset) => asset.classification === "entry-critical").length,
        sharedLater: assets.filter((asset) => asset.classification === "shared-later").length,
        routeLazy: assets.filter((asset) => asset.classification === "route-lazy").length,
        background: assets.filter((asset) => asset.classification === "background").length,
        preFcpLoadedModules: Object.keys(preFcpLoaded).length,
        preFcpEvaluatedModules: Object.keys(preFcpEvaluated).length,
        preFcpLoadedDepModules: countObservationAssets(preFcpLoaded, "dep"),
        preFcpLoadedSourceModules: countObservationAssets(preFcpLoaded, "source"),
        preFcpEvaluatedDepModules: countObservationAssets(preFcpEvaluated, "dep"),
        preFcpEvaluatedSourceModules: countObservationAssets(preFcpEvaluated, "source"),
      },
    };
  }

  const policyPayload = {
    routes: Object.fromEntries(
      Object.entries(routes).map(([routeKey, route]) => [
        routeKey,
        {
          policyHash: route.policyHash,
          eagerAssets: route.eagerAssets.map((asset) => `${asset.kind}:${asset.url}:${asset.classification}:${asset.eagerReason}`),
          stats: route.stats,
        },
      ]),
    ),
  };

  return {
    version: STARTUP_POLICY_VERSION,
    updatedAt: new Date().toISOString(),
    policyHash: stableStringify(policyPayload),
    routes,
  };
}

export function loadStartupPolicySnapshot(filePath: string): StartupPolicySnapshot | null {
  const raw = readJsonFile<StartupPolicySnapshot>(filePath);
  if (!raw || raw.version !== STARTUP_POLICY_VERSION || typeof raw.routes !== "object" || !raw.routes) return null;
  return raw;
}

export function persistStartupPolicySnapshot(filePath: string, snapshot: StartupPolicySnapshot): void {
  writeJsonFile(filePath, snapshot);
}

export function selectStartupPolicyPreloads(
  snapshot: StartupPolicySnapshot | null | undefined,
  routeKey: string,
): RouteHintPreloadSelection[] {
  const route = snapshot?.routes?.[routeKey] ?? null;
  if (!route) return [];
  return route.eagerAssets.map((asset) => ({
    url: asset.url,
    kind: asset.kind,
    routeRequestCount: asset.routeRequestCount,
    totalRequestCount: asset.totalRequestCount,
    minDepth: asset.minDepth,
  }));
}
