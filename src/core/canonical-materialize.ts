/**
 * C3-b — the fan-out's Transform-owned materializer (leg A).
 *
 * Publishes BOTH frozen G2-C2 Transform material projections for one canonical
 * generation, WITHOUT any second Transform:
 *   - base artifact   ← (sourceHash, codeA, mapA)          variant "base", defineHash ""
 *   - define artifact ← (sourceHash, codeB) + defineHash    variant "define"
 *                       map = mapA iff codeB == codeA (guard 3) else authoritative absence
 *
 * This is exactly the write logic of `production-transform-publication.ts`
 * (base at :237, define at :251), refactored to consume a supplied generation
 * instead of re-transforming. It reuses the proven `writeTransformArtifact`
 * (marker-last, outputHash-from-bytes, map-absence) — nothing about the
 * recipe-addressed CAS topology or the proof contract changes.
 *
 * Identity is a deterministic projection from the SAME generation inputs
 * (`getArtifactHash(sourceHash, "js", defineHash)` = the canonical recipe hash);
 * no identity is derived from an unrelated/independently-observed context.
 */
import {
  writeTransformArtifact,
  type TransformArtifactProof,
} from "@core/transform-artifact-proof";
import { getCasArtifactPath } from "@core/utils/cas";
import { getCacheKey } from "@core/cache";

/** The minimum Transform-owned material for one module generation. */
export interface CanonicalGenerationMaterial {
  /** getCacheKey(source) — anchors both projections to this generation. */
  sourceHash: string;
  /** Transform output A (base bytes). */
  codeA: string;
  /** A's source map, or null/undefined for absence. */
  mapA?: string | null;
  /** Define output B (final bytes). */
  codeB: string;
}

/** Stable wave/build inputs the materializer projects identity from. */
export interface CanonicalMaterializeContext {
  casRoot: string;
  configHash: string;
  /** "" when the build has no define recipe (then only the base artifact exists). */
  defineHash: string;
}

export interface CanonicalMaterializeResult {
  baseArtifactHash: string;
  baseProof: TransformArtifactProof;
  defineArtifactHash?: string;
  defineProof?: TransformArtifactProof;
}

/**
 * Canonical recipe-addressed artifact identity — the SAME projection the build
 * and PAP use (`getArtifactHash`). A js define-variant hashes source⊕defineHash;
 * a base (or no-define) artifact is keyed by sourceHash directly.
 */
export function canonicalArtifactHash(
  sourceHash: string,
  kind: "js" | "css",
  defineHash: string,
): string {
  if (kind !== "js") return sourceHash;
  if (!defineHash) return sourceHash;
  return getCacheKey(`${sourceHash}|define:${defineHash}`);
}

/**
 * Publish the base (A) and, when a define recipe exists, the define (B) artifact
 * for one generation, each with its independent TransformArtifactProof.
 */
export function materializeCanonicalGeneration(
  gen: CanonicalGenerationMaterial,
  ctx: CanonicalMaterializeContext,
): CanonicalMaterializeResult {
  const baseHash = gen.sourceHash;

  // Base A artifact — Transform-owned material, always published.
  const baseProof = writeTransformArtifact({
    dir: getCasArtifactPath(ctx.casRoot, ctx.configHash, baseHash),
    bytes: gen.codeA,
    map: gen.mapA ?? null,
    identity: {
      sourceHash: baseHash,
      recipeConfigHash: ctx.configHash,
      defineHash: "",
      artifactKind: "js",
      variant: "base",
    },
  });

  const result: CanonicalMaterializeResult = { baseArtifactHash: baseHash, baseProof };

  // Define B artifact — only when a define recipe exists (defineHash != "").
  if (ctx.defineHash) {
    const artifactHash = canonicalArtifactHash(baseHash, "js", ctx.defineHash);
    // Guard 3: B's map is A's map iff Define left the bytes unchanged, else absence.
    const mapB = gen.codeB === gen.codeA ? (gen.mapA ?? null) : null;
    result.defineProof = writeTransformArtifact({
      dir: getCasArtifactPath(ctx.casRoot, ctx.configHash, artifactHash),
      bytes: gen.codeB,
      map: mapB,
      identity: {
        sourceHash: baseHash,
        recipeConfigHash: ctx.configHash,
        defineHash: ctx.defineHash,
        artifactKind: "js",
        variant: "define",
      },
    });
    result.defineArtifactHash = artifactHash;
  }

  return result;
}
