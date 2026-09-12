import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const RECEIPT_KIND = "ionify.release-authority-receipt";
export const RECEIPT_SCHEMA_VERSION = 2;
export const MACHINE_STATES = Object.freeze([
  "INVALID",
  "VALID",
  "VALID_BUT_CORROBORATION_DUE",
]);

export const TARGETS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "win32-arm64-msvc",
  "win32-x64-msvc",
  "linux-arm64-gnu",
  "linux-x64-gnu",
  "linux-arm64-musl",
  "linux-x64-musl",
]);
export const SUPPORTED_NODE_MAJORS = Object.freeze([22, 24]);
export const HEALTH_NODE_MAJOR = 26;
export const PACKAGE_MANAGERS = Object.freeze(["npm", "pnpm", "yarn"]);
export const MODES = Object.freeze(["build", "dev"]);

export const FAMILY_CONFIG = Object.freeze({
  "PF-NBUILD": { owner: "private-native-producer", exactPerRelease: false, cadenceDays: null, blockingCadence: false },
  "PF-NREBUILD": { owner: "native-rebuild-health", exactPerRelease: false, cadenceDays: null, blockingCadence: false },
  "PF-NPACK": { owner: "private-native-packer", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-NSAN": { owner: "private-native-sanitizer", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-NCONSUME": { owner: "public-target-consumer", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-WINPATH": { owner: "windows-x64-host", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-MAIN": { owner: "public-main-packer", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-CREATOR": { owner: "private-creator-packer", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-COMPAT": { owner: "node-native-abi-consumer", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-STARTUP": { owner: "public-generated-consumer", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-BROWSER": { owner: "linux-x64-gnu-chromium", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-BOUNDARY": { owner: "private-public-sealed-boundary", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-ENVELOPE": { owner: "release-authority-aggregator", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-REGISTRY": { owner: "real-registry-lifecycle", exactPerRelease: true, cadenceDays: null, blockingCadence: true },
  "PF-GOLDEN": { owner: "canonical-golden-workflow", exactPerRelease: false, cadenceDays: null, blockingCadence: false },
});

export const EXACT_RELEASE_FAMILIES = Object.freeze(
  Object.entries(FAMILY_CONFIG).filter(([, value]) => value.exactPerRelease).map(([family]) => family),
);

const TRANSITIVE_CONSUMERS = Object.freeze({
  "PF-NBUILD": ["PF-NPACK", "PF-NSAN", "PF-NCONSUME", "PF-COMPAT", "PF-STARTUP", "PF-BROWSER", "PF-BOUNDARY", "PF-ENVELOPE"],
  "PF-NPACK": ["PF-NCONSUME", "PF-COMPAT", "PF-STARTUP", "PF-BROWSER", "PF-BOUNDARY", "PF-ENVELOPE"],
  "PF-NSAN": ["PF-BOUNDARY", "PF-ENVELOPE"],
  "PF-MAIN": ["PF-NCONSUME", "PF-STARTUP", "PF-BROWSER", "PF-BOUNDARY", "PF-ENVELOPE", "PF-REGISTRY"],
  "PF-CREATOR": ["PF-NCONSUME", "PF-STARTUP", "PF-BOUNDARY", "PF-ENVELOPE", "PF-REGISTRY"],
  "PF-NCONSUME": ["PF-COMPAT", "PF-STARTUP", "PF-BROWSER", "PF-ENVELOPE"],
  "PF-COMPAT": ["PF-ENVELOPE"],
  "PF-STARTUP": ["PF-BROWSER", "PF-ENVELOPE"],
  "PF-BROWSER": ["PF-ENVELOPE"],
  "PF-WINPATH": ["PF-ENVELOPE"],
  "PF-BOUNDARY": ["PF-ENVELOPE"],
  "PF-REGISTRY": ["PF-ENVELOPE"],
  "PF-GOLDEN": ["PF-ENVELOPE"],
});

function jsonValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = jsonValue(value[key]);
  return result;
}

export function canonicalJson(value) {
  return JSON.stringify(jsonValue(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex");
}

export function digestObject(value) {
  return sha256(canonicalJson(value));
}

function assertPlainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function isoTime(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(time).toISOString();
}

export function receiptMachineState(receipt, now = new Date()) {
  if (receipt.admission?.status !== "VALID") return "INVALID";
  const dueAt = receipt.corroboration?.dueAt;
  if (dueAt && new Date(dueAt).getTime() <= new Date(now).getTime()) return "VALID_BUT_CORROBORATION_DUE";
  return "VALID";
}

export function createReceipt(input, now = new Date()) {
  if (!FAMILY_CONFIG[input.family]) throw new Error(`unknown proof family: ${input.family}`);
  if (!input.factId || typeof input.factId !== "string") throw new Error("factId is required");
  assertPlainRecord(input.admission, "admission");
  assertPlainRecord(input.corroboration, "corroboration");
  assertPlainRecord(input.authorityInputs, "authorityInputs");
  assertPlainRecord(input.environment, "environment");
  assertPlainRecord(input.outputs, "outputs");
  assertPlainRecord(input.provenance, "provenance");
  if (!Array.isArray(input.parentReceipts)) throw new Error("parentReceipts must be an array");
  if (!Array.isArray(input.provenance.attestations)) throw new Error("provenance.attestations must be an array");
  const issuedAt = isoTime(input.issuedAt ?? now.toISOString(), "issuedAt");
  const body = {
    kind: RECEIPT_KIND,
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    family: input.family,
    factId: input.factId,
    issuedAt,
    admission: input.admission,
    corroboration: input.corroboration,
    authorityInputs: input.authorityInputs,
    environment: input.environment,
    outputs: input.outputs,
    parentReceipts: input.parentReceipts,
    provenance: input.provenance,
  };
  const receipt = { ...body, machineState: receiptMachineState(body, now) };
  return { ...receipt, resultHash: digestObject(receipt) };
}

export function verifyReceipt(receipt, now = new Date()) {
  if (receipt?.kind !== RECEIPT_KIND || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new Error("unknown receipt kind or schema");
  }
  if (!FAMILY_CONFIG[receipt.family]) throw new Error(`unknown proof family: ${receipt.family}`);
  if (!MACHINE_STATES.includes(receipt.machineState)) throw new Error(`unknown machine state: ${receipt.machineState}`);
  const { resultHash, ...body } = receipt;
  const expected = digestObject(body);
  if (resultHash !== expected) throw new Error(`${receipt.family}/${receipt.factId} resultHash mismatch`);
  const issuedState = receiptMachineState(receipt, new Date(receipt.issuedAt));
  if (receipt.machineState !== issuedState) throw new Error(`${receipt.family}/${receipt.factId} issued machineState is inconsistent`);
  if (!Array.isArray(receipt.parentReceipts) || receipt.parentReceipts.some((parent) =>
    !FAMILY_CONFIG[parent.family] || typeof parent.factId !== "string" || !/^[0-9a-f]{64}$/.test(parent.resultHash ?? "")
  )) throw new Error(`${receipt.family}/${receipt.factId} has invalid parent receipt references`);
  if (!Array.isArray(receipt.provenance?.attestations)) throw new Error(`${receipt.family}/${receipt.factId} lacks attestations`);
  return receipt;
}

export function evaluateReceiptGate(receipt, { selected = true, now = new Date(), semanticGoldenDue = false } = {}) {
  verifyReceipt(receipt, now);
  const currentState = receiptMachineState(receipt, now);
  if (!selected) return { accepted: false, reason: "RECEIPT_NOT_SELECTED_BY_CLASSIFIER" };
  if (currentState === "INVALID") return { accepted: false, reason: "ADMISSION_INVALID" };
  if (semanticGoldenDue && receipt.family === "PF-GOLDEN") {
    return { accepted: false, reason: "SEMANTIC_GOLDEN_TRIGGER_DUE" };
  }
  if (currentState === "VALID_BUT_CORROBORATION_DUE" && receipt.corroboration.blocking === true) {
    return { accepted: false, reason: "BLOCKING_CORROBORATION_DUE" };
  }
  return {
    accepted: true,
    reason: currentState === "VALID_BUT_CORROBORATION_DUE"
      ? "VALID_ADMISSION_NON_BLOCKING_CORROBORATION_DUE"
      : "VALID",
  };
}

function lane(phase, target, nodeMajor, packageManager, mode) {
  const runnerByTarget = {
    "darwin-arm64": "macos-14",
    "darwin-x64": "macos-15-intel",
    "win32-arm64-msvc": "windows-11-arm",
    "win32-x64-msvc": "windows-2025",
    "linux-arm64-gnu": "ubuntu-24.04-arm",
    "linux-x64-gnu": "ubuntu-24.04",
    "linux-arm64-musl": "ubuntu-24.04-arm",
    "linux-x64-musl": "ubuntu-24.04",
  };
  return {
    laneId: `${phase}-${target}-node${nodeMajor}-${packageManager}-${mode}`,
    phase,
    target,
    nodeMajor,
    packageManager,
    packageManagerVersion: packageManager === "yarn" ? "1.22.22" : null,
    mode,
    blocking: true,
    runner: runnerByTarget[target],
    muslContainer: target.endsWith("-musl") ? `node:${nodeMajor}-alpine` : null,
    browser: target === "linux-x64-gnu" && packageManager === "npm",
  };
}

export function generateConsumerMatrix() {
  const lanes = [];
  for (let targetIndex = 0; targetIndex < TARGETS.length; targetIndex += 1) {
    for (let managerIndex = 0; managerIndex < PACKAGE_MANAGERS.length; managerIndex += 1) {
      lanes.push(lane(
        "P1",
        TARGETS[targetIndex],
        22,
        PACKAGE_MANAGERS[managerIndex],
        (targetIndex + managerIndex) % 2 === 0 ? "build" : "dev",
      ));
    }
  }
  for (let targetIndex = 0; targetIndex < TARGETS.length; targetIndex += 1) {
    lanes.push(lane("P2", TARGETS[targetIndex], 24, "npm", targetIndex % 2 === 0 ? "build" : "dev"));
  }
  lanes.push(lane("P3", "linux-x64-gnu", 24, "pnpm", "dev"));
  lanes.push(lane("P3", "linux-x64-gnu", 24, "yarn", "build"));
  lanes.push(lane("P4", "darwin-arm64", 24, "pnpm", "build"));
  lanes.push(lane("P4", "linux-arm64-musl", 24, "yarn", "dev"));
  lanes.push(lane("P4", "win32-x64-msvc", 24, "yarn", "dev"));
  return lanes;
}

function missingPairs(left, right, lanes, selectors) {
  const missing = [];
  for (const a of left) for (const b of right) {
    if (!lanes.some((entry) => selectors(entry, a, b))) missing.push(`${a}×${b}`);
  }
  return missing;
}

export function auditConsumerCoverage(lanes) {
  const failures = [];
  const ids = new Set();
  for (const entry of lanes) {
    if (ids.has(entry.laneId)) failures.push(`duplicate lane ${entry.laneId}`);
    ids.add(entry.laneId);
    if (!TARGETS.includes(entry.target)) failures.push(`unknown target ${entry.target}`);
    if (!SUPPORTED_NODE_MAJORS.includes(entry.nodeMajor)) failures.push(`unsupported blocking Node ${entry.nodeMajor}`);
    if (!PACKAGE_MANAGERS.includes(entry.packageManager)) failures.push(`unknown manager ${entry.packageManager}`);
    if (!MODES.includes(entry.mode)) failures.push(`unknown mode ${entry.mode}`);
    if (entry.blocking !== true) failures.push(`blocking matrix contains non-blocking lane ${entry.laneId}`);
  }
  for (const item of missingPairs(TARGETS, PACKAGE_MANAGERS, lanes, (x, a, b) => x.target === a && x.packageManager === b)) {
    failures.push(`missing target×manager ${item}`);
  }
  for (const item of missingPairs(TARGETS, SUPPORTED_NODE_MAJORS, lanes, (x, a, b) => x.target === a && x.nodeMajor === b)) {
    failures.push(`missing target×supported-node ${item}`);
  }
  for (const item of missingPairs(TARGETS, MODES, lanes, (x, a, b) => x.target === a && x.mode === b)) {
    failures.push(`missing target×mode ${item}`);
  }
  for (const manager of PACKAGE_MANAGERS) for (const nodeMajor of SUPPORTED_NODE_MAJORS) for (const mode of MODES) {
    if (!lanes.some((x) => x.packageManager === manager && x.nodeMajor === nodeMajor && x.mode === mode)) {
      failures.push(`missing manager×node×mode ${manager}×${nodeMajor}×${mode}`);
    }
  }
  for (const target of TARGETS) for (const nodeMajor of SUPPORTED_NODE_MAJORS) {
    if (!lanes.some((x) => x.target === target && x.packageManager === "npm" && x.nodeMajor === nodeMajor)) {
      failures.push(`missing npm Node-major polarity ${target}×${nodeMajor}`);
    }
  }
  if (!lanes.some((x) => x.packageManager === "yarn" && x.target.endsWith("-gnu"))) failures.push("missing Yarn GNU evidence");
  if (!lanes.some((x) => x.packageManager === "yarn" && x.target.endsWith("-musl"))) failures.push("missing Yarn musl evidence");
  if (!lanes.some((x) => x.nodeMajor === 24 && x.packageManager !== "npm" && x.target.startsWith("darwin-"))) {
    failures.push("missing Darwin Node24 alternate-manager sentinel");
  }
  if (!lanes.some((x) => x.nodeMajor === 24 && x.packageManager !== "npm" && x.target.startsWith("win32-"))) {
    failures.push("missing Windows Node24 alternate-manager sentinel");
  }
  return {
    status: failures.length === 0 ? "VALID" : "INVALID",
    laneCount: lanes.length,
    causalLawVersion: 1,
    supportedNodeMajors: [...SUPPORTED_NODE_MAJORS],
    failures,
    matrixHash: digestObject(lanes),
  };
}

export function node26HealthLane(resolvedPatch) {
  if (!/^26\.\d+\.\d+/.test(resolvedPatch)) throw new Error(`Node26 health requires an exact resolved patch, received ${resolvedPatch}`);
  return {
    laneId: `HEALTH-linux-x64-gnu-node${resolvedPatch}-npm-build-dev`,
    phase: "HEALTH",
    target: "linux-x64-gnu",
    nodeMajor: HEALTH_NODE_MAJOR,
    nodePatch: resolvedPatch,
    packageManager: "npm",
    modes: ["build", "dev"],
    blocking: false,
    feedsReleaseEnvelope: false,
  };
}

export function validateNativeConsumption({
  packageManager,
  installedNativePackages,
  expectedNativePackage,
  actualLoadedNativePackage,
  actualLoadedArtifactSha256,
  admittedArtifactSha256,
  incompatibleSiblingLoaded,
}) {
  if (!PACKAGE_MANAGERS.includes(packageManager)) throw new Error(`unknown package manager: ${packageManager}`);
  if (!Array.isArray(installedNativePackages) || !installedNativePackages.includes(expectedNativePackage)) {
    throw new Error("expected target-native package is not installed");
  }
  if (actualLoadedNativePackage !== expectedNativePackage) {
    throw new Error(`runtime selected ${actualLoadedNativePackage}, expected ${expectedNativePackage}`);
  }
  if (actualLoadedArtifactSha256 !== admittedArtifactSha256) {
    throw new Error("loaded native artifact hash mismatch");
  }
  if (incompatibleSiblingLoaded !== false) throw new Error("an incompatible native sibling was loaded");
  if (packageManager !== "yarn" && (
    installedNativePackages.length !== 1 || installedNativePackages[0] !== expectedNativePackage
  )) throw new Error(`${packageManager} did not retain single expected-package corroboration`);
  return {
    status: "VALID",
    managerSpecificSingleExpectedPackageInstalled: packageManager === "yarn" ? null : true,
    unusedSiblingInstallationPermitted: packageManager === "yarn",
  };
}

export function parseRawDiffZ(raw) {
  const tokens = Buffer.isBuffer(raw) ? raw.toString("utf8").split("\0") : String(raw).split("\0");
  const entries = [];
  for (let index = 0; index < tokens.length;) {
    const header = tokens[index++];
    if (!header) continue;
    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/.exec(header);
    if (!match) throw new Error(`cannot parse git raw diff record: ${header}`);
    const [, oldMode, newMode, oldOid, newOid, status, score] = match;
    const oldPath = tokens[index++];
    const newPath = status === "R" || status === "C" ? tokens[index++] : oldPath;
    if (!oldPath || !newPath) throw new Error(`git raw diff ${status} record lacks a path`);
    const inputKinds = [];
    if (status === "A") inputKinds.push("add");
    else if (status === "D") inputKinds.push("delete");
    else if (status === "R") inputKinds.push("rename");
    else if (status === "C") inputKinds.push("copy");
    else inputKinds.push("change");
    if (oldMode !== newMode) inputKinds.push("mode");
    if (oldMode === "120000" || newMode === "120000") inputKinds.push("symlink");
    if (oldMode === "160000" || newMode === "160000") inputKinds.push("submodule");
    entries.push({ status, score: score || null, oldMode, newMode, oldOid, newOid, oldPath, newPath, inputKinds });
  }
  return entries;
}

function componentOwns(component, file) {
  return component.roots.some((root) => file === root || file.startsWith(root.endsWith("/") ? root : `${root}/`));
}

export function componentTreeDigest(repoRoot, commit, component) {
  const output = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", commit, "--", ...component.roots], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const entries = output.split("\0").filter(Boolean).map((line) => {
    const match = /^(\d{6}) (\w+) ([0-9a-f]+)\t(.+)$/.exec(line);
    if (!match) throw new Error(`cannot parse git tree entry: ${line}`);
    return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return { componentId: component.id, digest: digestObject(entries), entries };
}

export function classifyAuthorityChange({ inventory, components, componentDigests = [], bootstrap = false, publication = false }) {
  const changedComponents = new Set();
  const unknownInputs = [];
  for (const change of inventory) {
    const owners = components.filter((component) => componentOwns(component, change.oldPath) || componentOwns(component, change.newPath));
    if (owners.length === 0) unknownInputs.push(change);
    for (const owner of owners) changedComponents.add(owner.id);
  }
  const required = new Set(EXACT_RELEASE_FAMILIES.filter((family) => publication || family !== "PF-REGISTRY"));
  const reasons = [];
  for (const component of components.filter((item) => changedComponents.has(item.id))) {
    for (const family of component.families) required.add(family);
    reasons.push({ code: "CHANGED_AUTHORITY", component: component.id, families: [...component.families] });
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const family of [...required]) for (const consumer of TRANSITIVE_CONSUMERS[family] ?? []) {
      if (consumer === "PF-REGISTRY" && !publication) continue;
      if (!required.has(consumer)) { required.add(consumer); expanded = true; }
    }
  }
  const goldenReasons = [];
  if (bootstrap) goldenReasons.push("BOOTSTRAP_SCHEMA_CLASSIFIER_TOPOLOGY_AND_NODE_MATRIX_CHANGE");
  if (unknownInputs.length > 0) goldenReasons.push("UNKNOWN_INFLUENCE");
  if (components.some((component) => changedComponents.has(component.id) && component.goldenTrigger === true)) {
    goldenReasons.push("SEMANTIC_GOLDEN_TRIGGER");
  }
  if (goldenReasons.length > 0) required.add("PF-GOLDEN");
  const digestById = new Map(componentDigests.map((item) => [item.componentId, item.digest]));
  return {
    kind: "ionify.release-authority-classifier-decision",
    schemaVersion: 1,
    status: unknownInputs.length > 0 ? "GOLDEN_REQUIRED" : "CLASSIFIED",
    inventory,
    changedComponents: [...changedComponents].sort().map((componentId) => ({ componentId, digest: digestById.get(componentId) ?? null })),
    unknownInputs,
    requiredFamilies: [...required].sort(),
    rerunFamilies: [...required].sort(),
    reusableFamilies: Object.keys(FAMILY_CONFIG).filter((family) => !required.has(family)).sort(),
    corroborationDecisions: [
      { family: "PF-NREBUILD", localDarwinArm64CadenceDays: 14, hostedCadenceDays: 28, blocking: false },
      { family: "PF-GOLDEN", cadenceOnlyBlocking: false, semanticTriggerBlocking: true },
    ],
    goldenRequired: goldenReasons.length > 0,
    goldenReasons,
    reasons,
  };
}

export function validateSelectedReceipts(decision, receipts, now = new Date()) {
  const required = new Set(decision.requiredFamilies);
  const byFamily = new Map();
  for (const receipt of receipts) {
    verifyReceipt(receipt, now);
    if (!required.has(receipt.family)) throw new Error(`receipt ${receipt.resultHash} was not selected by classifier`);
    const list = byFamily.get(receipt.family) ?? [];
    list.push(receipt);
    byFamily.set(receipt.family, list);
  }
  const missing = [...required].filter((family) => !byFamily.has(family));
  if (missing.length > 0) throw new Error(`classifier-selected proof families are missing: ${missing.join(", ")}`);
  for (const receipt of receipts) {
    const result = evaluateReceiptGate(receipt, {
      selected: true,
      now,
      semanticGoldenDue: false,
    });
    if (!result.accepted) throw new Error(`${receipt.family}/${receipt.factId} rejected: ${result.reason}`);
  }
  return { status: "VALID", selectedReceiptCount: receipts.length, familyCount: byFamily.size };
}

export function buildEnvelopeReceipt({ decision, receipts, authorityInputs, environment, provenance, now = new Date() }) {
  const children = receipts.filter((receipt) => receipt.family !== "PF-ENVELOPE");
  validateSelectedReceipts({
    ...decision,
    requiredFamilies: decision.requiredFamilies.filter((family) => family !== "PF-ENVELOPE"),
  }, children, now);
  return createReceipt({
    family: "PF-ENVELOPE",
    factId: `release-envelope:${authorityInputs.releaseVersion}:${digestObject(decision).slice(0, 16)}`,
    admission: { status: "VALID", decisionHash: digestObject(decision) },
    corroboration: { required: false, blocking: false, dueAt: null },
    authorityInputs,
    environment,
    outputs: {
      classifierDecisionHash: digestObject(decision),
      childReceiptCount: children.length,
      childReceipts: children.map((receipt) => ({ family: receipt.family, factId: receipt.factId, resultHash: receipt.resultHash })),
    },
    parentReceipts: children.map((receipt) => ({ family: receipt.family, factId: receipt.factId, resultHash: receipt.resultHash })),
    provenance,
  }, now);
}

function cliArg(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function writeJson(output, value) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "matrix") {
    const output = cliArg(args, "--output");
    const lanes = generateConsumerMatrix();
    const coverage = auditConsumerCoverage(lanes);
    if (coverage.status !== "VALID") throw new Error(`causal coverage failed: ${coverage.failures.join("; ")}`);
    const result = { kind: "ionify.release-authority-consumer-matrix", schemaVersion: 1, lanes, coverage };
    if (output) writeJson(output, result); else process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "classify") {
    const repo = path.resolve(cliArg(args, "--repo") ?? ".");
    const base = cliArg(args, "--base");
    const head = cliArg(args, "--head") ?? "HEAD";
    const componentsPath = path.resolve(cliArg(args, "--components") ?? path.join(repo, ".release-authority", "components.json"));
    const output = cliArg(args, "--output");
    if (!base || !output) throw new Error("classify requires --base and --output");
    const componentsDocument = JSON.parse(fs.readFileSync(componentsPath, "utf8"));
    const raw = execFileSync("git", ["diff", "--raw", "-z", "--find-renames", "--no-abbrev", `${base}..${head}`], { cwd: repo });
    const inventory = parseRawDiffZ(raw);
    const componentDigests = componentsDocument.components.map((component) => componentTreeDigest(repo, head, component));
    const decision = classifyAuthorityChange({
      inventory,
      components: componentsDocument.components,
      componentDigests,
      bootstrap: args.includes("--bootstrap"),
      publication: args.includes("--publication"),
    });
    writeJson(output, { ...decision, base, head, componentManifestHash: digestObject(componentsDocument), componentDigests });
    return;
  }
  if (command) throw new Error(`unknown release-authority command: ${command}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();
