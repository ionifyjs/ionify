import crypto from "crypto";

// Deterministic chunk-group id used for shared chunks + feature/vendor packs.
// Must depend only on stable dep ids (not request order, timestamps, or env).
export function computeChunkGroupIdFromStableIds(stableIds: string[]): string {
  const ids = stableIds
    .map((v) => String(v))
    .filter(Boolean)
    .slice()
    .sort();

  const unique: string[] = [];
  for (const id of ids) {
    if (unique.length === 0 || unique[unique.length - 1] !== id) unique.push(id);
  }

  const hash = crypto.createHash("sha256");
  for (const id of unique) {
    hash.update(id);
    hash.update("|");
  }
  const digest = hash.digest("hex");
  return `sc${digest.slice(0, 8)}`;
}

