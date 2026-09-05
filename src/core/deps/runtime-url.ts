export const DEPS_RUNTIME_PREFIX = "/@deps/";

/**
 * Bind a browser-visible dependency route to the opaque DPL store generation.
 *
 * Dependency wrapper filenames express logical package identity, so the same
 * filename can legitimately contain different bytes when two package-manager
 * layouts produce different chunk closures. The generation query prevents two
 * dev servers reusing one localhost origin from sharing those wrapper bytes.
 */
export function formatDepsRuntimeUrl(
  fileName: string,
  depsHash: string | null | undefined,
  chunkGroup?: string | null,
): string {
  const params = new URLSearchParams();
  const generation = String(depsHash ?? "").trim();
  if (generation) params.set("v", generation);
  const group = String(chunkGroup ?? "").trim();
  if (group) params.set("cg", group);
  const query = params.toString();
  return `${DEPS_RUNTIME_PREFIX}${fileName}${query ? `?${query}` : ""}`;
}

export function depsFileNameFromRuntimeUrl(value: string): string | null {
  if (!value.startsWith(DEPS_RUNTIME_PREFIX)) return null;
  let rest = value.slice(DEPS_RUNTIME_PREFIX.length);
  const queryIndex = rest.indexOf("?");
  const hashIndex = rest.indexOf("#");
  const splitIndex =
    queryIndex === -1 ? hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
  if (splitIndex !== -1) rest = rest.slice(0, splitIndex);
  return rest.endsWith(".js") ? rest : null;
}
