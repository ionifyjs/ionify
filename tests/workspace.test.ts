import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "../src/core/workspace";
import { decodePublicPath, MODULE_REQUEST_PREFIX } from "../src/core/utils/public-path";
import { WS_MODULE_PREFIX, toWsModuleId } from "../src/core/module-id";

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rp(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function touchDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function encodeModuleId(moduleId: string): string {
  return MODULE_REQUEST_PREFIX + Buffer.from(moduleId).toString("base64url");
}

describe("workspace discovery (Phase 6.5)", () => {
  it("single project: workspaceRoot=projectRoot and ionifyDir is scoped to project", () => {
    const dir = mkdtemp("ionify-ws-single-");
    writeJson(path.join(dir, "package.json"), { name: "app", private: true });

    const ws = resolveWorkspace(dir);
    expect(ws.projectRoot).toBe(rp(dir));
    expect(ws.workspaceRoot).toBe(rp(dir));
    expect(ws.ionifyDir).toBe(path.join(rp(dir), ".ionify"));
    expect(ws.allowedRoots).toContain(rp(dir));
  });

  it("nested cwd: finds nearest package.json as projectRoot", () => {
    const dir = mkdtemp("ionify-ws-nested-");
    writeJson(path.join(dir, "package.json"), { name: "app", private: true });
    const nested = path.join(dir, "src", "deep");
    touchDir(nested);

    const ws = resolveWorkspace(nested);
    expect(ws.projectRoot).toBe(rp(dir));
    expect(ws.workspaceRoot).toBe(rp(dir));
  });

  it("monorepo: prefers pnpm-workspace.yaml as workspaceRoot and scopes ionifyDir to workspace", () => {
    const root = mkdtemp("ionify-ws-mono-");
    writeJson(path.join(root, "package.json"), { name: "repo", private: true });
    writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - \"apps/*\"\n  - \"packages/*\"\n");

    const app = path.join(root, "apps", "web");
    writeJson(path.join(app, "package.json"), { name: "web", private: true });
    const start = path.join(app, "src");
    touchDir(start);

    const ws = resolveWorkspace(start);
    expect(ws.projectRoot).toBe(rp(app));
    expect(ws.workspaceRoot).toBe(rp(root));
    expect(ws.ionifyDir).toBe(path.join(rp(root), ".ionify"));
    expect(ws.projectRelPath).toBe("apps/web");
  });

  it("git root fallback: uses nearest .git as workspaceRoot when no workspace markers exist", () => {
    const root = mkdtemp("ionify-ws-git-");
    touchDir(path.join(root, ".git"));
    const app = path.join(root, "apps", "web");
    writeJson(path.join(app, "package.json"), { name: "web", private: true });

    const ws = resolveWorkspace(app);
    expect(ws.workspaceRoot).toBe(rp(root));
    expect(ws.markers).toContain(".git");
  });

  it("git submodules: parses .gitmodules and includes submodule roots in allowlist", () => {
    const root = mkdtemp("ionify-ws-submodules-");
    touchDir(path.join(root, ".git"));
    writeJson(path.join(root, "package.json"), { name: "repo", private: true });

    writeFile(
      path.join(root, ".gitmodules"),
      [
        '[submodule "foo"]',
        "  path = vendor/foo",
        "  url = https://example.invalid/foo.git",
        "",
        '[submodule "escape"]',
        "  path = ../escape",
        "  url = https://example.invalid/escape.git",
        "",
      ].join("\n"),
    );
    touchDir(path.join(root, "vendor", "foo"));

    const app = path.join(root, "apps", "web");
    writeJson(path.join(app, "package.json"), { name: "web", private: true });

    const ws = resolveWorkspace(app);
    expect(ws.submoduleRoots.some((p) => p.endsWith("/vendor/foo"))).toBe(true);
    // Security: paths escaping the workspaceRoot are ignored.
    expect(ws.submoduleRoots.some((p) => p.includes("escape"))).toBe(false);
    expect(ws.allowedRoots.some((p) => p.endsWith("/vendor/foo"))).toBe(true);
  });
});

describe("module public path allowlist (Phase 6.5)", () => {
  it("allows module paths inside allowedRoots", () => {
    const root = mkdtemp("ionify-allow-ok-");
    writeJson(path.join(root, "package.json"), { name: "repo", private: true });
    const project = path.join(root, "apps", "web");
    writeJson(path.join(project, "package.json"), { name: "web", private: true });

    const file = path.join(root, "packages", "ui", "src", "button.tsx");
    writeFile(file, "export const x = 1;\n");

    const moduleId = toWsModuleId(file, root);
    expect(moduleId).toBeTruthy();
    const url = encodeModuleId(moduleId!);
    const decoded = decodePublicPath(project, url, { allowedRoots: [root], workspaceRoot: root });
    // decodePublicPath returns realpath-canonicalized paths (Phase 6.5+),
    // so compare using fs.realpath to avoid macOS `/var` vs `/private/var` drift.
    expect(decoded).toBe(fs.realpathSync.native ? fs.realpathSync.native(file) : fs.realpathSync(file));
  });

  it("rejects module paths outside allowedRoots", () => {
    const root = mkdtemp("ionify-allow-no-");
    writeJson(path.join(root, "package.json"), { name: "repo", private: true });
    const project = path.join(root, "apps", "web");
    writeJson(path.join(project, "package.json"), { name: "web", private: true });

    const file = path.join(root, "secret.js");
    writeFile(file, "export const secret = 1;\n");

    const otherRoot = mkdtemp("ionify-allow-other-");
    writeJson(path.join(otherRoot, "package.json"), { name: "other", private: true });

    const moduleId = toWsModuleId(file, root);
    expect(moduleId).toBeTruthy();
    const url = encodeModuleId(moduleId!);
    const decoded = decodePublicPath(project, url, { allowedRoots: [otherRoot], workspaceRoot: root });
    expect(decoded).toBe(null);
  });

  it("rejects symlink escapes (realpath-based allowlist)", () => {
    const root = mkdtemp("ionify-allow-symlink-root-");
    writeJson(path.join(root, "package.json"), { name: "repo", private: true });
    const project = path.join(root, "apps", "web");
    writeJson(path.join(project, "package.json"), { name: "web", private: true });

    const outside = mkdtemp("ionify-allow-symlink-outside-");
    const outsideFile = path.join(outside, "x.js");
    writeFile(outsideFile, "export const x = 1;\n");

    const linkDir = path.join(root, "linked");
    try {
      fs.symlinkSync(outside, linkDir, "dir");
    } catch {
      // If symlinks are not supported, skip the assertion.
      return;
    }

    const viaLink = path.join(linkDir, "x.js");
    const url = encodeModuleId(`${WS_MODULE_PREFIX}linked/x.js`);
    const decoded = decodePublicPath(project, url, { allowedRoots: [root], workspaceRoot: root });
    expect(decoded).toBe(null);
  });
});
