import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const TARGETS = Object.freeze([
  "darwin-arm64", "darwin-x64", "win32-arm64-msvc", "win32-x64-msvc",
  "linux-arm64-gnu", "linux-x64-gnu", "linux-arm64-musl", "linux-x64-musl",
]);
const TARGET_METADATA = Object.freeze({
  "darwin-arm64": ["darwin", "arm64", null],
  "darwin-x64": ["darwin", "x64", null],
  "win32-arm64-msvc": ["win32", "arm64", null],
  "win32-x64-msvc": ["win32", "x64", null],
  "linux-arm64-gnu": ["linux", "arm64", "glibc"],
  "linux-x64-gnu": ["linux", "x64", "glibc"],
  "linux-arm64-musl": ["linux", "arm64", "musl"],
  "linux-x64-musl": ["linux", "x64", "musl"],
});
const root = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("proof input directory is required");
const manifestPath = path.join(root, "split-proof-input.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const resolveFile = (relative) => {
  if (!relative || path.isAbsolute(relative)) throw new Error(`unsafe proof-input path: ${relative}`);
  const file = path.resolve(root, relative);
  if (path.relative(root, file).startsWith("..") || path.relative(root, file) === "") {
    throw new Error(`proof-input path escapes its root: ${relative}`);
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`proof-input member is not a regular file: ${relative}`);
  return file;
};
if (
  manifest.kind !== "ionify.split-release-proof-input" ||
  manifest.schemaVersion !== 1 ||
  manifest.status !== "VERIFIED" ||
  manifest.topology !== "split-private-build-public-consumer" ||
  manifest.releaseVersion !== "0.1.37" ||
  manifest.enginePrivateGitSha !== "036adaead64d049ae6a616c7962c54baa6d46bb4" ||
  manifest.creatorSourceGitSha !== "343112837f8cae510b2dbe9c9a5a4585dc422bdf" ||
  manifest.goldenProofToolingPrivateGitSha !== "aea1c186166953ac7fd2221cf0a9e67ea18dbcd1" ||
  manifest.publicCandidateGitSha !== "1554c44d54fe37a834c8c6452f35600b1de801aa" ||
  manifest.publicReadmeSha256 !== "2dafbded98cbdd308c871e4427f46fff9219304361558020eac432864bc8b36c" ||
  manifest.main?.sha256 !== "781e066d4d664b8489ba39e1f7b864791123e2fa4dd9df06c15b4c11b088934e" ||
  manifest.creator?.sha256 !== "885c497705b858753db045812c24b208ab31fab51e09437529c763b23b04704c" ||
  !/^[0-9a-f]{40}$/.test(manifest.candidateProofToolingPrivateGitSha ?? "") ||
  !Array.isArray(manifest.natives) || manifest.natives.length !== TARGETS.length
) {
  throw new Error("split proof input does not match the frozen 0.1.37 authority");
}
for (const [relative, expected] of [
  [manifest.main.tarball, manifest.main.sha256],
  [manifest.creator.tarball, manifest.creator.sha256],
]) {
  if (sha256(resolveFile(relative)) !== expected) throw new Error(`${relative} hash mismatch`);
}
const seen = new Set();
for (const native of manifest.natives) {
  if (
    !TARGETS.includes(native.packageTarget) || seen.has(native.packageTarget) ||
    native.packageName !== `@ionify/ionify-${native.packageTarget}` ||
    native.version !== manifest.releaseVersion ||
    !/^[0-9a-f]{64}$/.test(native.sha256 ?? "") ||
    !/^[0-9a-f]{64}$/.test(native.addonSha256 ?? "") ||
    !/^[0-9a-f]{64}$/.test(native.privateBuildProofSha256 ?? "")
  ) throw new Error(`invalid native identity: ${native.packageTarget}`);
  seen.add(native.packageTarget);
  if (sha256(resolveFile(native.tarball)) !== native.sha256) throw new Error(`${native.packageTarget} tarball hash mismatch`);
  const proofPath = resolveFile(native.privateBuildProof);
  if (sha256(proofPath) !== native.privateBuildProofSha256) throw new Error(`${native.packageTarget} build proof hash mismatch`);
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  const [platform, arch, libc] = TARGET_METADATA[native.packageTarget];
  if (
    proof.kind !== "ionify.private-native-build-proof" || proof.status !== "VERIFIED" ||
    proof.packageTarget !== native.packageTarget || proof.enginePrivateGitSha !== manifest.enginePrivateGitSha ||
    proof.creatorSourceGitSha !== manifest.creatorSourceGitSha ||
    proof.proofToolingPrivateGitSha !== manifest.candidateProofToolingPrivateGitSha ||
    proof.publicCandidateGitSha !== manifest.publicCandidateGitSha ||
    proof.native?.sha256 !== native.sha256 || proof.native?.addonSha256 !== native.addonSha256 ||
    proof.native?.isolatedNativeImport !== "VERIFIED" ||
    proof.native?.binarySurfaceAudit?.status !== "VERIFIED" || proof.buildAuthority?.status !== "VERIFIED" ||
    proof.host?.platform !== platform || proof.host?.arch !== arch || proof.host?.target !== native.packageTarget ||
    proof.native?.os?.[0] !== platform || proof.native?.cpu?.[0] !== arch ||
    (proof.native?.libc?.[0] ?? null) !== libc ||
    (native.packageTarget.startsWith("win32-") && proof.buildAuthority?.windowsNamespaceBehavior !== "VERIFIED")
  ) throw new Error(`${native.packageTarget} private build proof is incomplete or divergent`);
}
if (seen.size !== TARGETS.length) throw new Error("split proof input is missing a native target");
console.log(`[ionify-release] verified sealed split-proof input ${manifest.candidateProofToolingPrivateGitSha}`);
