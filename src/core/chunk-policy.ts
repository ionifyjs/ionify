export const DEFAULT_VENDOR_CHUNK_MAX_BYTES = 4 * 1024 * 1024;

export type ProductionChunkPolicy = {
  vendorMaxBytes: number | null;
};

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : null;
}

export function resolveProductionChunkPolicy(config: any): ProductionChunkPolicy {
  const raw = config?.build?.vendorChunkMaxBytes;
  if (raw === false || raw === null) return { vendorMaxBytes: null };
  const explicit = normalizePositiveInteger(raw);
  return { vendorMaxBytes: explicit ?? DEFAULT_VENDOR_CHUNK_MAX_BYTES };
}
