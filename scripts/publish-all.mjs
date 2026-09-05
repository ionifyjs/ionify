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
  if (head !== proof.publicCandidateGitSha) {
    throw new Error(`public checkout ${head} does not match approved candidate ${proof.publicCandidateGitSha}`);
  }
  const branch = run("git", ["branch", "--show-current"], { capture: true }).trim();
  if (branch && branch !== `release/${proof.releaseVersion}`) {
    throw new Error(`publish authority requires release/${proof.releaseVersion}; current branch is ${branch}`);
  }
}

function loadAndVerifyProof() {
  const proofPath = path.resolve(proofArg);
  const proofRoot = path.dirname(proofPath);
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  if (proof.kind !== "ionify.release-publication-proof" || proof.schemaVersion !== 1) {
    throw new Error("unknown release proof schema");
  }
  if (proof.status !== "VERIFIED_RELEASE_CANDIDATE") {
    throw new Error(`release proof status is ${proof.status ?? "missing"}`);
  }
  if (
    typeof proof.privateGitSha !== "string" || proof.privateGitSha.length < 7 ||
    typeof proof.publicCandidateGitSha !== "string" || proof.publicCandidateGitSha.length < 7
  ) {
    throw new Error("release proof lacks exact private/public source SHAs");
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
      targetProof.native?.sha256 !== native.sha256 ||
      targetProof.native?.addonSha256 !== native.addonSha256 ||
      targetProof.publicCandidateGitSha !== proof.publicCandidateGitSha
    ) {
      throw new Error(`${native.packageTarget} target proof is inconsistent`);
    }
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
  if (head !== proof.publicCandidateGitSha) {
    throw new Error(`contract-test checkout ${head} does not match candidate ${proof.publicCandidateGitSha}`);
  }
} else {
  assertCleanApprovedCheckout(proof);
}
const nativeArtifacts = artifacts.filter((artifact) => !artifact.main);
const mainArtifact = artifacts.find((artifact) => artifact.main);
for (const artifact of nativeArtifacts) await admitOrPublish(artifact);

if (dryRun) {
  await admitOrPublish(mainArtifact);
  console.log("[publish:all] dry-run complete; eight natives were checked before main and no package was published");
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
  if (!contractTest) {
    run(process.execPath, [
      path.join(repoRoot, "scripts", "real-registry-smoke.mjs"),
      "--version", proof.releaseVersion,
      "--registry", registry,
    ]);
  }
  console.log(`[publish:all] ${proof.releaseVersion} publication and real-registry smoke complete`);
}
