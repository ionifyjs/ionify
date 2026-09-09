import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TARGETS = Object.freeze([
  "darwin-arm64", "darwin-x64", "win32-arm64-msvc", "win32-x64-msvc",
  "linux-arm64-gnu", "linux-x64-gnu", "linux-arm64-musl", "linux-x64-musl",
]);
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
  encoding: "utf8", stdio: "pipe",
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
const consumerFiles = walk(consumersRoot).filter((file) => /^consumer-proof-.+\.json$/.test(path.basename(file)));
const consumers = new Map();
let browserOwner;
for (const proofFile of consumerFiles) {
  const proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
  if (
    proof.kind !== "ionify.public-target-consumer-proof" || proof.schemaVersion !== 1 ||
    proof.status !== "VERIFIED" || proof.topology !== input.topology ||
    !TARGETS.includes(proof.packageTarget) || consumers.has(proof.packageTarget)
  ) throw new Error(`unknown, duplicate, or unverified consumer proof: ${proofFile}`);
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
  ) throw new Error(`${proof.packageTarget} consumer proof disagrees with the sealed generation`);
  const native = input.natives.find((item) => item.packageTarget === proof.packageTarget);
  if (
    proof.artifacts?.mainSha256 !== input.main.sha256 ||
    proof.artifacts?.creatorSha256 !== input.creator.sha256 ||
    proof.artifacts?.nativeSha256 !== native.sha256 ||
    proof.artifacts?.addonSha256 !== native.addonSha256 ||
    proof.artifacts?.privateBuildProofSha256 !== native.privateBuildProofSha256
  ) throw new Error(`${proof.packageTarget} consumer artifact identities diverge`);
  if (!Array.isArray(proof.fixtureProofs)) throw new Error(`${proof.packageTarget} has no fixture proofs`);
  for (const manager of ["npm", "pnpm", "yarn"]) {
    for (const mode of ["build", "dev"]) {
      const receipt = proof.fixtureProofs.find((item) => item.packageManager === manager && item.mode === mode);
      const expectedLockfile = manager === "npm" ? "package-lock.json" : manager === "pnpm" ? "pnpm-lock.yaml" : "yarn.lock";
      if (
        !receipt || receipt.cleanEnvironment !== "VERIFIED" || receipt.generatedProject !== "VERIFIED" ||
        receipt.requestedEngine !== "latest" || receipt.resolvedCandidateVersion !== input.releaseVersion ||
        receipt.selectedNativePackage !== `@ionify/ionify-${proof.packageTarget}` ||
        receipt.nativeImport !== "VERIFIED" || receipt.generatedTests !== "VERIFIED" ||
        typeof receipt.depsStoreHash !== "string" || !receipt.depsStoreHash ||
        receipt.lockfile !== expectedLockfile || receipt.firstRun !== "VERIFIED"
      ) throw new Error(`${proof.packageTarget} has incomplete ${manager}/${mode} evidence`);
      if (
        mode === "dev" && (
          receipt.devDependencyGraph?.status !== "VERIFIED" || receipt.devDependencyGraph?.html?.status !== 200 ||
          !receipt.devDependencyGraph?.sources?.some((source) => source.url === "/src/main.tsx" && source.status === 200) ||
          !receipt.devDependencyGraph?.dependencies?.some((dependency) =>
            dependency.status === 200 && dependency.cacheControl === "no-cache" && dependency.generation
          )
        )
      ) throw new Error(`${proof.packageTarget} has no verified ${manager} dev graph`);
    }
  }
  if (proof.browserSemanticProof) {
    if (browserOwner) throw new Error("candidate proof has more than one browser authority");
    browserOwner = { target: proof.packageTarget, proof: proof.browserSemanticProof };
  }
  consumers.set(proof.packageTarget, { proof, proofFile });
}
const missing = TARGETS.filter((target) => !consumers.has(target));
if (missing.length || consumers.size !== TARGETS.length) {
  throw new Error(`split release proof requires exactly eight consumer targets; missing: ${missing.join(", ") || "none"}`);
}
if (browserOwner?.target !== "linux-x64-gnu") throw new Error("linux-x64-gnu must own the single browser semantic proof");
const browser = browserOwner.proof;
if (
  browser.kind !== "ionify.browser-dependency-generation-proof" || browser.status !== "VERIFIED" ||
  browser.execution !== "host Chromium semantic proof" || !Array.isArray(browser.orders) || browser.orders.length !== 2
) throw new Error("browser semantic proof is unknown or incomplete");
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
  ) throw new Error(`browser order ${expectedOrder.join(" -> ")} is incomplete`);
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
function copy(relativeSourceRoot, relative, destinationRelative, expected) {
  const source = path.resolve(relativeSourceRoot, relative);
  if (expected && sha256(source) !== expected) throw new Error(`${relative} changed during aggregation`);
  const destination = path.join(outputRoot, destinationRelative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
copy(inputRoot, input.main.tarball, input.main.tarball, input.main.sha256);
copy(inputRoot, input.creator.tarball, input.creator.tarball, input.creator.sha256);
const natives = [];
for (const native of input.natives) {
  const consumer = consumers.get(native.packageTarget);
  copy(inputRoot, native.tarball, native.tarball, native.sha256);
  copy(inputRoot, native.privateBuildProof, native.privateBuildProof, native.privateBuildProofSha256);
  const consumerRelative = path.join("public-proofs", path.basename(consumer.proofFile));
  copy(consumersRoot, path.relative(consumersRoot, consumer.proofFile), consumerRelative, sha256(consumer.proofFile));
  natives.push({
    ...native,
    publicConsumerProof: consumerRelative,
    publicConsumerProofSha256: sha256(consumer.proofFile),
    privateBuildStatus: "VERIFIED",
    publicConsumerStatus: "VERIFIED",
  });
}
const browserPath = path.join("public-proofs", "browser-generation-proof.json");
fs.writeFileSync(path.join(outputRoot, browserPath), `${JSON.stringify(browser, null, 2)}\n`);

const envelope = {
  kind: "ionify.release-publication-proof",
  schemaVersion: 3,
  status: "VERIFIED_RELEASE_CANDIDATE",
  topology: input.topology,
  releaseVersion: input.releaseVersion,
  enginePrivateGitSha: input.enginePrivateGitSha,
  creatorSourceGitSha: input.creatorSourceGitSha,
  goldenProofToolingPrivateGitSha: input.goldenProofToolingPrivateGitSha,
  candidateProofToolingPrivateGitSha: input.candidateProofToolingPrivateGitSha,
  publicProofToolingGitSha: publicProofToolingSha,
  publicCandidateGitSha: input.publicCandidateGitSha,
  publicationToolingGitSha: publicationToolingSha,
  publicReadmeSha256: input.publicReadmeSha256,
  main: { packageName: "@ionify/ionify", version: input.releaseVersion, ...input.main },
  creator: { packageName: "create-ionify", ...input.creator, sourceGitSha: input.creatorSourceGitSha },
  browserSemanticProof: {
    status: "VERIFIED", execution: browser.execution, ownerTarget: browserOwner.target,
    proof: browserPath, sha256: sha256(path.join(outputRoot, browserPath)),
  },
  natives,
  packageManagerReceipts: TARGETS.map((target) => ({
    packageTarget: target,
    receipts: consumers.get(target).proof.fixtureProofs,
  })),
  crossTargetConsensus: {
    status: "VERIFIED", targetCount: TARGETS.length, targets: [...TARGETS],
    identities: {
      releaseVersion: input.releaseVersion, enginePrivateGitSha: input.enginePrivateGitSha,
      creatorSourceGitSha: input.creatorSourceGitSha, publicCandidateGitSha: input.publicCandidateGitSha,
      publicReadmeSha256: input.publicReadmeSha256, mainSha256: input.main.sha256,
      creatorSha256: input.creator.sha256,
    },
  },
  publicationOrder: [
    ...natives.map((native) => native.packageName), "@ionify/ionify", "create-ionify",
  ],
};
fs.writeFileSync(path.join(outputRoot, "release-proof.json"), `${JSON.stringify(envelope, null, 2)}\n`);
console.log(`[ionify-release] aggregated split release proof at ${outputRoot}`);
