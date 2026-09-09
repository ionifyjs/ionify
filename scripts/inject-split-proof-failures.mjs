import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const sourceInput = path.resolve(arg("--input") ?? "");
const sourceConsumers = path.resolve(arg("--consumers") ?? "");
const outputPath = path.resolve(arg("--output") ?? "");
const publicProofToolingSha = arg("--public-proof-tooling-sha");
const publicationToolingSha = arg("--publication-tooling-sha");
if (
  !arg("--input") || !arg("--consumers") || !arg("--output") ||
  !publicProofToolingSha || !publicationToolingSha
) {
  throw new Error("all failure-injection paths and tooling SHAs are required");
}
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
function walk(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else files.push(absolute);
  }
  return files;
}
const one = (root, pattern) => {
  const matches = walk(root).filter((file) => pattern.test(path.basename(file)));
  if (matches.length !== 1) throw new Error(`fixture lookup expected one ${pattern}; received ${matches.length}`);
  return matches[0];
};
function aggregate(root) {
  return spawnSync(process.execPath, [
    path.join(toolingRoot, "scripts", "aggregate-split-release-proofs.mjs"),
    "--input", path.join(root, "input"),
    "--consumers", path.join(root, "consumers"),
    "--output", path.join(root, "aggregate"),
    "--public-proof-tooling-sha", publicProofToolingSha,
    "--publication-tooling-sha", publicationToolingSha,
  ], { encoding: "utf8", stdio: "pipe" });
}
function verify(root) {
  return spawnSync(process.execPath, [
    path.join(toolingRoot, "scripts", "verify-split-proof-input.mjs"),
    path.join(root, "input"),
  ], { encoding: "utf8", stdio: "pipe" });
}

const cases = [
  {
    name: "unexpected-proof-input-member",
    mutate(root) {
      fs.writeFileSync(path.join(root, "input", "unsealed-private-material.txt"), "must not cross boundary\n");
    },
    run: verify,
  },
  {
    name: "wrong-native-package",
    mutate(root) {
      const file = one(path.join(root, "consumers"), /^consumer-proof-darwin-arm64\.json$/);
      const proof = readJson(file);
      proof.fixtureProofs[0].selectedNativePackage = "@ionify/ionify-darwin-x64";
      writeJson(file, proof);
    },
    run: aggregate,
  },
  {
    name: "wrong-architecture-metadata",
    mutate(root) {
      const inputPath = path.join(root, "input", "split-proof-input.json");
      const input = readJson(inputPath);
      const native = input.natives.find((item) => item.packageTarget === "darwin-arm64");
      const proofPath = path.join(root, "input", native.privateBuildProof);
      const proof = readJson(proofPath);
      proof.host.arch = "x64";
      writeJson(proofPath, proof);
      native.privateBuildProofSha256 = sha256(proofPath);
      writeJson(inputPath, input);
    },
    run: verify,
  },
  {
    name: "corrupt-native-addon-package",
    mutate(root) {
      const input = readJson(path.join(root, "input", "split-proof-input.json"));
      fs.appendFileSync(path.join(root, "input", input.natives[0].tarball), "corrupt");
    },
    run: verify,
  },
  {
    name: "creator-tarball-mismatch",
    mutate(root) {
      const input = readJson(path.join(root, "input", "split-proof-input.json"));
      fs.appendFileSync(path.join(root, "input", input.creator.tarball), "corrupt");
    },
    run: verify,
  },
  {
    name: "canonical-main-tarball-mismatch",
    mutate(root) {
      const input = readJson(path.join(root, "input", "split-proof-input.json"));
      fs.appendFileSync(path.join(root, "input", input.main.tarball), "corrupt");
    },
    run: verify,
  },
  {
    name: "missing-private-proof-receipt",
    mutate(root) {
      const input = readJson(path.join(root, "input", "split-proof-input.json"));
      fs.rmSync(path.join(root, "input", input.natives[0].privateBuildProof));
    },
    run: verify,
  },
  {
    name: "readme-identity-mismatch",
    mutate(root) {
      const file = path.join(root, "input", "split-proof-input.json");
      const input = readJson(file);
      input.publicReadmeSha256 = "0".repeat(64);
      writeJson(file, input);
    },
    run: verify,
  },
  {
    name: "stale-generation-identity",
    mutate(root) {
      const file = one(path.join(root, "consumers"), /^consumer-proof-linux-x64-gnu\.json$/);
      const proof = readJson(file);
      proof.candidateProofToolingPrivateGitSha = "0".repeat(40);
      writeJson(file, proof);
    },
    run: aggregate,
  },
  {
    name: "browser-stale-cache-reuse",
    mutate(root) {
      const file = one(path.join(root, "consumers"), /^consumer-proof-linux-x64-gnu\.json$/);
      const proof = readJson(file);
      proof.browserSemanticProof.orders[0].currentContract.noDiskCacheReuse = false;
      writeJson(file, proof);
    },
    run: aggregate,
  },
  {
    name: "windows-namespace-regression",
    mutate(root) {
      const inputPath = path.join(root, "input", "split-proof-input.json");
      const input = readJson(inputPath);
      const native = input.natives.find((item) => item.packageTarget === "win32-x64-msvc");
      const proofPath = path.join(root, "input", native.privateBuildProof);
      const proof = readJson(proofPath);
      proof.buildAuthority.windowsNamespaceBehavior = "FAILED";
      writeJson(proofPath, proof);
      native.privateBuildProofSha256 = sha256(proofPath);
      writeJson(inputPath, input);
    },
    run: verify,
  },
  {
    name: "musl-cleanliness-regression",
    mutate(root) {
      const inputPath = path.join(root, "input", "split-proof-input.json");
      const input = readJson(inputPath);
      const native = input.natives.find((item) => item.packageTarget === "linux-x64-musl");
      const proofPath = path.join(root, "input", native.privateBuildProof);
      const proof = readJson(proofPath);
      proof.native.binarySurfaceAudit.status = "FAILED";
      writeJson(proofPath, proof);
      native.privateBuildProofSha256 = sha256(proofPath);
      writeJson(inputPath, input);
    },
    run: verify,
  },
];

const results = [];
for (const injection of cases) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ionify-failure-${injection.name}-`));
  try {
    fs.cpSync(sourceInput, path.join(root, "input"), { recursive: true });
    fs.cpSync(sourceConsumers, path.join(root, "consumers"), { recursive: true });
    injection.mutate(root);
    const result = injection.run(root);
    const rejected = result.status !== 0 && !fs.existsSync(path.join(root, "aggregate", "release-proof.json"));
    if (!rejected) throw new Error(`${injection.name} did not fail closed`);
    results.push({ name: injection.name, status: "REJECTED_AS_REQUIRED" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const report = {
  kind: "ionify.split-release-failure-injection-proof",
  schemaVersion: 1,
  status: "VERIFIED",
  injections: results,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
writeJson(outputPath, report);
console.log(`[ionify-release] ${results.length} split-proof failure injections rejected as required`);
