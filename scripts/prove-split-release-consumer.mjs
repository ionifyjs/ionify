import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const inputRoot = path.resolve(arg("--input") ?? "");
const publicRoot = path.resolve(arg("--public-candidate") ?? "");
const outputRoot = path.resolve(arg("--output") ?? "");
const packageTarget = arg("--package-target");
const browserEnabled = args.includes("--browser");
if (!arg("--input") || !arg("--public-candidate") || !arg("--output") || !packageTarget) {
  throw new Error("--input, --public-candidate, --output, and --package-target are required");
}

function shouldUseShell(command) {
  return process.platform === "win32" && ["npm", "pnpm", "yarn", "npx"].includes(path.basename(command).replace(/\.cmd$/i, "").toLowerCase());
}
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: shouldUseShell(command),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stdout ?? ""}\n${result.stderr ?? ""}` : "";
    throw new Error(`${command} ${commandArgs.join(" ")} failed (${result.status})${details}`);
  }
  return result.stdout ?? "";
}
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function detectHostTarget() {
  let target = `${process.platform}-${process.arch}`;
  if (process.platform === "win32") return `${target}-msvc`;
  if (process.platform !== "linux") return target;
  const report = typeof process.report?.getReport === "function" ? process.report.getReport() : undefined;
  return `${target}-${report?.header?.glibcVersionRuntime ? "gnu" : "musl"}`;
}
function gitSha(root) {
  return run("git", ["rev-parse", "HEAD"], { cwd: root, capture: true }).trim();
}
function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}
async function waitForUrl(url, attempts = 120) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error(`timed out waiting for ${url}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(inputRoot, "split-proof-input.json"), "utf8"));
if (manifest.kind !== "ionify.split-release-proof-input" || manifest.status !== "VERIFIED") {
  throw new Error("split proof input is unknown or unverified");
}
if (detectHostTarget() !== packageTarget) {
  throw new Error(`host ${detectHostTarget()} cannot prove consumer target ${packageTarget}`);
}
if (gitSha(publicRoot) !== manifest.publicCandidateGitSha) {
  throw new Error("public candidate checkout does not match the sealed input");
}
if (sha256(path.join(publicRoot, "README.md")) !== manifest.publicReadmeSha256) {
  throw new Error("public README does not match the sealed input");
}
if (run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: publicRoot, capture: true }).trim()) {
  throw new Error("public candidate checkout must be clean");
}
const publicPackage = JSON.parse(fs.readFileSync(path.join(publicRoot, "package.json"), "utf8"));
if (publicPackage.name !== "@ionify/ionify" || publicPackage.version !== manifest.releaseVersion) {
  throw new Error("public package identity disagrees with the sealed input");
}
const nativeInput = manifest.natives.find((item) => item.packageTarget === packageTarget);
if (!nativeInput) throw new Error(`sealed input has no ${packageTarget} native artifact`);
const mainTarball = path.resolve(inputRoot, manifest.main.tarball);
const creatorTarball = path.resolve(inputRoot, manifest.creator.tarball);
const nativeTarball = path.resolve(inputRoot, nativeInput.tarball);
for (const [label, file, expected] of [
  ["main", mainTarball, manifest.main.sha256],
  ["creator", creatorTarball, manifest.creator.sha256],
  [packageTarget, nativeTarball, nativeInput.sha256],
]) {
  if (!fs.existsSync(file) || sha256(file) !== expected) throw new Error(`${label} tarball hash mismatch`);
}
const privateProofPath = path.resolve(inputRoot, nativeInput.privateBuildProof);
if (sha256(privateProofPath) !== nativeInput.privateBuildProofSha256) throw new Error("private build receipt hash mismatch");
const privateBuildProof = JSON.parse(fs.readFileSync(privateProofPath, "utf8"));
if (
  privateBuildProof.status !== "VERIFIED" || privateBuildProof.packageTarget !== packageTarget ||
  privateBuildProof.host?.target !== packageTarget || privateBuildProof.native?.sha256 !== nativeInput.sha256 ||
  privateBuildProof.native?.addonSha256 !== nativeInput.addonSha256 ||
  privateBuildProof.native?.isolatedNativeImport !== "VERIFIED"
) throw new Error("private build receipt does not bind this target artifact");

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
const creatorTool = path.join(outputRoot, "creator-tool");
fs.mkdirSync(creatorTool, { recursive: true });
fs.writeFileSync(path.join(creatorTool, "package.json"), '{"private":true}\n');
run("npm", ["install", "--ignore-scripts", "--no-package-lock", creatorTarball], { cwd: creatorTool, capture: true });
const creatorRoot = path.join(creatorTool, "node_modules", "create-ionify");
const creatorPackage = JSON.parse(fs.readFileSync(path.join(creatorRoot, "package.json"), "utf8"));
if (creatorPackage.name !== "create-ionify" || creatorPackage.version !== manifest.creator.version) {
  throw new Error("installed creator identity mismatch");
}
const creatorEntry = path.join(creatorRoot, "index.js");

const registryPort = 47000 + (process.pid % 1000);
const registryUrl = `http://127.0.0.1:${registryPort}`;
const registryLogPath = path.join(outputRoot, "local-registry.log");
const registryLog = fs.openSync(registryLogPath, "w");
const registry = spawn(process.execPath, [
  path.join(toolingRoot, "scripts", "release-local-registry.mjs"),
  "--port", String(registryPort), "--main", mainTarball,
  ...manifest.natives.flatMap((item) => ["--native", item.packageTarget, path.resolve(inputRoot, item.tarball)]),
], { cwd: toolingRoot, stdio: ["ignore", registryLog, registryLog] });

async function inspectDevGraph(baseUrl) {
  const htmlResponse = await waitForUrl(baseUrl);
  const sourceQueue = [new URL("/src/main.tsx", baseUrl).href, new URL("/src/main.ts", baseUrl).href];
  const visitedSources = new Set();
  const sources = [];
  const dependencyQueue = [];
  const queuedDependencies = new Set();
  while (sourceQueue.length && visitedSources.size < 40) {
    const sourceUrl = sourceQueue.shift();
    if (visitedSources.has(sourceUrl)) continue;
    visitedSources.add(sourceUrl);
    const response = await fetch(sourceUrl);
    if (!response.ok) continue;
    const transformed = await response.text();
    sources.push({ url: new URL(sourceUrl).pathname, status: response.status });
    for (const match of transformed.matchAll(/["'](\/@deps\/[^"']+\.js(?:\?[^"']*)?)["']/g)) {
      const absolute = new URL(match[1], baseUrl).href;
      if (!queuedDependencies.has(absolute)) {
        queuedDependencies.add(absolute);
        dependencyQueue.push(absolute);
      }
    }
    for (const match of transformed.matchAll(/["']((?:\/src\/|\.\.?\/)[^"']+\.(?:js|jsx|ts|tsx)(?:\?[^"']*)?)["']/g)) {
      const absolute = new URL(match[1], sourceUrl).href;
      if (!visitedSources.has(absolute)) sourceQueue.push(absolute);
    }
  }
  if (!sources.some((source) => source.url === "/src/main.tsx")) throw new Error("dev graph did not load /src/main.tsx");
  if (dependencyQueue.length === 0) throw new Error("dev graph loaded no dependency URL");
  const dependencies = [];
  const generations = new Set();
  for (let index = 0; index < dependencyQueue.length && index < 40; index += 1) {
    const parsed = new URL(dependencyQueue[index]);
    const generation = parsed.searchParams.get("v");
    if (!generation) throw new Error(`dependency URL has no generation: ${parsed.href}`);
    generations.add(generation);
    const response = await fetch(parsed);
    const bytes = await response.text();
    if (response.status !== 200 || response.headers.get("cache-control") !== "no-cache") {
      throw new Error(`dependency transport contract failed: ${parsed.href}`);
    }
    const transitiveUrls = [...bytes.matchAll(/["'](\/@deps\/[^"']+\.js(?:\?[^"']*)?)["']/g)].map((match) => match[1]);
    for (const transitive of transitiveUrls) {
      const absolute = new URL(transitive, baseUrl).href;
      if (new URL(absolute).searchParams.get("v") !== generation) {
        throw new Error(`${parsed.pathname} crosses dependency generations through ${transitive}`);
      }
      if (!queuedDependencies.has(absolute)) {
        queuedDependencies.add(absolute);
        dependencyQueue.push(absolute);
      }
    }
    dependencies.push({
      url: `${parsed.pathname}${parsed.search}`, logicalUrl: parsed.pathname, generation,
      status: response.status, cacheControl: response.headers.get("cache-control"),
      etag: response.headers.get("etag"), bodySha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      transitiveUrls,
    });
  }
  if (generations.size !== 1) throw new Error("dev graph mixed dependency generations");
  return {
    status: "VERIFIED", execution: "target-host HTTP graph fetch (not a browser)",
    html: { url: "/", status: htmlResponse.status },
    sources,
    dependencies, generation: [...generations][0],
  };
}

async function proveFixture(manager, mode, port) {
  const fixtureRoot = path.join(outputRoot, "fixtures", `${manager}-${mode}`);
  const appName = `${manager}-${mode}-app`;
  const appRoot = path.join(fixtureRoot, appName);
  fs.mkdirSync(fixtureRoot, { recursive: true });
  run(process.execPath, [creatorEntry, appName, "--yes", "--pm", manager, "--skip-install", "--skip-git"], { cwd: fixtureRoot });
  for (const forbidden of ["node_modules", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", ".ionify", "dist"]) {
    if (fs.existsSync(path.join(appRoot, forbidden))) throw new Error(`${manager}/${mode} was not clean before install: ${forbidden}`);
  }
  fs.writeFileSync(path.join(appRoot, ".npmrc"), `@ionify:registry=${registryUrl}\n`);
  run(manager, manager === "yarn" ? ["install", "--non-interactive"] : ["install"], { cwd: appRoot });
  run(manager, ["run", "test"], { cwd: appRoot });
  const appRequire = createRequire(path.join(appRoot, "package.json"));
  const mainEntry = appRequire.resolve("@ionify/ionify");
  const fromMain = createRequire(mainEntry);
  const selected = Object.keys(publicPackage.optionalDependencies).filter((name) => {
    try { fromMain.resolve(name); return true; } catch { return false; }
  });
  const expectedNative = `@ionify/ionify-${packageTarget}`;
  if (selected.length !== 1 || selected[0] !== expectedNative) throw new Error(`native selection mismatch: ${selected.join(",")}`);
  const nativeEntry = fromMain.resolve(expectedNative);
  const binding = fromMain(nativeEntry);
  if (typeof binding.depsStoreHash !== "function") throw new Error("packed native addon did not load");
  const lockfileName = manager === "npm" ? "package-lock.json" : manager === "pnpm" ? "pnpm-lock.yaml" : "yarn.lock";
  const depsStoreHash = binding.depsStoreHash(
    "split-release-consumer", fs.readFileSync(path.join(appRoot, lockfileName)),
    "production", false, true, "auto", 1,
  );
  const cli = path.join(appRoot, "node_modules", "@ionify", "ionify", "dist", "cli", "index.js");
  const version = run(process.execPath, [cli, "--version"], { cwd: appRoot, capture: true }).trim();
  if (version !== manifest.releaseVersion) throw new Error(`installed CLI version is ${version}`);
  let devDependencyGraph = null;
  if (mode === "build") {
    run(process.execPath, [cli, "build"], { cwd: appRoot });
    if (!fs.existsSync(path.join(appRoot, "dist"))) throw new Error("first build produced no dist");
  } else {
    const logPath = path.join(outputRoot, `${manager}-dev.log`);
    const log = fs.openSync(logPath, "w");
    const child = spawn(process.execPath, [cli, "dev", "--port", String(port)], { cwd: appRoot, stdio: ["ignore", log, log] });
    try { devDependencyGraph = await inspectDevGraph(`http://127.0.0.1:${port}`); }
    finally { stopProcess(child); fs.closeSync(log); }
  }
  return {
    packageManager: manager, mode, cleanEnvironment: "VERIFIED", generatedProject: "VERIFIED",
    requestedEngine: "latest", resolvedCandidateVersion: version, selectedNativePackage: selected[0],
    nativeImport: "VERIFIED", generatedTests: "VERIFIED", depsStoreHash,
    lockfile: lockfileName, firstRun: "VERIFIED", devDependencyGraph,
  };
}

async function browserProof() {
  const { chromium } = await import("@playwright/test");
  const projects = {
    npm: path.join(outputRoot, "fixtures", "npm-dev", "npm-dev-app"),
    pnpm: path.join(outputRoot, "fixtures", "pnpm-dev", "pnpm-dev-app"),
  };
  const port = 53900 + (process.pid % 50);
  const origin = `http://127.0.0.1:${port}`;
  const start = async (manager) => {
    const project = projects[manager];
    const cli = path.join(project, "node_modules", "@ionify", "ionify", "dist", "cli", "index.js");
    const log = fs.openSync(path.join(outputRoot, `browser-${manager}.log`), "a");
    const child = spawn(process.execPath, [cli, "dev", "--port", String(port)], { cwd: project, stdio: ["ignore", log, log] });
    await waitForUrl(origin);
    return { child, log };
  };
  const stop = async ({ child, log }) => {
    stopProcess(child);
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    if (child.exitCode === null && child.signalCode === null && process.platform !== "win32") {
      child.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    if (child.exitCode === null && child.signalCode === null) {
      throw new Error(`dev server ${child.pid} did not stop cleanly`);
    }
    fs.closeSync(log);
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const orders = [];
    for (const order of [["pnpm", "npm"], ["npm", "pnpm"]]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      const errors = [];
      const consoleErrors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      const load = async (manager) => {
        const responses = [];
        const network = [];
        const pending = [];
        const onCdp = ({ response }) => {
          if (new URL(response.url).pathname.startsWith("/@deps/")) network.push(response);
        };
        const onResponse = (response) => {
          if (!new URL(response.url()).pathname.startsWith("/@deps/")) return;
          pending.push(response.body().then((body) => responses.push({
            url: response.url(), status: response.status(), headers: response.headers(),
            bodySha256: crypto.createHash("sha256").update(body).digest("hex"), body: body.toString("utf8"),
          })));
        };
        cdp.on("Network.responseReceived", onCdp);
        page.on("response", onResponse);
        await page.goto(origin, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#root > *", { timeout: 30_000 });
        await page.waitForTimeout(800);
        await Promise.all(pending);
        cdp.off("Network.responseReceived", onCdp);
        page.off("response", onResponse);
        if (!responses.length) throw new Error(`${manager} browser loaded no dependency`);
        const generations = new Set(responses.map((item) => new URL(item.url).searchParams.get("v")));
        if (generations.has(null) || generations.size !== 1) throw new Error(`${manager} browser mixed generations`);
        const etagRevalidation = [];
        for (const item of responses) {
          if (item.status !== 200 || item.headers["cache-control"] !== "no-cache" || !item.headers.etag) {
            throw new Error(`${manager} browser transport contract failed`);
          }
          const response = await fetch(item.url, { headers: { "if-none-match": item.headers.etag } });
          const receipt = {
            status: response.status, requestedEtag: item.headers.etag,
            responseEtag: response.headers.get("etag"), cacheControl: response.headers.get("cache-control"),
          };
          if (receipt.status !== 304 || receipt.requestedEtag !== receipt.responseEtag || receipt.cacheControl !== "no-cache") {
            throw new Error(`${manager} browser ETag contract failed`);
          }
          etagRevalidation.push(receipt);
          for (const match of item.body.matchAll(/["'](\/@deps\/[^"']+\.js(?:\?[^"']*)?)["']/g)) {
            if (new URL(match[1], origin).searchParams.get("v") !== [...generations][0]) {
              throw new Error(`${manager} browser wrapper crosses dependency generations`);
            }
          }
        }
        return {
          manager, generation: [...generations][0],
          dependencies: responses.map((item) => ({
            logicalUrl: new URL(item.url).pathname,
            url: new URL(item.url).pathname + new URL(item.url).search,
            bodySha256: item.bodySha256,
          })),
          network: network.map((item) => ({
            url: item.url, fromDiskCache: Boolean(item.fromDiskCache),
            fromServiceWorker: Boolean(item.fromServiceWorker), status: item.status,
          })),
          etagRevalidation,
        };
      };
      let server = await start(order[0]);
      const first = await load(order[0]);
      await stop(server);
      server = await start(order[1]);
      const second = await load(order[1]);
      await stop(server);
      if (first.generation === second.generation) throw new Error("browser generations did not differ");
      const firstLogical = new Map(first.dependencies.map((item) => [item.logicalUrl, item]));
      const aliases = second.dependencies.filter((item) => firstLogical.has(item.logicalUrl));
      if (!aliases.length) throw new Error("browser proof found no historical logical alias");
      if (second.network.some((item) => item.fromDiskCache || item.fromServiceWorker)) {
        throw new Error("browser reused a stale dependency response");
      }
      const semanticErrors = [...errors, ...consoleErrors].filter((message) =>
        /useContext|invalid hook|singleton|Ionify Build Error|cannot read properties of null/i.test(message)
      );
      if (errors.length || semanticErrors.length) {
        throw new Error(`browser semantic error: ${[...errors, ...consoleErrors].join("; ")}`);
      }
      orders.push({
        status: "VERIFIED", order, browserContext: "same-context", first, second,
        historicalContract: { status: "PROVEN", aliases: aliases.map((item) => item.logicalUrl) },
        currentContract: {
          generationBoundUrlsDiffer: true, noMixedSingletonGraph: true, noUseContextFailure: true,
          noStaleWrapperReuse: true, noDiskCacheReuse: true, noServiceWorkerReuse: true,
          etagRevalidation: true,
        },
        pageErrors: errors,
        consoleErrors,
      });
      await context.close();
    }
    return {
      kind: "ionify.browser-dependency-generation-proof", schemaVersion: 1,
      status: "VERIFIED", execution: "host Chromium semantic proof", orders,
    };
  } finally { await browser.close(); }
}

let fixtureProofs;
try {
  await waitForUrl(`${registryUrl}/@ionify%2Fionify`, 80);
  fixtureProofs = [];
  let port = 54100 + (process.pid % 50) * 10;
  for (const manager of ["npm", "pnpm", "yarn"]) {
    for (const mode of ["build", "dev"]) fixtureProofs.push(await proveFixture(manager, mode, port++));
  }
} finally { stopProcess(registry); fs.closeSync(registryLog); }

const installedMain = path.join(outputRoot, "fixtures", "npm-build", "npm-build-app", "node_modules", "@ionify", "ionify");
const installedMainRequire = createRequire(path.join(installedMain, "package.json"));
const installedNative = path.dirname(installedMainRequire.resolve(`@ionify/ionify-${packageTarget}`));
const mainNodeFiles = [];
function collectNodeFiles(root, result) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) collectNodeFiles(absolute, result);
    else if (entry.name.endsWith(".node")) result.push(path.relative(root, absolute));
  }
}
for (const entry of fs.readdirSync(installedMain, { withFileTypes: true })) {
  if (entry.name === "node_modules") continue;
  const absolute = path.join(installedMain, entry.name);
  if (entry.isDirectory()) collectNodeFiles(absolute, mainNodeFiles);
  else if (entry.name.endsWith(".node")) mainNodeFiles.push(entry.name);
}
const nativeNodeFiles = [];
collectNodeFiles(installedNative, nativeNodeFiles);
if (mainNodeFiles.length !== 0 || nativeNodeFiles.length !== 1) throw new Error("installed package surface is invalid");

const browserSemanticProof = browserEnabled ? await browserProof() : null;
const proof = {
  kind: "ionify.public-target-consumer-proof", schemaVersion: 1, status: "VERIFIED",
  topology: "split-private-build-public-consumer",
  releaseVersion: manifest.releaseVersion,
  enginePrivateGitSha: manifest.enginePrivateGitSha,
  creatorSourceGitSha: manifest.creatorSourceGitSha,
  goldenProofToolingPrivateGitSha: manifest.goldenProofToolingPrivateGitSha,
  candidateProofToolingPrivateGitSha: manifest.candidateProofToolingPrivateGitSha,
  publicCandidateGitSha: manifest.publicCandidateGitSha,
  publicReadmeSha256: manifest.publicReadmeSha256,
  packageTarget,
  host: { platform: process.platform, arch: process.arch, target: detectHostTarget() },
  artifacts: {
    mainSha256: manifest.main.sha256, creatorSha256: manifest.creator.sha256,
    nativeSha256: nativeInput.sha256, addonSha256: nativeInput.addonSha256,
    privateBuildProofSha256: nativeInput.privateBuildProofSha256,
  },
  packageSurfaceAudit: {
    status: "VERIFIED", mainContainsNativeAddon: false, nativeContainsExactlyOneAddon: true,
  },
  fixtureProofs,
  browserSemanticProof,
};
const proofPath = path.join(outputRoot, `consumer-proof-${packageTarget}.json`);
fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
console.log(`[ionify-release] public consumer proof complete: ${proofPath}`);
