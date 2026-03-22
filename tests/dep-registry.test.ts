import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { hasCoreSingletonPeerDeps, isCoreSingletonDepFileName } from "../src/core/deps/registry";

test("detects core singleton dep file names", () => {
  expect(isCoreSingletonDepFileName("react@19.2.4_abcdef.js")).toBe(true);
  expect(isCoreSingletonDepFileName("react-dom@19.2.4__client_abcdef.js")).toBe(true);
  expect(isCoreSingletonDepFileName("scheduler@0.27.0_abcdef.js")).toBe(true);
  expect(isCoreSingletonDepFileName("react-refresh@0.18.0__runtime_abcdef.js")).toBe(true);
  expect(isCoreSingletonDepFileName("react-router-dom@6.30.3_abcdef.js")).toBe(false);
});

test("detects packages with React-family peer dependencies", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-dep-registry-"));

  try {
    const peerPkgDir = path.join(workspaceRoot, "node_modules", "react-router-dom");
    fs.mkdirSync(path.join(peerPkgDir, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(peerPkgDir, "package.json"),
      JSON.stringify({
        name: "react-router-dom",
        version: "6.30.3",
        peerDependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      }),
      "utf8",
    );
    const peerEntry = path.join(peerPkgDir, "dist", "index.js");
    fs.writeFileSync(peerEntry, "export const Routes = null;\n", "utf8");

    const plainPkgDir = path.join(workspaceRoot, "node_modules", "@remix-run", "router");
    fs.mkdirSync(path.join(plainPkgDir, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(plainPkgDir, "package.json"),
      JSON.stringify({
        name: "@remix-run/router",
        version: "1.23.2",
      }),
      "utf8",
    );
    const plainEntry = path.join(plainPkgDir, "dist", "router.js");
    fs.writeFileSync(plainEntry, "export const createRouter = () => null;\n", "utf8");

    expect(hasCoreSingletonPeerDeps(peerEntry)).toBe(true);
    expect(hasCoreSingletonPeerDeps(plainEntry)).toBe(false);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});