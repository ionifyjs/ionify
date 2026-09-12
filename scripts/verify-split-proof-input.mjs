import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { verifyReceipt } from "./release-authority.mjs";

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
const normalizeMember = (relative) => {
  if (
    typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.includes("\\") ||
    relative.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) throw new Error(`unsafe proof-input path: ${relative}`);
  return relative;
};
const resolveFile = (relative) => {
  const member = normalizeMember(relative);
  const file = path.resolve(root, ...member.split("/"));
  if (path.relative(root, file).startsWith("..") || path.relative(root, file) === "") {
    throw new Error(`proof-input path escapes its root: ${relative}`);
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`proof-input member is not a regular file: ${relative}`);
  return file;
};
if (
  manifest.kind !== "ionify.split-release-proof-input" ||
  manifest.schemaVersion !== 2 ||
  manifest.status !== "VERIFIED" ||
  manifest.topology !== "split-private-build-public-consumer" ||
  manifest.releaseVersion !== "0.1.37" ||
  manifest.enginePrivateGitSha !== "f13e7fb6dbaf08df570f19aa2b4c2f75e33dc153" ||
  manifest.creatorSourceGitSha !== "343112837f8cae510b2dbe9c9a5a4585dc422bdf" ||
  !/^[0-9a-f]{40}$/.test(manifest.goldenProofToolingPrivateGitSha ?? "") ||
  !/^[0-9a-f]{40}$/.test(manifest.publicCandidateGitSha ?? "") ||
  manifest.publicReadmeSha256 !== "2dafbded98cbdd308c871e4427f46fff9219304361558020eac432864bc8b36c" ||
  !/^[0-9a-f]{64}$/.test(manifest.main?.sha256 ?? "") ||
  typeof manifest.main?.manifest !== "string" ||
  manifest.creator?.sha256 !== "885c497705b858753db045812c24b208ab31fab51e09437529c763b23b04704c" ||
  !/^[0-9a-f]{40}$/.test(manifest.candidateProofToolingPrivateGitSha ?? "") ||
  !Array.isArray(manifest.natives) || manifest.natives.length !== TARGETS.length ||
  !Array.isArray(manifest.privateReceiptIndex) || manifest.privateReceiptIndex.length !== TARGETS.length * 4 ||
  !Array.isArray(manifest.windowsReceiptIndex) || manifest.windowsReceiptIndex.length !== 2 ||
  !manifest.boundaryReceipt || !manifest.goldenReceipt || !manifest.classifierDecision
) {
  throw new Error("split proof input does not match the frozen 0.1.37 authority");
}
const mainReceipt = JSON.parse(fs.readFileSync(resolveFile(manifest.main.manifest), "utf8"));
if (
  mainReceipt.kind !== "ionify.main-release-candidate" || mainReceipt.schemaVersion !== 2 ||
  mainReceipt.status !== "VERIFIED" || mainReceipt.packageName !== "@ionify/ionify" ||
  mainReceipt.version !== manifest.releaseVersion ||
  mainReceipt.publicCandidateGitSha !== manifest.publicCandidateGitSha ||
  mainReceipt.publicReadmeSha256 !== manifest.publicReadmeSha256 ||
  mainReceipt.sha256 !== manifest.main.sha256 ||
  mainReceipt.tarball !== path.posix.basename(manifest.main.tarball)
) throw new Error("canonical main receipt disagrees with the sealed generation");
const mainFactReceipt = verifyReceipt(JSON.parse(fs.readFileSync(resolveFile(manifest.main.receipt?.file), "utf8")));
if (mainFactReceipt.family !== "PF-MAIN" || mainFactReceipt.resultHash !== manifest.main.receipt?.resultHash) {
  throw new Error("canonical PF-MAIN receipt disagrees with the sealed generation");
}
const creatorManifest = JSON.parse(fs.readFileSync(resolveFile(manifest.creator.manifest), "utf8"));
if (
  creatorManifest.kind !== "ionify.creator-release-candidate" || creatorManifest.status !== "VERIFIED" ||
  creatorManifest.version !== manifest.creator.version || creatorManifest.sha256 !== manifest.creator.sha256 ||
  creatorManifest.creatorSourceGitSha !== manifest.creatorSourceGitSha
) throw new Error("canonical creator manifest disagrees with the sealed generation");
const creatorFactReceipt = verifyReceipt(JSON.parse(fs.readFileSync(resolveFile(manifest.creator.receipt?.file), "utf8")));
if (creatorFactReceipt.family !== "PF-CREATOR" || creatorFactReceipt.resultHash !== manifest.creator.receipt?.resultHash) {
  throw new Error("canonical PF-CREATOR receipt disagrees with the sealed generation");
}
const classifierDecisionPath = resolveFile(manifest.classifierDecision.file);
if (sha256(classifierDecisionPath) !== manifest.classifierDecision.sha256) throw new Error("classifier decision hash mismatch");
const classifierDecision = JSON.parse(fs.readFileSync(classifierDecisionPath, "utf8"));
if (
  classifierDecision.kind !== "ionify.release-authority-classifier-decision" ||
  classifierDecision.goldenRequired !== true || !classifierDecision.requiredFamilies.includes("PF-GOLDEN")
) throw new Error("classifier decision does not require bootstrap GOLDEN");
const goldenFactReceipt = verifyReceipt(JSON.parse(fs.readFileSync(resolveFile(manifest.goldenReceipt.file), "utf8")));
if (goldenFactReceipt.family !== "PF-GOLDEN" || goldenFactReceipt.resultHash !== manifest.goldenReceipt.resultHash) {
  throw new Error("fresh bootstrap PF-GOLDEN receipt disagrees with the sealed generation");
}
const windowsMajors = new Set();
for (const item of manifest.windowsReceiptIndex) {
  const receipt = verifyReceipt(JSON.parse(fs.readFileSync(resolveFile(item.file), "utf8")));
  if (
    receipt.family !== "PF-WINPATH" || receipt.resultHash !== item.resultHash ||
    receipt.environment?.platform !== "win32" || receipt.environment?.arch !== "x64" ||
    receipt.environment?.nodeMajor !== item.nodeMajor
  ) throw new Error("PF-WINPATH receipt is divergent or not real Windows x64");
  windowsMajors.add(item.nodeMajor);
}
if (![22, 24].every((major) => windowsMajors.has(major))) throw new Error("PF-WINPATH requires Node22 and Node24");
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
    proof.kind !== "ionify.private-native-build-proof" || proof.schemaVersion !== 2 || proof.status !== "VERIFIED" ||
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
  const indexed = manifest.privateReceiptIndex.filter((item) => item.packageTarget === native.packageTarget);
  if (indexed.length !== 4 || !Array.isArray(proof.receiptIndex) || proof.receiptIndex.length !== 4) {
    throw new Error(`${native.packageTarget} fact-specific receipt closure is incomplete`);
  }
  const expectedFamilies = new Set(["PF-NBUILD", "PF-NREBUILD", "PF-NPACK", "PF-NSAN"]);
  for (const item of indexed) {
    const receiptPath = resolveFile(item.file);
    if (sha256(receiptPath) !== item.fileSha256) throw new Error(`${native.packageTarget} receipt file hash mismatch`);
    const receipt = verifyReceipt(JSON.parse(fs.readFileSync(receiptPath, "utf8")));
    if (
      receipt.family !== item.family || receipt.factId !== item.factId || receipt.resultHash !== item.resultHash ||
      receipt.authorityInputs?.packageTarget !== native.packageTarget || !expectedFamilies.delete(receipt.family)
    ) throw new Error(`${native.packageTarget} fact-specific receipt index is divergent`);
    const proofItem = proof.receiptIndex.find((candidate) => candidate.family === item.family);
    if (!proofItem || proofItem.factId !== item.factId || proofItem.resultHash !== item.resultHash) {
      throw new Error(`${native.packageTarget} monolithic diagnostic does not reference the admitted receipt`);
    }
  }
  if (expectedFamilies.size) throw new Error(`${native.packageTarget} receipt families are missing: ${[...expectedFamilies].join(", ")}`);
}
if (seen.size !== TARGETS.length) throw new Error("split proof input is missing a native target");

const boundaryReceiptPath = resolveFile(manifest.boundaryReceipt.file);
if (sha256(boundaryReceiptPath) !== manifest.boundaryReceipt.fileSha256) throw new Error("PF-BOUNDARY file hash mismatch");
const boundaryReceipt = verifyReceipt(JSON.parse(fs.readFileSync(boundaryReceiptPath, "utf8")));
if (boundaryReceipt.family !== "PF-BOUNDARY" || boundaryReceipt.resultHash !== manifest.boundaryReceipt.resultHash) {
  throw new Error("PF-BOUNDARY receipt identity mismatch");
}
const indexedResultHashes = manifest.privateReceiptIndex.map((item) => item.resultHash).sort();
if (JSON.stringify(boundaryReceipt.outputs?.privateReceiptResultHashes) !== JSON.stringify(indexedResultHashes)) {
  throw new Error("PF-BOUNDARY does not close over the private receipt index");
}

const expectedMembers = new Set([
  "split-proof-input.json",
  normalizeMember(manifest.main.manifest),
  normalizeMember(manifest.main.receipt.file),
  normalizeMember(manifest.main.tarball),
  normalizeMember(manifest.creator.tarball),
  normalizeMember(manifest.creator.manifest),
  normalizeMember(manifest.creator.receipt.file),
  normalizeMember(manifest.classifierDecision.file),
  normalizeMember(manifest.goldenReceipt.file),
  ...manifest.natives.flatMap((native) => [
    normalizeMember(native.tarball),
    normalizeMember(native.privateBuildProof),
  ]),
  ...manifest.privateReceiptIndex.map((item) => normalizeMember(item.file)),
  ...manifest.windowsReceiptIndex.map((item) => normalizeMember(item.file)),
  normalizeMember(manifest.boundaryReceipt.file),
]);
const actualMembers = [];
function inventory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`proof input contains a symbolic link: ${relative}`);
    if (stat.isDirectory()) inventory(absolute);
    else if (stat.isFile()) actualMembers.push(relative);
    else throw new Error(`proof input contains a non-file member: ${relative}`);
  }
}
inventory(root);
const unexpected = actualMembers.filter((member) => !expectedMembers.has(member));
const absent = [...expectedMembers].filter((member) => !actualMembers.includes(member));
if (unexpected.length || absent.length || actualMembers.length !== expectedMembers.size) {
  throw new Error(
    `proof input inventory is not sealed; unexpected: ${unexpected.join(", ") || "none"}; ` +
    `missing: ${absent.join(", ") || "none"}`,
  );
}
console.log(`[ionify-release] verified sealed split-proof input ${manifest.candidateProofToolingPrivateGitSha}`);
