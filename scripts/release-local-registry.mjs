import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const port = Number(arg("--port", "4873"));
const mainTarballArg = arg("--main");
const arm64TarballArg = arg("--darwin-arm64");
const x64TarballArg = arg("--darwin-x64");
if (!mainTarballArg) throw new Error("--main is required");
const mainTarball = path.resolve(mainTarballArg);
const arm64Tarball = arm64TarballArg ? path.resolve(arm64TarballArg) : null;
const x64Tarball = x64TarballArg ? path.resolve(x64TarballArg) : null;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function integrity(bytes) {
  return `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`;
}

function shasum(bytes) {
  return crypto.createHash("sha1").update(bytes).digest("hex");
}

function packageRecord(packageJsonPath, tarballPath, tarballName) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const bytes = tarballPath ? fs.readFileSync(tarballPath) : Buffer.from("unavailable");
  return {
    packageJson,
    tarballPath,
    tarballName,
    metadata: {
      ...packageJson,
      dist: {
        tarball: `http://127.0.0.1:${port}/${tarballName}`,
        shasum: shasum(bytes),
        integrity: integrity(bytes),
      },
    },
  };
}

const records = [
  packageRecord(
    path.join(repoRoot, "package.json"),
    mainTarball,
    "@ionify/ionify/-/ionify-0.1.36.tgz",
  ),
  packageRecord(
    path.join(repoRoot, "native-packages/darwin-arm64/package.json"),
    arm64Tarball,
    "@ionify/ionify-darwin-arm64/-/ionify-darwin-arm64-0.1.36.tgz",
  ),
  packageRecord(
    path.join(repoRoot, "native-packages/darwin-x64/package.json"),
    x64Tarball,
    "@ionify/ionify-darwin-x64/-/ionify-darwin-x64-0.1.36.tgz",
  ),
];

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname)
    .replace(/^\/+/, "");

  for (const record of records) {
    if (pathname === record.tarballName) {
      if (!record.tarballPath) {
        sendJson(response, 404, { error: "candidate artifact not built on this host" });
        return;
      }
      const bytes = fs.readFileSync(record.tarballPath);
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": bytes.length,
      });
      response.end(bytes);
      return;
    }

    const name = record.packageJson.name;
    if (pathname === name) {
      sendJson(response, 200, {
        name,
        "dist-tags": { latest: record.packageJson.version },
        versions: { [record.packageJson.version]: record.metadata },
      });
      return;
    }
    if (pathname === `${name}/${record.packageJson.version}`) {
      sendJson(response, 200, record.metadata);
      return;
    }
  }

  sendJson(response, 404, { error: `not found: ${pathname}` });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`REGISTRY_READY http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
