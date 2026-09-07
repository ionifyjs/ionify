import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const proofArg = arg("--proof", process.env.IONIFY_RELEASE_PROOF);
const registry = String(arg("--registry", "https://registry.npmjs.org")).replace(/\/+$/, "");
const tag = arg("--tag", "latest");
const dryRun = flag("--dry-run");
const contractTest = process.env.IONIFY_PUBLISH_CONTRACT_TEST === "1";
const npmExecutable = contractTest ? process.env.IONIFY_NPM_EXECUTABLE : "npm";
if (!proofArg) throw new Error("--proof <release-proof.json> (or IONIFY_RELEASE_PROOF) is required");
if (contractTest && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(registry)) {
  throw new Error("publication contract test mode is restricted to a loopback registry");
}
if (contractTest && !npmExecutable) throw new Error("IONIFY_NPM_EXECUTABLE is required in contract test mode");

const TARGETS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "win32-arm64-msvc",
  "win32-x64-msvc",
  "linux-arm64-gnu",
  "linux-x64-gnu",
  "linux-arm64-musl",
  "linux-x64-musl",
]);
const APPROVED_PUBLIC_CANDIDATE_SHA = "b7ca112537fc1b3562c6ce4f1503039292ee017b";
const APPROVED_README_SHA256 = "2dafbded98cbdd308c871e4427f46fff9219304361558020eac432864bc8b36c";
const APPROVED_ENGINE_SOURCE_SHA = "9395b846fd63d966720ca9ec336001d413a62b47";
const APPROVED_CREATOR_SOURCE_SHA = "343112837f8cae510b2dbe9c9a5a4585dc422bdf";
const APPROVED_CREATOR_SHA256 = "885c497705b858753db045812c24b208ab31fab51e09437529c763b23b04704c";
const APPROVED_TOOLING_FILES = new Set([
  "scripts/publish-all.mjs",
  "scripts/real-registry-smoke.mjs",
  "tests/publish-all.test.ts",
]);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stdout ?? ""}\n${result.stderr ?? ""}` : "";
    throw new Error(`${command} ${commandArgs.join(" ")} failed (${result.status})${details}`);
  }
  return result.stdout ?? "";
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function assertCleanApprovedCheckout(proof) {
  const status = run("git", ["status", "--porcelain"], { capture: true }).trim();
  if (status) throw new Error(`public release checkout is not clean:\n${status}`);
  const head = run("git", ["rev-parse", "HEAD"], { capture: true }).trim();
  if (head !== proof.publicationToolingGitSha) {
    throw new Error(`public checkout ${head} does not match approved publication tooling ${proof.publicationToolingGitSha}`);
  }
  const branch = run("git", ["branch", "--show-current"], { capture: true }).trim();
  if (branch && branch !== `release/${proof.releaseVersion}-publication`) {
    throw new Error(`publish authority requires release/${proof.releaseVersion}-publication; current branch is ${branch}`);
  }
  run("git", ["cat-file", "-e", `${proof.publicCandidateGitSha}^{commit}`], { capture: true });
  run("git", ["merge-base", "--is-ancestor", proof.publicCandidateGitSha, "HEAD"], { capture: true });
  const changed = run(
    "git",
    ["diff", "--name-only", `${proof.publicCandidateGitSha}..HEAD`],
    { capture: true },
  ).trim().split(/\r?\n/).filter(Boolean);
  const unexpected = changed.filter((file) => !APPROVED_TOOLING_FILES.has(file));
  if (unexpected.length > 0) {
    throw new Error(`publication tooling overlay changes frozen public content: ${unexpected.join(", ")}`);
  }
}

function assertManagerReceipts(targetProof, target) {
  if (!Array.isArray(targetProof.fixtureProofs)) {
    throw new Error(`${target} has no package-manager receipts`);
  }
  for (const manager of ["npm", "pnpm", "yarn"]) {
    for (const mode of ["build", "dev"]) {
      const receipt = targetProof.fixtureProofs.find(
        (item) => item.packageManager === manager && item.mode === mode,
      );
      if (
        !receipt ||
        receipt.generatedProject !== "VERIFIED" ||
        receipt.resolvedCandidateVersion !== targetProof.engineVersion ||
        receipt.selectedNativePackage !== `@ionify/ionify-${target}` ||
        receipt.nativeImport !== "VERIFIED" ||
        receipt.generatedTests !== "VERIFIED" ||
        receipt.firstRun !== "VERIFIED"
      ) {
        throw new Error(`${target} has incomplete ${manager}/${mode} receipt`);
      }
      if (
        mode === "dev" &&
        (
          receipt.devDependencyGraph?.status !== "VERIFIED" ||
          receipt.devDependencyGraph?.html?.status !== 200 ||
          !receipt.devDependencyGraph?.dependencies?.some(
            (item) => item.status === 200 && typeof item.generation === "string" && item.generation.length > 0,
          )
        )
      ) {
        throw new Error(`${target} has incomplete ${manager} dev graph receipt`);
      }
    }
  }
}

function loadAndVerifyProof() {
  const proofPath = path.resolve(proofArg);
  const proofRoot = path.dirname(proofPath);
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  if (proof.kind !== "ionify.release-publication-proof" || proof.schemaVersion !== 2) {
    throw new Error("unknown release proof schema");
  }
  if (proof.status !== "VERIFIED_RELEASE_CANDIDATE") {
    throw new Error(`release proof status is ${proof.status ?? "missing"}`);
  }
  if (
    !/^[0-9a-f]{40}$/.test(proof.enginePrivateGitSha) ||
    proof.privateGitSha !== proof.enginePrivateGitSha ||
    !/^[0-9a-f]{40}$/.test(proof.creatorSourceGitSha) ||
    proof.publicCandidateGitSha !== APPROVED_PUBLIC_CANDIDATE_SHA ||
    !/^[0-9a-f]{40}$/.test(proof.publicationToolingGitSha)
  ) {
    throw new Error("release proof lacks the exact engine/creator/public/tooling authorities");
  }
  if (
    !contractTest &&
    (
      proof.enginePrivateGitSha !== APPROVED_ENGINE_SOURCE_SHA ||
      proof.creatorSourceGitSha !== APPROVED_CREATOR_SOURCE_SHA ||
      proof.creator?.sha256 !== APPROVED_CREATOR_SHA256
    )
  ) {
    throw new Error("release proof does not match the admitted 0.1.37 + create 0.1.1 authorities");
  }
  if (
    proof.publicReadmeSha256 !== APPROVED_README_SHA256 ||
    sha256File(path.join(repoRoot, "README.md")) !== APPROVED_README_SHA256
  ) {
    throw new Error("public README does not match the frozen release authority");
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  if (packageJson.name !== "@ionify/ionify" || packageJson.version !== proof.releaseVersion) {
    throw new Error("public package identity/version does not match the release proof");
  }
  if (!Array.isArray(proof.natives) || proof.natives.length !== 8) {
    throw new Error("release proof must contain exactly eight native packages");
  }
  const receivedTargets = proof.natives.map((item) => item.packageTarget).sort();
  if (JSON.stringify(receivedTargets) !== JSON.stringify([...TARGETS].sort())) {
    throw new Error(`release proof target set is invalid: ${receivedTargets.join(", ")}`);
  }
  if (
    proof.browserSemanticProof?.status !== "VERIFIED" ||
    typeof proof.browserSemanticProof?.proof !== "string" ||
    typeof proof.browserSemanticProof?.sha256 !== "string"
  ) {
    throw new Error("release proof lacks the verified host-browser semantic proof");
  }
  const browserProofPath = path.resolve(proofRoot, proof.browserSemanticProof.proof);
  if (sha256File(browserProofPath) !== proof.browserSemanticProof.sha256) {
    throw new Error("host-browser semantic proof SHA mismatch");
  }
  const browserProof = JSON.parse(fs.readFileSync(browserProofPath, "utf8"));
  const browserOrders = new Set((browserProof.orders ?? []).map((item) => JSON.stringify(item.order)));
  if (
    browserProof.kind !== "ionify.browser-dependency-generation-proof" ||
    browserProof.status !== "VERIFIED" ||
    browserProof.execution !== "host Chromium semantic proof" ||
    !browserOrders.has(JSON.stringify(["npm", "pnpm"])) ||
    !browserOrders.has(JSON.stringify(["pnpm", "npm"])) ||
    !Array.isArray(browserProof.orders) ||
    browserProof.orders.some((item) =>
      item.status !== "VERIFIED" ||
      item.browserContext !== "same-context" ||
      item.currentContract?.noMixedSingletonGraph !== true ||
      item.currentContract?.noUseContextFailure !== true ||
      item.currentContract?.noStaleWrapperReuse !== true ||
      item.currentContract?.noDiskCacheReuse !== true ||
      item.currentContract?.noServiceWorkerReuse !== true ||
      item.currentContract?.etagRevalidation !== true ||
      ![item.first, item.second].every((generation) =>
        Array.isArray(generation?.etagRevalidation) &&
        generation.etagRevalidation.length > 0 &&
        generation.etagRevalidation.every((receipt) =>
          receipt.status === 304 &&
          receipt.requestedEtag === receipt.responseEtag &&
          receipt.cacheControl === "no-cache"
        )
      )
    )
  ) {
    throw new Error("host-browser semantic proof is incomplete");
  }
  if (
    proof.createVersion !== "0.1.1" ||
    proof.creator?.packageName !== "create-ionify" ||
    proof.creator?.version !== proof.createVersion ||
    proof.creator?.sourceGitSha !== proof.creatorSourceGitSha ||
    typeof proof.creator?.tarball !== "string" ||
    !/^[0-9a-f]{64}$/.test(proof.creator?.sha256)
  ) {
    throw new Error("release proof lacks the admitted packed creator identity");
  }
  const creatorTarball = path.resolve(proofRoot, proof.creator.tarball);
  if (sha256File(creatorTarball) !== proof.creator.sha256) {
    throw new Error("create-ionify tarball SHA does not match the release proof");
  }
  if (
    proof.creatorConsensus?.status !== "VERIFIED" ||
    proof.creatorConsensus?.targetCount !== 8 ||
    proof.creatorConsensus?.version !== proof.creator.version ||
    proof.creatorConsensus?.sourceGitSha !== proof.creator.sourceGitSha ||
    proof.creatorConsensus?.sha256 !== proof.creator.sha256
  ) {
    throw new Error("release proof lacks eight-target creator consensus");
  }
  const targets = new Set();
  const artifacts = [];
  for (const native of proof.natives) {
    if (!native.packageTarget || targets.has(native.packageTarget)) {
      throw new Error(`duplicate or missing native target: ${native.packageTarget}`);
    }
    targets.add(native.packageTarget);
    if (native.version !== proof.releaseVersion || native.targetProofStatus !== "VERIFIED") {
      throw new Error(`${native.packageTarget} lacks matching target-native proof`);
    }
    if (native.packageName !== `@ionify/ionify-${native.packageTarget}`) {
      throw new Error(`${native.packageTarget} package identity is invalid`);
    }
    for (const [label, audit] of [
      ["binary surface audit", native.binarySurfaceAudit],
      ["package surface audit", native.packageSurfaceAudit],
      ["private source audit", native.sourceAudit?.private],
      ["public source audit", native.sourceAudit?.public],
    ]) {
      if (audit?.status !== "VERIFIED") throw new Error(`${native.packageTarget} ${label} is not VERIFIED`);
    }
    if (packageJson.optionalDependencies?.[native.packageName] !== proof.releaseVersion) {
      throw new Error(`${native.packageName} is not an exact optional dependency`);
    }
    const nativePackage = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "native-packages", native.packageTarget, "package.json"), "utf8"),
    );
    if (nativePackage.name !== native.packageName || nativePackage.version !== proof.releaseVersion) {
      throw new Error(`${native.packageTarget} package metadata does not match the proof`);
    }
    const targetProofPath = path.resolve(proofRoot, native.targetProof);
    if (sha256File(targetProofPath) !== native.targetProofSha256) {
      throw new Error(`${native.packageTarget} target proof SHA mismatch`);
    }
    const targetProof = JSON.parse(fs.readFileSync(targetProofPath, "utf8"));
    if (
      targetProof.kind !== "ionify.native-target-release-proof" ||
      targetProof.status !== "VERIFIED" ||
      targetProof.packageTarget !== native.packageTarget ||
      targetProof.engineVersion !== proof.releaseVersion ||
      targetProof.privateGitSha !== proof.privateGitSha ||
      targetProof.enginePrivateGitSha !== proof.enginePrivateGitSha ||
      targetProof.creatorSourceGitSha !== proof.creatorSourceGitSha ||
      targetProof.creator?.version !== proof.creator.version ||
      targetProof.creator?.sourceGitSha !== proof.creator.sourceGitSha ||
      targetProof.creator?.sha256 !== proof.creator.sha256 ||
      targetProof.native?.sha256 !== native.sha256 ||
      targetProof.native?.addonSha256 !== native.addonSha256 ||
      targetProof.publicCandidateGitSha !== proof.publicCandidateGitSha ||
      targetProof.publicReadmeSha256 !== proof.publicReadmeSha256
    ) {
      throw new Error(`${native.packageTarget} target proof is inconsistent`);
    }
    assertManagerReceipts(targetProof, native.packageTarget);
    for (const [label, audit] of [
      ["target binary audit", targetProof.native?.binarySurfaceAudit],
      ["target package surface audit", targetProof.packageSurfaceAudit],
      ["target private source audit", targetProof.sourceAudit?.private],
      ["target public source audit", targetProof.sourceAudit?.public],
    ]) {
      if (audit?.status !== "VERIFIED") throw new Error(`${native.packageTarget} ${label} is not VERIFIED`);
    }
    const tarball = path.resolve(proofRoot, native.tarball);
    if (sha256File(tarball) !== native.sha256) {
      throw new Error(`${native.packageName} tarball SHA does not match the release proof`);
    }
    artifacts.push({ packageName: native.packageName, version: native.version, tarball, sha256: native.sha256 });
  }
  const mainTarball = path.resolve(proofRoot, proof.main.tarball);
  if (
    proof.main.packageName !== packageJson.name ||
    proof.main.version !== proof.releaseVersion ||
    sha256File(mainTarball) !== proof.main.sha256
  ) {
    throw new Error("main package artifact does not match the release proof");
  }
  artifacts.push({
    packageName: proof.main.packageName,
    version: proof.main.version,
    tarball: mainTarball,
    sha256: proof.main.sha256,
    main: true,
  });
  artifacts.push({
    packageName: proof.creator.packageName,
    version: proof.creator.version,
    tarball: creatorTarball,
    sha256: proof.creator.sha256,
    creator: true,
  });
  const expectedOrder = artifacts.map((item) => item.packageName);
  if (JSON.stringify(proof.publicationOrder) !== JSON.stringify(expectedOrder)) {
    throw new Error("release proof publication order is invalid");
  }
  return { proof, artifacts };
}

async function registryArtifact(packageName, version, { retryNotVisible = false } = {}) {
  const attempts = retryNotVisible ? 6 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const metadataUrl = `${registry}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;
    const metadataResponse = await fetch(metadataUrl, { headers: { accept: "application/json" } });
    if (metadataResponse.status === 404) {
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, contractTest ? 1 : 500 * (2 ** attempt)));
        continue;
      }
      return null;
    }
    if (!metadataResponse.ok) {
      throw new Error(`registry metadata ${packageName}@${version} returned ${metadataResponse.status}`);
    }
    const metadata = await metadataResponse.json();
    if (metadata.name !== packageName || metadata.version !== version) {
      throw new Error(`registry identity mismatch for ${packageName}@${version}`);
    }
    const tarballUrl = metadata?.dist?.tarball;
    if (typeof tarballUrl !== "string" || !tarballUrl) {
      throw new Error(`registry metadata for ${packageName}@${version} has no tarball`);
    }
    const tarballResponse = await fetch(tarballUrl);
    if (tarballResponse.status === 404 && attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, contractTest ? 1 : 500 * (2 ** attempt)));
      continue;
    }
    if (!tarballResponse.ok) {
      throw new Error(`registry tarball ${packageName}@${version} returned ${tarballResponse.status}`);
    }
    return {
      packageName: metadata.name,
      version: metadata.version,
      sha256: sha256Bytes(Buffer.from(await tarballResponse.arrayBuffer())),
      tarballUrl,
    };
  }
  return null;
}

function assertRegistryMatch(artifact, visible) {
  if (
    visible.packageName !== artifact.packageName ||
    visible.version !== artifact.version ||
    visible.sha256 !== artifact.sha256
  ) {
    throw new Error(
      `${artifact.packageName}@${artifact.version} already exists with immutable identity ` +
      `${visible.packageName}@${visible.version} SHA ${visible.sha256}; expected SHA ${artifact.sha256}`,
    );
  }
}

async function admitOrPublish(artifact) {
  const existing = await registryArtifact(artifact.packageName, artifact.version);
  if (existing) {
    assertRegistryMatch(artifact, existing);
    console.log(`[publish:all] admit existing ${artifact.packageName}@${artifact.version} (${artifact.sha256})`);
    return;
  }
  if (dryRun) {
    console.log(`[publish:all] dry-run would publish ${artifact.packageName}@${artifact.version}`);
    return;
  }
  run(npmExecutable, ["publish", artifact.tarball, "--access", "public", "--tag", tag, "--registry", registry]);
  const published = await registryArtifact(
    artifact.packageName,
    artifact.version,
    { retryNotVisible: true },
  );
  if (!published) throw new Error(`${artifact.packageName}@${artifact.version} was not visible after bounded retry`);
  assertRegistryMatch(artifact, published);
  console.log(`[publish:all] verified ${artifact.packageName}@${artifact.version}`);
}

const { proof, artifacts } = loadAndVerifyProof();
if (contractTest) {
  const head = run("git", ["rev-parse", "HEAD"], { capture: true }).trim();
  if (head !== proof.publicationToolingGitSha) {
    throw new Error(`contract-test checkout ${head} does not match tooling ${proof.publicationToolingGitSha}`);
  }
} else {
  assertCleanApprovedCheckout(proof);
}
const nativeArtifacts = artifacts.filter((artifact) => !artifact.main && !artifact.creator);
const mainArtifact = artifacts.find((artifact) => artifact.main);
const creatorArtifact = artifacts.find((artifact) => artifact.creator);
for (const artifact of nativeArtifacts) await admitOrPublish(artifact);

if (dryRun) {
  await admitOrPublish(mainArtifact);
  await admitOrPublish(creatorArtifact);
  console.log("[publish:all] dry-run complete; eight natives, main, and creator were checked in order and no package was published");
} else {
  for (const artifact of nativeArtifacts) {
    const visible = await registryArtifact(
      artifact.packageName,
      artifact.version,
      { retryNotVisible: true },
    );
    if (!visible) throw new Error(`main publication blocked: ${artifact.packageName} is not visible in the registry`);
    assertRegistryMatch(artifact, visible);
  }
  await admitOrPublish(mainArtifact);
  await admitOrPublish(creatorArtifact);
  if (!contractTest) {
    run(process.execPath, [
      path.join(repoRoot, "scripts", "real-registry-smoke.mjs"),
      "--version", proof.releaseVersion,
      "--creator-version", proof.creator.version,
      "--registry", registry,
    ]);
  }
  console.log(`[publish:all] ${proof.releaseVersion} publication and real-registry smoke complete`);
}
