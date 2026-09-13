import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const version = "0.1.37";
const targets = [
  "darwin-arm64", "darwin-x64", "win32-arm64-msvc", "win32-x64-msvc",
  "linux-arm64-gnu", "linux-x64-gnu", "linux-arm64-musl", "linux-x64-musl",
];
const roots: string[] = [];
const sha256 = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");

type Artifact = { packageName: string; version: string; tarball: string; bytes: Buffer; sha256: string; main?: boolean };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-publish-contract-"));
  roots.push(root);
  const privateGitSha = "private-source-sha-0137";
  const publicCandidateGitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const proofRoot = path.join(root, "candidate");
  fs.mkdirSync(path.join(proofRoot, "native"), { recursive: true });
  fs.mkdirSync(path.join(proofRoot, "main"), { recursive: true });
  fs.mkdirSync(path.join(proofRoot, "proofs"), { recursive: true });
  const artifacts: Artifact[] = [];
  const natives = targets.map((target) => {
    const packageName = `@ionify/ionify-${target}`;
    const tarball = path.join(proofRoot, "native", `${target}-${version}.tgz`);
    const bytes = Buffer.from(`native:${target}:${version}`);
    fs.writeFileSync(tarball, bytes);
    const targetProofPath = path.join(proofRoot, "proofs", `release-proof-${target}.json`);
    const targetProof = {
      kind: "ionify.native-target-release-proof",
      status: "VERIFIED",
      packageTarget: target,
      engineVersion: version,
      privateGitSha,
      publicCandidateGitSha,
      sourceAudit: { private: { status: "VERIFIED" }, public: { status: "VERIFIED" } },
      packageSurfaceAudit: { status: "VERIFIED" },
      native: {
        sha256: sha256(bytes),
        addonSha256: `addon-${target}`,
        binarySurfaceAudit: { status: "VERIFIED" },
      },
    };
    fs.writeFileSync(targetProofPath, `${JSON.stringify(targetProof, null, 2)}\n`);
    artifacts.push({ packageName, version, tarball, bytes, sha256: sha256(bytes) });
    return {
      packageTarget: target,
      packageName,
      version,
      tarball: path.relative(proofRoot, tarball),
      sha256: sha256(bytes),
      addonSha256: `addon-${target}`,
      binarySurfaceAudit: { status: "VERIFIED" },
      packageSurfaceAudit: { status: "VERIFIED" },
      sourceAudit: { private: { status: "VERIFIED" }, public: { status: "VERIFIED" } },
      targetProof: path.relative(proofRoot, targetProofPath),
      targetProofSha256: sha256(fs.readFileSync(targetProofPath)),
      targetProofStatus: "VERIFIED",
    };
  });
  const mainTarball = path.join(proofRoot, "main", `ionify-${version}.tgz`);
  const mainBytes = Buffer.from(`main:${version}`);
  fs.writeFileSync(mainTarball, mainBytes);
  artifacts.push({ packageName: "@ionify/ionify", version, tarball: mainTarball, bytes: mainBytes, sha256: sha256(mainBytes), main: true });
  const browserPath = path.join(proofRoot, "proofs", "browser-generation-proof.json");
  fs.writeFileSync(browserPath, `${JSON.stringify({ kind: "ionify.browser-dependency-generation-proof", status: "VERIFIED" })}\n`);
  const proof = {
    kind: "ionify.release-publication-proof",
    schemaVersion: 1,
    status: "VERIFIED_RELEASE_CANDIDATE",
    releaseVersion: version,
    privateGitSha,
    publicCandidateGitSha,
    browserSemanticProof: {
      status: "VERIFIED",
      proof: path.relative(proofRoot, browserPath),
      sha256: sha256(fs.readFileSync(browserPath)),
    },
    main: {
      packageName: "@ionify/ionify",
      version,
      tarball: path.relative(proofRoot, mainTarball),
      sha256: sha256(mainBytes),
    },
    natives,
    publicationOrder: [...natives.map((item) => item.packageName), "@ionify/ionify"],
  };
  const proofPath = path.join(proofRoot, "release-proof.json");
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  return { root, proofRoot, proofPath, proof, artifacts };
}

function writeProof(proofPath: string, proof: unknown) {
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
}

async function registryHarness(fixtureValue: ReturnType<typeof fixture>) {
  const visible = new Map<string, Artifact>();
  const requests = new Map<string, number>();
  const published: string[] = [];
  const delayed = new Map<string, number>();
  const dropped = new Set<string>();
  const byFile = new Map(fixtureValue.artifacts.map((item) => [path.basename(item.tarball), item]));
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__publish" && request.method === "POST") {
      const artifact = byFile.get(url.searchParams.get("file") ?? "");
      if (!artifact) { response.writeHead(404).end(); return; }
      published.push(artifact.packageName);
      if (!dropped.has(artifact.packageName)) visible.set(artifact.packageName, artifact);
      response.writeHead(204).end();
      return;
    }
    if (url.pathname.startsWith("/tarballs/")) {
      const packageName = decodeURIComponent(url.pathname.slice("/tarballs/".length, -4));
      const artifact = visible.get(packageName);
      if (!artifact) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "application/octet-stream" }).end(artifact.bytes);
      return;
    }
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)$/);
    if (!match) { response.writeHead(404).end(); return; }
    const packageName = decodeURIComponent(match[1]);
    const requestedVersion = decodeURIComponent(match[2]);
    requests.set(packageName, (requests.get(packageName) ?? 0) + 1);
    const remaining = delayed.get(packageName) ?? 0;
    if (remaining > 0) {
      delayed.set(packageName, remaining - 1);
      response.writeHead(404).end();
      return;
    }
    const artifact = visible.get(packageName);
    if (!artifact) { response.writeHead(404).end(); return; }
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      name: packageName,
      version: requestedVersion,
      dist: { tarball: `${base}/tarballs/${encodeURIComponent(packageName)}.tgz` },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const registry = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const fakeNpm = path.join(fixtureValue.root, "fake-npm.mjs");
  fs.writeFileSync(fakeNpm, `#!/usr/bin/env node
const args = process.argv.slice(2);
const tarball = args[1];
const registry = args[args.indexOf("--registry") + 1];
const response = await fetch(registry + "/__publish?file=" + encodeURIComponent(tarball.split(/[\\\\/]/).at(-1)), { method: "POST" });
if (!response.ok) process.exit(1);
`);
  fs.chmodSync(fakeNpm, 0o755);
  return { server, registry, visible, requests, published, delayed, dropped, fakeNpm };
}

async function runPublish(
  proofPath: string,
  registry: string,
  options: { dryRun?: boolean; fakeNpm?: string } = {},
) {
  const commandArgs = ["scripts/publish-all.mjs", "--proof", proofPath, "--registry", registry];
  if (options.dryRun) commandArgs.push("--dry-run");
  return new Promise<{ status: number | null; output: string }>((resolve) => {
    const child = spawn(process.execPath, commandArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        IONIFY_PUBLISH_CONTRACT_TEST: "1",
        IONIFY_NPM_EXECUTABLE: options.fakeNpm ?? process.execPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (status) => resolve({ status, output }));
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("publish:all immutable admission transaction", () => {
  it("admits an existing matching artifact and continues in native-first dry-run order", async () => {
    const value = fixture();
    const registry = await registryHarness(value);
    registry.visible.set(value.artifacts[0].packageName, value.artifacts[0]);
    try {
      const result = await runPublish(value.proofPath, registry.registry, { dryRun: true });
      expect(result.status).toBe(0);
      expect(result.output).toContain(`admit existing ${value.artifacts[0].packageName}@${version}`);
      expect(result.output.lastIndexOf("@ionify/ionify@0.1.37")).toBeGreaterThan(result.output.indexOf(targets.at(-1)!));
    } finally { registry.server.close(); }
  });

  it("fails immediately when an immutable version has different bytes", async () => {
    const value = fixture();
    const registry = await registryHarness(value);
    registry.visible.set(value.artifacts[0].packageName, { ...value.artifacts[0], bytes: Buffer.from("wrong") });
    try {
      const result = await runPublish(value.proofPath, registry.registry, { dryRun: true });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("already exists with immutable identity");
      expect(registry.requests.get(value.artifacts[0].packageName)).toBe(1);
    } finally { registry.server.close(); }
  });

  it.each([
    ["missing target", (value: ReturnType<typeof fixture>) => value.proof.natives.pop(), "exactly eight"],
    ["failed binary audit", (value: ReturnType<typeof fixture>) => { value.proof.natives[0].binarySurfaceAudit.status = "FAILED"; }, "binary surface audit is not VERIFIED"],
    ["failed source audit", (value: ReturnType<typeof fixture>) => { value.proof.natives[0].sourceAudit.private.status = "FAILED"; }, "private source audit is not VERIFIED"],
  ])("blocks main for %s", async (_label, mutate, expected) => {
    const value = fixture();
    mutate(value);
    writeProof(value.proofPath, value.proof);
    const result = await runPublish(value.proofPath, "http://127.0.0.1:1", { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(expected);
  });

  it("publishes all eight natives before main and tolerates bounded not-visible propagation", async () => {
    const value = fixture();
    const registry = await registryHarness(value);
    registry.delayed.set(value.artifacts[0].packageName, 2);
    try {
      const result = await runPublish(value.proofPath, registry.registry, { fakeNpm: registry.fakeNpm });
      expect(result.status).toBe(0);
      expect(registry.published).toEqual([...value.proof.natives.map((item) => item.packageName), "@ionify/ionify"]);
      expect(registry.requests.get(value.artifacts[0].packageName)).toBeGreaterThanOrEqual(3);
    } finally { registry.server.close(); }
  });

  it("never publishes main when one native is not visible after bounded retry", async () => {
    const value = fixture();
    const registry = await registryHarness(value);
    registry.dropped.add(value.artifacts[3].packageName);
    try {
      const result = await runPublish(value.proofPath, registry.registry, { fakeNpm: registry.fakeNpm });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("not visible after bounded retry");
      expect(registry.published).not.toContain("@ionify/ionify");
    } finally { registry.server.close(); }
  });
});
