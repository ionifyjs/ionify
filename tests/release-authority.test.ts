import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EXACT_RELEASE_FAMILIES,
  FAMILY_CONFIG,
  auditConsumerCoverage,
  classifyAuthorityChange,
  createReceipt,
  digestObject,
  evaluateReceiptGate,
  generateConsumerMatrix,
  node26HealthLane,
  parseRawDiffZ,
  validateSelectedReceipts,
  validateNativeConsumption,
  verifyReceipt,
} from "../scripts/release-authority.mjs";
import { assertNodeMajorAbiParity, findNativeRuntimeEntry } from "../scripts/native-abi-proof.mjs";

const issuedAt = "2026-09-01T00:00:00.000Z";

function receipt(
  family = "PF-NBUILD",
  options: { dueAt?: string | null; blocking?: boolean; admission?: "VALID" | "INVALID" } = {},
) {
  return createReceipt({
    family,
    factId: `${family}:test`,
    issuedAt,
    admission: { status: options.admission ?? "VALID", immutableArtifactIdentity: "a".repeat(64) },
    corroboration: {
      required: options.dueAt !== null && options.dueAt !== undefined,
      blocking: options.blocking ?? false,
      dueAt: options.dueAt ?? null,
    },
    authorityInputs: { releaseVersion: "0.1.37", sourceSha: "1".repeat(40) },
    environment: { nodePatch: "22.20.0", napi: "10", platform: "darwin", arch: "arm64" },
    outputs: { artifactSha256: "a".repeat(64) },
    parentReceipts: [],
    provenance: {
      repository: "ionifyjs/ionify-core",
      gitSha: "1".repeat(40),
      workflow: "test",
      runId: "local-test",
      runAttempt: 1,
      job: "unit",
      attestations: [{ kind: "test", identity: "unit" }],
    },
  }, new Date(issuedAt));
}

describe("release authority causal matrix", () => {
  it("derives the current 37 fixtures from the coverage law", () => {
    const lanes = generateConsumerMatrix();
    const result = auditConsumerCoverage(lanes);
    expect(lanes).toHaveLength(37);
    expect(result.status).toBe("VALID");
    expect(result.failures).toEqual([]);
    expect(lanes.filter((lane) => lane.phase === "P1")).toHaveLength(24);
    expect(lanes.filter((lane) => lane.phase === "P2")).toHaveLength(8);
    expect(lanes.filter((lane) => lane.phase === "P3")).toHaveLength(2);
    expect(lanes.filter((lane) => lane.phase === "P4")).toHaveLength(3);
  });

  it("fails closed when a supported-Node causal lane is missing", () => {
    const lanes = generateConsumerMatrix().filter((lane) =>
      !(lane.target === "darwin-x64" && lane.nodeMajor === 24 && lane.packageManager === "npm")
    );
    const result = auditConsumerCoverage(lanes);
    expect(result.status).toBe("INVALID");
    expect(result.failures).toContain("missing target×supported-node darwin-x64×24");
    expect(result.failures).toContain("missing npm Node-major polarity darwin-x64×24");
  });

  it("rejects unsupported Node majors from the blocking envelope matrix", () => {
    const lanes = generateConsumerMatrix();
    lanes.push({ ...lanes[0], laneId: "bad-node26", nodeMajor: 26 });
    expect(auditConsumerCoverage(lanes).failures).toContain("unsupported blocking Node 26");
  });

  it("keeps Node26 as a resolved-patch non-blocking health lane", () => {
    const health = node26HealthLane("26.3.0");
    expect(health.blocking).toBe(false);
    expect(health.feedsReleaseEnvelope).toBe(false);
    expect(() => node26HealthLane("26")).toThrow(/exact resolved patch/);
  });
});

describe("fact-specific receipt admission and corroboration", () => {
  it("seals every authority field into a deterministic resultHash", () => {
    const value = receipt();
    expect(verifyReceipt(value)).toBe(value);
    expect(value.resultHash).toMatch(/^[0-9a-f]{64}$/);
    const corrupted = structuredClone(value);
    corrupted.outputs.artifactSha256 = "b".repeat(64);
    expect(() => verifyReceipt(corrupted)).toThrow(/resultHash mismatch/);
  });

  it("does not expire immutable PF-NBUILD admission", () => {
    const value = receipt("PF-NBUILD", { dueAt: null });
    expect(evaluateReceiptGate(value, { now: new Date("2036-09-01T00:00:00Z") })).toEqual({
      accepted: true,
      reason: "VALID",
    });
  });

  it("reports overdue PF-NREBUILD health without invalidating PF-NBUILD", () => {
    const rebuild = receipt("PF-NREBUILD", { dueAt: "2026-09-15T00:00:00Z", blocking: false });
    expect(evaluateReceiptGate(rebuild, { now: new Date("2026-10-01T00:00:00Z") })).toEqual({
      accepted: true,
      reason: "VALID_ADMISSION_NON_BLOCKING_CORROBORATION_DUE",
    });
  });

  it("blocks a customer-facing corroboration obligation when overdue", () => {
    const registry = receipt("PF-REGISTRY", { dueAt: "2026-09-02T00:00:00Z", blocking: true });
    expect(evaluateReceiptGate(registry, { now: new Date("2026-09-03T00:00:00Z") })).toEqual({
      accepted: false,
      reason: "BLOCKING_CORROBORATION_DUE",
    });
  });

  it("keeps cadence-only GOLDEN health non-blocking but semantic GOLDEN blocking", () => {
    const golden = receipt("PF-GOLDEN", { dueAt: "2026-09-02T00:00:00Z", blocking: false });
    expect(evaluateReceiptGate(golden, { now: new Date("2026-09-03T00:00:00Z") }).accepted).toBe(true);
    expect(evaluateReceiptGate(golden, {
      now: new Date("2026-09-03T00:00:00Z"),
      semanticGoldenDue: true,
    })).toEqual({ accepted: false, reason: "SEMANTIC_GOLDEN_TRIGGER_DUE" });
  });

  it("rejects an otherwise valid receipt not selected by the classifier", () => {
    const value = receipt("PF-NBUILD");
    expect(evaluateReceiptGate(value, { selected: false })).toEqual({
      accepted: false,
      reason: "RECEIPT_NOT_SELECTED_BY_CLASSIFIER",
    });
  });
});

describe("Node-major native ABI authority", () => {
  const proof = (nodeMajor: number) => ({
    nodeMajor,
    nodePatch: `${nodeMajor}.20.0`,
    napi: "10",
    actualLoadedArtifactSha256: "a".repeat(64),
    exportNames: ["cacheHash", "depsStoreHash"],
    exportCount: 2,
    exportSetDigest: "b".repeat(64),
    behaviorDigest: "c".repeat(64),
  });

  it("discovers the published runtime loader instead of the native-free package root export", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-native-runtime-"));
    const dist = path.join(root, "dist");
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, "index.js"), "export const publicApi = true;\n");
    fs.writeFileSync(path.join(dist, "chunk-native.js"), [
      "function loadNativeBinding() {}",
      "const nativeBinding = loadNativeBinding();",
      "const native = nativeBinding;",
      "export { native };",
    ].join("\n"));
    try {
      expect(findNativeRuntimeEntry(root)).toBe(path.join(dist, "chunk-native.js"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("admits the same artifact, export surface, and representative behavior under Node22/24", () => {
    expect(assertNodeMajorAbiParity([proof(22), proof(24)])).toMatchObject({
      status: "VERIFIED",
      artifactSha256: "a".repeat(64),
      exportCount: 2,
    });
  });

  it("fails closed on Node-major export-surface mismatch", () => {
    expect(() => assertNodeMajorAbiParity([
      proof(22),
      { ...proof(24), exportNames: ["cacheHash"], exportCount: 1 },
    ])).toThrow(/parity mismatch/);
  });

  it("fails closed on loaded native artifact hash mismatch", () => {
    expect(() => assertNodeMajorAbiParity([
      proof(22),
      { ...proof(24), actualLoadedArtifactSha256: "d".repeat(64) },
    ])).toThrow(/actualLoadedArtifactSha256/);
  });
});

describe("Yarn Classic libc sibling contract", () => {
  const expected = "@ionify/ionify-linux-x64-gnu";
  const admitted = "a".repeat(64);

  it("permits GNU/musl siblings to coexist when the admitted GNU addon is selected and loaded", () => {
    expect(validateNativeConsumption({
      packageManager: "yarn",
      installedNativePackages: [expected, "@ionify/ionify-linux-x64-musl"],
      expectedNativePackage: expected,
      actualLoadedNativePackage: expected,
      actualLoadedArtifactSha256: admitted,
      admittedArtifactSha256: admitted,
      incompatibleSiblingLoaded: false,
    })).toEqual({
      status: "VALID",
      managerSpecificSingleExpectedPackageInstalled: null,
      unusedSiblingInstallationPermitted: true,
    });
  });

  it("rejects a coinstalled sibling when the wrong libc addon is selected", () => {
    expect(() => validateNativeConsumption({
      packageManager: "yarn",
      installedNativePackages: [expected, "@ionify/ionify-linux-x64-musl"],
      expectedNativePackage: expected,
      actualLoadedNativePackage: "@ionify/ionify-linux-x64-musl",
      actualLoadedArtifactSha256: admitted,
      admittedArtifactSha256: admitted,
      incompatibleSiblingLoaded: true,
    })).toThrow(/runtime selected/);
  });

  it("retains npm and pnpm single expected-package corroboration", () => {
    expect(() => validateNativeConsumption({
      packageManager: "npm",
      installedNativePackages: [expected, "@ionify/ionify-linux-x64-musl"],
      expectedNativePackage: expected,
      actualLoadedNativePackage: expected,
      actualLoadedArtifactSha256: admitted,
      admittedArtifactSha256: admitted,
      incompatibleSiblingLoaded: false,
    })).toThrow(/single expected-package corroboration/);
  });
});

describe("component classifier", () => {
  const components = [
    { id: "runtime", roots: ["src"], families: ["PF-NBUILD"], goldenTrigger: false },
    { id: "schema", roots: ["scripts/release-authority.mjs"], families: ["PF-ENVELOPE"], goldenTrigger: true },
  ];

  it("inventories add/delete/rename/mode/symlink/submodule records", () => {
    const z = [
      `:000000 100644 ${"0".repeat(40)} ${"1".repeat(40)} A`, "added.ts",
      `:100644 000000 ${"1".repeat(40)} ${"0".repeat(40)} D`, "deleted.ts",
      `:100644 100755 ${"1".repeat(40)} ${"2".repeat(40)} R100`, "old.ts", "new.ts",
      `:000000 120000 ${"0".repeat(40)} ${"3".repeat(40)} A`, "link",
      `:000000 160000 ${"0".repeat(40)} ${"4".repeat(40)} A`, "vendor/submodule",
      "",
    ].join("\0");
    const parsed = parseRawDiffZ(z);
    expect(parsed.map((entry) => entry.inputKinds)).toEqual([
      ["add", "mode"],
      ["delete", "mode"],
      ["rename", "mode"],
      ["add", "mode", "symlink"],
      ["add", "mode", "submodule"],
    ]);
  });

  it("maps authorities transitively and forces GOLDEN for unknown influence", () => {
    const decision = classifyAuthorityChange({
      inventory: [
        { oldPath: "src/native/index.ts", newPath: "src/native/index.ts" },
        { oldPath: "unregistered/new-input", newPath: "unregistered/new-input" },
      ],
      components,
    });
    expect(decision.status).toBe("GOLDEN_REQUIRED");
    expect(decision.requiredFamilies).toContain("PF-NBUILD");
    expect(decision.requiredFamilies).toContain("PF-COMPAT");
    expect(decision.requiredFamilies).toContain("PF-GOLDEN");
    expect(decision.goldenReasons).toContain("UNKNOWN_INFLUENCE");
  });

  it("forces bootstrap GOLDEN for schema/classifier/topology migration", () => {
    const decision = classifyAuthorityChange({ inventory: [], components, bootstrap: true });
    expect(decision.goldenRequired).toBe(true);
    expect(decision.goldenReasons).toContain("BOOTSTRAP_SCHEMA_CLASSIFIER_TOPOLOGY_AND_NODE_MATRIX_CHANGE");
  });

  it("selects PF-REGISTRY only for an actual publication lifecycle", () => {
    const registryComponent = [
      { id: "package", roots: ["package.json"], families: ["PF-MAIN", "PF-REGISTRY"], goldenTrigger: false },
    ];
    const inventory = [{ oldPath: "package.json", newPath: "package.json" }];
    const bootstrap = classifyAuthorityChange({ inventory, components: registryComponent, publication: false });
    const publication = classifyAuthorityChange({ inventory, components: registryComponent, publication: true });
    expect(bootstrap.requiredFamilies).not.toContain("PF-REGISTRY");
    expect(bootstrap.reasons[0].families).not.toContain("PF-REGISTRY");
    expect(publication.requiredFamilies).toContain("PF-REGISTRY");
    expect(publication.reasons[0].families).toContain("PF-REGISTRY");
  });

  it("rejects receipt families outside the classifier decision", () => {
    const selected = receipt("PF-NBUILD");
    const unselected = receipt("PF-NREBUILD");
    expect(() => validateSelectedReceipts({
      requiredFamilies: ["PF-NBUILD"],
      goldenReasons: [],
    }, [selected, unselected], new Date(issuedAt))).toThrow(/not selected by classifier/);
  });

  it("registers every accepted proof family and exact-release obligations", () => {
    expect(Object.keys(FAMILY_CONFIG)).toEqual([
      "PF-NBUILD", "PF-NREBUILD", "PF-NPACK", "PF-NSAN", "PF-NCONSUME",
      "PF-WINPATH", "PF-MAIN", "PF-CREATOR", "PF-COMPAT", "PF-STARTUP",
      "PF-BROWSER", "PF-BOUNDARY", "PF-ENVELOPE", "PF-REGISTRY", "PF-GOLDEN",
    ]);
    expect(EXACT_RELEASE_FAMILIES).toContain("PF-REGISTRY");
    expect(digestObject(EXACT_RELEASE_FAMILIES)).toMatch(/^[0-9a-f]{64}$/);
  });
});
