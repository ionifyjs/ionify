import fs from "fs";
import path from "path";
import { getCacheKey } from "@core/cache";

/**
 * G2-C2 — Transform Authority byte-integrity proof for the recipe-addressed
 * production Transform CAS.
 *
 * Design: `docs/g2-c2-repair-design.md`. The production CAS directory is keyed by
 * RECIPE identity (`getArtifactHash`), which encodes source + define + config but
 * NOT the emitted output bytes. Presence of `transformed.js` therefore does not
 * prove byte integrity — a corrupt-but-present artifact was silently consumed
 * (the proven G2-C2 defect). This module is the single owner of:
 *   - proof construction & version,
 *   - expected-identity / currentness validation,
 *   - byte hashing (via getCacheKey),
 *   - map-presence semantics (mapHash vs authoritative absence),
 *   - atomic, marker-last publication ordering.
 *
 * The dev-side TransformEngine already carries an equivalent receipt
 * (`transform.meta.json` v2 with `codeHash`/`hasMap`); this extends that
 * discipline to the production CAS, which had dropped it.
 */

export const TRANSFORM_PROOF_VERSION = 1;
export const TRANSFORM_PROOF_FILE = "transform.proof.json";

export type TransformArtifactMap = { mapHash: string } | { authoritativeAbsence: true };
export type TransformArtifactKind = "js" | "css" | "css-wrapper-js";
export type TransformArtifactVariant = "base" | "define";

export interface TransformArtifactProof {
  proofVersion: number;
  /** baseHash — source content identity, sourced from Graph/plan (external anchor). */
  sourceHash: string;
  /** configHash the artifact was produced under (recipe currentness). */
  recipeConfigHash: string;
  /** "" for a base artifact, define signature hash for a define-variant. */
  defineHash: string;
  artifactKind: TransformArtifactKind;
  variant: TransformArtifactVariant;
  /** getCacheKey(materialized bytes) — the OUTPUT integrity fact the CAS path does not encode. */
  outputHash: string;
  map: TransformArtifactMap;
}

/** The identity fields the currently-consuming plan expects (design §0.2). */
export interface TransformArtifactExpectation {
  sourceHash: string;
  recipeConfigHash: string;
  defineHash: string;
  artifactKind: TransformArtifactKind;
  variant: TransformArtifactVariant;
  /** The requested dir's recipe hash, for the proof↔location check. */
  artifactHash: string;
  /**
   * Recompute a recipe artifactHash from a proof's own claimed identity, using
   * the caller's local getArtifactHash. Injected so identity math is never
   * duplicated here. `defineHash` is passed through so the recompute is explicit.
   */
  recomputeArtifactHash: (
    sourceHash: string,
    kind: TransformArtifactKind,
    defineHash: string,
  ) => string;
}

export type TransformAdmission =
  | { admissible: true; proof: TransformArtifactProof }
  | { admissible: false; reason: string };

function proofPathOf(dir: string): string {
  return path.join(dir, TRANSFORM_PROOF_FILE);
}
function jsPathOf(dir: string): string {
  return path.join(dir, "transformed.js");
}
function mapPathOf(dir: string): string {
  return path.join(dir, "transformed.js.map");
}

/**
 * Write `data` to a sibling temp file and return the temp path (the caller
 * renames it into place — rename is atomic on the same filesystem, so a reader
 * never observes a torn file).
 *
 * We deliberately do NOT `fsync`: it is not required for Gate-2 correctness and
 * is prohibitively expensive at scale (thousands of artifacts × per-file fsync).
 * Crash-safety is provided structurally instead — admission re-hashes the bytes
 * against `proof.outputHash` and the proof is published marker-last, so any
 * non-durable, partial, or torn state fails admission and is narrowly
 * reconstructed on the next build. fsync would only add power-loss *durability*
 * (a lost artifact is simply rebuilt), not correctness.
 */
function writeTemp(target: string, data: string): string {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, data);
  return tmp;
}

/**
 * Atomic, marker-last publication of a Transform artifact + its proof (design §5).
 * The proof is computed from the just-materialized bytes so it can never describe
 * bytes other than the ones being published. The proof rename is the LAST act and
 * is the visibility marker: an artifact is reusable iff its proof is present,
 * well-formed, identity-matched, and outputHash-matched.
 *
 * Returns the written proof (its `outputHash` is the value to pin on the plan).
 */
export function writeTransformArtifact(opts: {
  dir: string;
  bytes: string;
  /** null/undefined ⇒ authoritative absence; the map file is removed if present. */
  map?: string | null;
  identity: Omit<TransformArtifactProof, "proofVersion" | "outputHash" | "map">;
}): TransformArtifactProof {
  fs.mkdirSync(opts.dir, { recursive: true });
  const jsPath = jsPathOf(opts.dir);
  const mapPath = mapPathOf(opts.dir);
  const proofPath = proofPathOf(opts.dir);

  // 1. Materialize bytes/map to temp files (+fsync).
  const tmpJs = writeTemp(jsPath, opts.bytes);
  const tmpMap = opts.map != null ? writeTemp(mapPath, opts.map) : null;

  // 2. Compute the proof FROM the materialized bytes.
  const proof: TransformArtifactProof = {
    proofVersion: TRANSFORM_PROOF_VERSION,
    outputHash: getCacheKey(opts.bytes),
    map: opts.map != null ? { mapHash: getCacheKey(opts.map) } : { authoritativeAbsence: true },
    ...opts.identity,
  };

  // 3. Atomically publish bytes/map.
  fs.renameSync(tmpJs, jsPath);
  if (tmpMap) {
    fs.renameSync(tmpMap, mapPath);
  } else if (fs.existsSync(mapPath)) {
    // Enforce authoritative absence: no stale map may accompany a no-map proof.
    fs.rmSync(mapPath);
  }

  // 4. Publish the proof LAST (the visibility marker).
  fs.renameSync(writeTemp(proofPath, `${JSON.stringify(proof)}\n`), proofPath);
  return proof;
}

/**
 * Admit a materialized artifact against the current expected Transform contract
 * (design §0.2). Returns the verified proof (whose `outputHash` is the value to
 * pin on the plan) or a NonAdmissible reason. The caller reconstructs on any
 * NonAdmissible result. The proof is NOT self-certifying: checks 2-5 bind it to
 * the plan-derived expected identity, checks 6-7 to the materialized bytes/map.
 */
export function admitTransformArtifact(
  dir: string,
  exp: TransformArtifactExpectation,
): TransformAdmission {
  const proofPath = proofPathOf(dir);
  const jsPath = jsPathOf(dir);
  const mapPath = mapPathOf(dir);

  if (!fs.existsSync(proofPath) || !fs.existsSync(jsPath)) {
    return { admissible: false, reason: "missing artifact or proof" };
  }
  let proof: TransformArtifactProof;
  try {
    proof = JSON.parse(fs.readFileSync(proofPath, "utf8")) as TransformArtifactProof;
  } catch {
    return { admissible: false, reason: "malformed proof" };
  }
  // 1. Supported version.
  if (proof.proofVersion !== TRANSFORM_PROOF_VERSION) {
    return { admissible: false, reason: "unsupported proofVersion" };
  }
  // 2. Expected source (external anchor: plan/Graph baseHash).
  if (proof.sourceHash !== exp.sourceHash) {
    return { admissible: false, reason: "sourceHash mismatch" };
  }
  // 3. Proof ↔ location: the proof's own identity must hash to this dir.
  if (exp.recomputeArtifactHash(proof.sourceHash, proof.artifactKind, proof.defineHash) !== exp.artifactHash) {
    return { admissible: false, reason: "proof/location mismatch" };
  }
  // 4. Recipe currentness.
  if (proof.recipeConfigHash !== exp.recipeConfigHash || proof.defineHash !== exp.defineHash) {
    return { admissible: false, reason: "recipe mismatch" };
  }
  // 5. Kind / variant.
  if (proof.artifactKind !== exp.artifactKind || proof.variant !== exp.variant) {
    return { admissible: false, reason: "kind/variant mismatch" };
  }
  // 6. Material integrity of the emitted bytes.
  if (getCacheKey(fs.readFileSync(jsPath, "utf8")) !== proof.outputHash) {
    return { admissible: false, reason: "outputHash mismatch" };
  }
  // 7. Map contract: verify present map, or prove authoritative absence.
  if ("authoritativeAbsence" in proof.map) {
    if (fs.existsSync(mapPath)) {
      return { admissible: false, reason: "unexpected map present" };
    }
  } else if (!fs.existsSync(mapPath) || getCacheKey(fs.readFileSync(mapPath, "utf8")) !== proof.map.mapHash) {
    return { admissible: false, reason: "map integrity mismatch" };
  }
  return { admissible: true, proof };
}
