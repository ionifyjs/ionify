import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  auditConsumerCoverage,
  buildEnvelopeReceipt,
  digestObject,
  generateConsumerMatrix,
  validateNativeConsumption,
  validateSelectedReceipts,
  verifyReceipt,
} from "./release-authority.mjs";
import { assertNodeMajorAbiParity } from "./native-abi-proof.mjs";

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const inputRoot = path.resolve(arg("--input") ?? "");
const consumersRoot = path.resolve(arg("--consumers") ?? "");
const outputRoot = path.resolve(arg("--output") ?? "");
const publicProofToolingSha = arg("--public-proof-tooling-sha");
const publicationToolingSha = arg("--publication-tooling-sha");
if (!arg("--input") || !arg("--consumers") || !arg("--output") || !publicProofToolingSha || !publicationToolingSha) {
  throw new Error("--input, --consumers, --output, --public-proof-tooling-sha, and --publication-tooling-sha are required");
}
if (!/^[0-9a-f]{40}$/.test(publicProofToolingSha) || !/^[0-9a-f]{40}$/.test(publicationToolingSha)) {
  throw new Error("proof and publication tooling identities must be full Git SHAs");
}
const verify = spawnSync(process.execPath, [path.join(toolingRoot, "scripts", "verify-split-proof-input.mjs"), inputRoot], {
  encoding: "utf8",
  stdio: "pipe",
});
if (verify.error) throw verify.error;
if (verify.status !== 0) throw new Error(`split proof input rejected\n${verify.stdout}\n${verify.stderr}`);

function walk(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else files.push(absolute);
  }
  return files;
}
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const input = JSON.parse(fs.readFileSync(path.join(inputRoot, "split-proof-input.json"), "utf8"));
const classifier = JSON.parse(fs.readFileSync(path.resolve(inputRoot, input.classifierDecision.file), "utf8"));
if (sha256(path.resolve(inputRoot, input.classifierDecision.file)) !== input.classifierDecision.sha256) {
  throw new Error("classifier decision changed after the sealed boundary");
}
if (classifier.requiredFamilies.includes("PF-REGISTRY")) {
  throw new Error("pre-publication bootstrap classifier must not admit PF-REGISTRY without a real registry lifecycle");
}

const expectedLanes = generateConsumerMatrix();
const expectedById = new Map(expectedLanes.map((lane) => [lane.laneId, lane]));
const coverage = auditConsumerCoverage(expectedLanes);
if (coverage.status !== "VALID") throw new Error(`authority matrix generator is invalid: ${coverage.failures.join("; ")}`);

const consumerFiles = walk(consumersRoot).filter((file) => /^consumer-proof-.+\.json$/.test(path.basename(file)));
const consumers = new Map();
const admittedReceipts = [];
const browserOwners = [];
for (const proofFile of consumerFiles) {
  const proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
  const expectedLane = expectedById.get(proof.lane?.laneId);
  if (
    proof.kind !== "ionify.public-target-consumer-proof" || proof.schemaVersion !== 2 ||
    proof.status !== "VERIFIED" || proof.topology !== input.topology || !expectedLane ||
    consumers.has(proof.lane.laneId)
  ) throw new Error(`unknown, duplicate, or unverified consumer lane proof: ${proofFile}`);
  for (const field of ["target", "nodeMajor", "packageManager", "mode", "phase", "blocking"]) {
    const proofValue = field === "target" ? proof.packageTarget : proof.lane[field];
    if (proofValue !== expectedLane[field]) throw new Error(`${proof.lane.laneId} disagrees on ${field}`);
  }
  if (
    proof.releaseVersion !== input.releaseVersion ||
    proof.enginePrivateGitSha !== input.enginePrivateGitSha ||
    proof.creatorSourceGitSha !== input.creatorSourceGitSha ||
    proof.goldenProofToolingPrivateGitSha !== input.goldenProofToolingPrivateGitSha ||
    proof.candidateProofToolingPrivateGitSha !== input.candidateProofToolingPrivateGitSha ||
    proof.publicCandidateGitSha !== input.publicCandidateGitSha ||
    proof.publicReadmeSha256 !== input.publicReadmeSha256 ||
    proof.host?.target !== proof.packageTarget ||
    proof.packageSurfaceAudit?.status !== "VERIFIED" ||
    proof.packageSurfaceAudit?.mainContainsNativeAddon !== false ||
    proof.packageSurfaceAudit?.nativeContainsExactlyOneAddon !== true
  ) throw new Error(`${proof.lane.laneId} disagrees with the sealed generation`);
  const native = input.natives.find((item) => item.packageTarget === proof.packageTarget);
  if (
    proof.artifacts?.mainSha256 !== input.main.sha256 ||
    proof.artifacts?.creatorSha256 !== input.creator.sha256 ||
    proof.artifacts?.nativeSha256 !== native.sha256 ||
    proof.artifacts?.addonSha256 !== native.addonSha256 ||
    proof.artifacts?.privateBuildProofSha256 !== native.privateBuildProofSha256
  ) throw new Error(`${proof.lane.laneId} artifact identities diverge`);
  if (!Array.isArray(proof.fixtureProofs) || proof.fixtureProofs.length !== 1) {
    throw new Error(`${proof.lane.laneId} must own exactly one derived consumer fixture`);
  }
  const fixture = proof.fixtureProofs[0];
  const expectedNative = `@ionify/ionify-${proof.packageTarget}`;
  const expectedLockfile = expectedLane.packageManager === "npm"
    ? "package-lock.json"
    : expectedLane.packageManager === "pnpm" ? "pnpm-lock.yaml" : "yarn.lock";
  if (
    fixture.packageManager !== expectedLane.packageManager || fixture.mode !== expectedLane.mode ||
    fixture.cleanEnvironment !== "VERIFIED" || fixture.generatedProject !== "VERIFIED" ||
    fixture.requestedEngine !== "latest" || fixture.resolvedCandidateVersion !== input.releaseVersion ||
    !Array.isArray(fixture.installedNativePackages) || !fixture.installedNativePackages.includes(expectedNative) ||
    fixture.expectedNativePackage !== expectedNative || fixture.actualLoadedNativePackage !== expectedNative ||
    fixture.actualLoadedArtifactSha256 !== native.addonSha256 || fixture.incompatibleSiblingLoaded !== false ||
    fixture.nativeImport !== "VERIFIED" || fixture.generatedTests !== "VERIFIED" ||
    typeof fixture.depsStoreHash !== "string" || !fixture.depsStoreHash ||
    fixture.lockfile !== expectedLockfile || fixture.firstRun !== "VERIFIED" ||
    fixture.nodeMajor !== expectedLane.nodeMajor || !String(fixture.nodePatch).startsWith(`${expectedLane.nodeMajor}.`)
  ) throw new Error(`${proof.lane.laneId} native consumption contract is incomplete`);
  validateNativeConsumption({
    packageManager: expectedLane.packageManager,
    installedNativePackages: fixture.installedNativePackages,
    expectedNativePackage: expectedNative,
    actualLoadedNativePackage: fixture.actualLoadedNativePackage,
    actualLoadedArtifactSha256: fixture.actualLoadedArtifactSha256,
    admittedArtifactSha256: native.addonSha256,
    incompatibleSiblingLoaded: fixture.incompatibleSiblingLoaded,
  });
  if (expectedLane.packageManager !== "yarn" && (
    fixture.installedNativePackages.length !== 1 || fixture.managerSpecificSingleExpectedPackageInstalled !== true
  )) throw new Error(`${proof.lane.laneId} lost npm/pnpm single-package corroboration`);
  if (expectedLane.packageManager === "yarn" && fixture.managerSpecificSingleExpectedPackageInstalled !== null) {
    throw new Error(`${proof.lane.laneId} incorrectly treats Yarn physical sibling filtering as authority`);
  }
  if (
    expectedLane.mode === "dev" && (
      fixture.devDependencyGraph?.status !== "VERIFIED" || fixture.devDependencyGraph?.html?.status !== 200 ||
      !fixture.devDependencyGraph?.sources?.some((source) => source.url === "/src/main.tsx" && source.status === 200) ||
      !fixture.devDependencyGraph?.dependencies?.some((dependency) =>
        dependency.status === 200 && dependency.cacheControl === "no-cache" && dependency.generation
      )
    )
  ) throw new Error(`${proof.lane.laneId} has no verified first-dev dependency graph`);
  if (!Array.isArray(proof.receiptIndex) || proof.receiptIndex.length !== (proof.browserSemanticProof ? 4 : 3)) {
    throw new Error(`${proof.lane.laneId} fact-specific receipt closure is incomplete`);
  }
  const laneFamilies = new Set();
  for (const item of proof.receiptIndex) {
    const receiptPath = path.resolve(path.dirname(proofFile), item.file);
    if (!fs.existsSync(receiptPath)) throw new Error(`${proof.lane.laneId} receipt is absent: ${item.file}`);
    const receipt = verifyReceipt(JSON.parse(fs.readFileSync(receiptPath, "utf8")));
    if (receipt.family !== item.family || receipt.factId !== item.factId || receipt.resultHash !== item.resultHash) {
      throw new Error(`${proof.lane.laneId} receipt index mismatch`);
    }
    laneFamilies.add(receipt.family);
    admittedReceipts.push({ receipt, file: receiptPath, owner: proof.lane.laneId });
  }
  for (const family of ["PF-NCONSUME", "PF-COMPAT", "PF-STARTUP"]) {
    if (!laneFamilies.has(family)) throw new Error(`${proof.lane.laneId} is missing ${family}`);
  }
  if (proof.browserSemanticProof) browserOwners.push({ proof: proof.browserSemanticProof, lane: expectedLane });
  consumers.set(proof.lane.laneId, { proof, proofFile, fixture });
}
const missingLanes = expectedLanes.filter((lane) => !consumers.has(lane.laneId)).map((lane) => lane.laneId);
if (missingLanes.length || consumers.size !== expectedLanes.length) {
  throw new Error(`split release proof requires exactly ${expectedLanes.length} causal lanes; missing: ${missingLanes.join(", ") || "none"}`);
}
const observedCoverage = auditConsumerCoverage([...consumers.values()].map(({ proof }) => proof.lane));
if (observedCoverage.status !== "VALID" || observedCoverage.matrixHash !== coverage.matrixHash) {
  throw new Error(`observed consumer coverage is invalid: ${observedCoverage.failures.join("; ")}`);
}

if (browserOwners.length !== 2 || ![22, 24].every((major) => browserOwners.some((owner) => owner.lane.nodeMajor === major))) {
  throw new Error("blocking browser proof requires exactly Linux x64 GNU Node22 and Node24 owners");
}
const chromiumRevisions = new Set();
for (const { proof: browser, lane } of browserOwners) {
  if (
    lane.target !== "linux-x64-gnu" || browser.kind !== "ionify.browser-dependency-generation-proof" ||
    browser.status !== "VERIFIED" || browser.execution !== "host Chromium semantic proof" ||
    browser.nodeMajor !== lane.nodeMajor || !browser.chromiumRevision ||
    !Array.isArray(browser.orders) || browser.orders.length !== 2
  ) throw new Error(`Node${lane.nodeMajor} browser semantic proof is unknown or incomplete`);
  chromiumRevisions.add(browser.chromiumRevision);
  for (const expectedOrder of [["pnpm", "npm"], ["npm", "pnpm"]]) {
    const order = browser.orders.find((item) => JSON.stringify(item.order) === JSON.stringify(expectedOrder));
    if (
      !order || order.status !== "VERIFIED" || order.browserContext !== "same-context" ||
      order.historicalContract?.status !== "PROVEN" ||
      order.currentContract?.generationBoundUrlsDiffer !== true ||
      order.currentContract?.noMixedSingletonGraph !== true || order.currentContract?.noUseContextFailure !== true ||
      order.currentContract?.noStaleWrapperReuse !== true || order.currentContract?.noDiskCacheReuse !== true ||
      order.currentContract?.noServiceWorkerReuse !== true || order.currentContract?.etagRevalidation !== true ||
      ![order.first, order.second].every((generation) =>
        generation?.etagRevalidation?.length > 0 && generation.etagRevalidation.every((receipt) =>
          receipt.status === 304 && receipt.requestedEtag === receipt.responseEtag && receipt.cacheControl === "no-cache"
        )
      )
    ) throw new Error(`Node${lane.nodeMajor} browser order ${expectedOrder.join(" -> ")} is incomplete`);
  }
}
if (chromiumRevisions.size !== 1) throw new Error("Node22/24 browser proofs used different Chromium revisions");

const abiParity = [];
for (const target of new Set(expectedLanes.map((lane) => lane.target))) {
  const proofs = [22, 24].map((nodeMajor) => {
    const lane = expectedLanes.find((item) => item.target === target && item.nodeMajor === nodeMajor && item.packageManager === "npm");
    return consumers.get(lane.laneId).fixture.nativeAbi;
  });
  abiParity.push({ packageTarget: target, ...assertNodeMajorAbiParity(proofs) });
}

for (const item of input.privateReceiptIndex) {
  const file = path.resolve(inputRoot, item.file);
  const receipt = verifyReceipt(JSON.parse(fs.readFileSync(file, "utf8")));
  admittedReceipts.push({ receipt, file, owner: item.packageTarget });
}
for (const item of [input.main.receipt, input.creator.receipt, input.goldenReceipt, input.boundaryReceipt, ...input.windowsReceiptIndex]) {
  const file = path.resolve(inputRoot, item.file);
  const receipt = verifyReceipt(JSON.parse(fs.readFileSync(file, "utf8")));
  admittedReceipts.push({ receipt, file, owner: "sealed-input" });
}
const receipts = admittedReceipts.map((item) => item.receipt);
validateSelectedReceipts({ ...classifier, requiredFamilies: classifier.requiredFamilies.filter((family) => family !== "PF-ENVELOPE") }, receipts);

const issuedAt = new Date();
const envelopeReceipt = buildEnvelopeReceipt({
  decision: classifier,
  receipts,
  authorityInputs: {
    releaseVersion: input.releaseVersion,
    enginePrivateGitSha: input.enginePrivateGitSha,
    creatorSourceGitSha: input.creatorSourceGitSha,
    candidateProofToolingPrivateGitSha: input.candidateProofToolingPrivateGitSha,
    publicProofToolingGitSha: publicProofToolingSha,
    publicCandidateGitSha: input.publicCandidateGitSha,
    publicationToolingGitSha: publicationToolingSha,
    publicReadmeSha256: input.publicReadmeSha256,
    matrixHash: coverage.matrixHash,
  },
  environment: {
    platform: process.platform,
    arch: process.arch,
    nodePatch: process.versions.node,
    napi: process.versions.napi ?? null,
    runner: process.env.RUNNER_NAME ?? "local",
  },
  provenance: {
    repository: process.env.GITHUB_REPOSITORY ?? "ionifyjs/ionify",
    gitSha: publicProofToolingSha,
    workflow: process.env.GITHUB_WORKFLOW ?? "local-release-authority",
    runId: process.env.GITHUB_RUN_ID ?? `local-${process.pid}`,
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? "1"),
    job: process.env.GITHUB_JOB ?? "aggregate-release-authority",
    attestations: [{ kind: "classifier-selected-exact-receipt-envelope", classifierDecisionHash: digestObject(classifier) }],
  },
  now: issuedAt,
});

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
function copy(sourceRoot, relative, destinationRelative, expected) {
  const source = path.resolve(sourceRoot, relative);
  if (expected && sha256(source) !== expected) throw new Error(`${relative} changed during aggregation`);
  const destination = path.join(outputRoot, destinationRelative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
copy(inputRoot, input.main.tarball, input.main.tarball, input.main.sha256);
copy(inputRoot, input.creator.tarball, input.creator.tarball, input.creator.sha256);
for (const native of input.natives) copy(inputRoot, native.tarball, native.tarball, native.sha256);
const receiptIndex = [];
for (let index = 0; index < admittedReceipts.length; index += 1) {
  const { receipt, file, owner } = admittedReceipts[index];
  const relative = path.posix.join("receipts", "children", `${String(index).padStart(3, "0")}-${receipt.family.toLowerCase()}-${path.basename(file)}`);
  copy(path.dirname(file), path.basename(file), relative, sha256(file));
  receiptIndex.push({ family: receipt.family, factId: receipt.factId, resultHash: receipt.resultHash, owner, file: relative, fileSha256: sha256(file) });
}
const envelopeReceiptPath = path.join(outputRoot, "receipts", "pf-envelope.json");
fs.mkdirSync(path.dirname(envelopeReceiptPath), { recursive: true });
fs.writeFileSync(envelopeReceiptPath, `${JSON.stringify(envelopeReceipt, null, 2)}\n`);

const envelope = {
  kind: "ionify.release-publication-proof",
  schemaVersion: 4,
  status: "VERIFIED_RELEASE_CANDIDATE",
  publicationAuthorized: false,
  topology: input.topology,
  releaseVersion: input.releaseVersion,
  identities: {
    enginePrivateGitSha: input.enginePrivateGitSha,
    creatorSourceGitSha: input.creatorSourceGitSha,
    candidateProofToolingPrivateGitSha: input.candidateProofToolingPrivateGitSha,
    publicProofToolingGitSha: publicProofToolingSha,
    publicCandidateGitSha: input.publicCandidateGitSha,
    publicationToolingGitSha: publicationToolingSha,
    publicReadmeSha256: input.publicReadmeSha256,
    mainSha256: input.main.sha256,
    creatorSha256: input.creator.sha256,
  },
  classifier: {
    decisionHash: digestObject(classifier),
    status: classifier.status,
    requiredFamilies: classifier.requiredFamilies,
    goldenReasons: classifier.goldenReasons,
  },
  receiptIndex: [...receiptIndex, {
    family: envelopeReceipt.family,
    factId: envelopeReceipt.factId,
    resultHash: envelopeReceipt.resultHash,
    owner: "aggregate",
    file: "receipts/pf-envelope.json",
    fileSha256: sha256(envelopeReceiptPath),
  }],
  causalCoverage: coverage,
  nativeAbiParity: abiParity,
  browserEvidence: {
    nodeMajors: browserOwners.map((owner) => owner.lane.nodeMajor).sort(),
    chromiumRevision: [...chromiumRevisions][0],
    ordersPerNode: 2,
  },
  yarnLibcEvidence: expectedLanes.filter((lane) => lane.packageManager === "yarn" && lane.target.startsWith("linux-"))
    .map((lane) => {
      const fixture = consumers.get(lane.laneId).fixture;
      return {
        laneId: lane.laneId,
        installedNativePackages: fixture.installedNativePackages,
        expectedNativePackage: fixture.expectedNativePackage,
        actualLoadedNativePackage: fixture.actualLoadedNativePackage,
        actualLoadedArtifactSha256: fixture.actualLoadedArtifactSha256,
        incompatibleSiblingLoaded: fixture.incompatibleSiblingLoaded,
      };
    }),
  windowsEvidence: input.windowsReceiptIndex.map((item) => ({ nodeMajor: item.nodeMajor, resultHash: item.resultHash })),
  goldenEquivalence: {
    status: "VERIFIED",
    receiptResultHash: verifyReceipt(JSON.parse(fs.readFileSync(path.resolve(inputRoot, input.goldenReceipt.file), "utf8"))).resultHash,
    causalCoverageHash: coverage.matrixHash,
  },
  artifacts: {
    main: input.main,
    creator: input.creator,
    natives: input.natives.map((native) => ({ packageTarget: native.packageTarget, packageName: native.packageName, tarball: native.tarball, sha256: native.sha256, addonSha256: native.addonSha256 })),
  },
  publicationOrder: [...input.natives.map((native) => native.packageName), "@ionify/ionify", "create-ionify"],
};
fs.writeFileSync(path.join(outputRoot, "release-proof.json"), `${JSON.stringify(envelope, null, 2)}\n`);
console.log(`[ionify-release] aggregated ${coverage.laneCount}-lane release authority at ${outputRoot}`);
