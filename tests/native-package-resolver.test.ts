import { describe, it, expect } from "vitest";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { native } from "../src/native";

async function writeFile(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

describe("Native package resolver", () => {
  it("resolves react + subpaths from external project root", async () => {
    if (!native?.resolveModule) {
      return;
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-resolve-"));
    const projectRoot = path.join(tempRoot, "project");

    try {
      const reactDir = path.join(projectRoot, "node_modules", "react");
      const reactDomDir = path.join(projectRoot, "node_modules", "react-dom");

      await writeFile(
        path.join(reactDir, "package.json"),
        JSON.stringify({
          name: "react",
          version: "0.0.0-test",
          type: "module",
          exports: {
            ".": {
              import: "./index.js",
              default: "./index.cjs",
            },
            "./jsx-runtime": "./jsx-runtime.js",
          },
        })
      );
      await writeFile(path.join(reactDir, "index.js"), "export const React = {};");
      await writeFile(path.join(reactDir, "index.cjs"), "module.exports = {};");
      await writeFile(path.join(reactDir, "jsx-runtime.js"), "export const jsx = () => null;");

      await writeFile(
        path.join(reactDomDir, "package.json"),
        JSON.stringify({
          name: "react-dom",
          version: "0.0.0-test",
          exports: {
            "./client": "./client.cjs",
          },
          main: "./index.cjs",
        })
      );
      await writeFile(path.join(reactDomDir, "client.cjs"), "module.exports = {};");
      await writeFile(path.join(reactDomDir, "index.cjs"), "module.exports = {};");

      const fromPath = path.join(projectRoot, "src", "main.ts");
      await writeFile(fromPath, "console.log('test');");

      const specifiers = ["react", "react/jsx-runtime", "react-dom/client"];
      for (const spec of specifiers) {
        const result = native.resolveModule(spec, fromPath);
        console.log(`[resolver] ${spec} -> ${result.kind} ${result.fsPath ?? ""}`);
        expect(result.kind).toBeTruthy();
        expect(result.fsPath).toBeTruthy();
      }

      expect(native.resolveModule("react", fromPath).kind).toBe("PkgEsm");
      expect(native.resolveModule("react/jsx-runtime", fromPath).kind).toBe("PkgEsm");
      expect(native.resolveModule("react-dom/client", fromPath).kind).toBe("PkgCjs");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("resolves wildcard subpath exports (e.g. victory-vendor/d3-shape pattern)", async () => {
    if (!native?.resolveModule) {
      return;
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-resolve-wildcard-"));
    const projectRoot = path.join(tempRoot, "project");

    try {
      const vendorDir = path.join(projectRoot, "node_modules", "victory-vendor");
      // Matches real victory-vendor@36.9.2 exports shape.
      await writeFile(
        path.join(vendorDir, "package.json"),
        JSON.stringify({
          name: "victory-vendor",
          version: "36.9.2",
          exports: {
            "./package.json": "./package.json",
            "./d3-*": {
              types: "./d3-*.d.ts",
              import: "./es/d3-*.js",
              default: "./lib/d3-*.js",
            },
          },
        })
      );
      // Provide both the ESM and CJS files so resolution can succeed.
      await writeFile(path.join(vendorDir, "es", "d3-shape.js"), "export const arc = () => {};");
      await writeFile(path.join(vendorDir, "lib", "d3-shape.js"), "module.exports = {};");
      await writeFile(path.join(vendorDir, "es", "d3-scale.js"), "export const scaleLinear = () => {};");
      await writeFile(path.join(vendorDir, "lib", "d3-scale.js"), "module.exports = {};");

      const fromPath = path.join(projectRoot, "src", "main.ts");
      await writeFile(fromPath, "");

      // Both wildcard-matched subpaths must resolve successfully.
      const shapeResult = native.resolveModule("victory-vendor/d3-shape", fromPath);
      expect(shapeResult.fsPath).toBeTruthy();
      expect(shapeResult.fsPath).toMatch(/d3-shape/);

      const scaleResult = native.resolveModule("victory-vendor/d3-scale", fromPath);
      expect(scaleResult.fsPath).toBeTruthy();
      expect(scaleResult.fsPath).toMatch(/d3-scale/);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("wildcard pattern specificity: longer base prefix wins over shorter", async () => {
    if (!native?.resolveModule) {
      return;
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-resolve-pattern-specificity-"));
    const projectRoot = path.join(tempRoot, "project");

    try {
      const pkgDir = path.join(projectRoot, "node_modules", "my-lib");
      // Two overlapping wildcard keys — the more specific one should win.
      await writeFile(
        path.join(pkgDir, "package.json"),
        JSON.stringify({
          name: "my-lib",
          exports: {
            "./utils/*": "./src/utils/*.js",
            "./*": "./src/*.js",
          },
        })
      );
      await writeFile(path.join(pkgDir, "src", "utils", "format.js"), "module.exports = {};");
      await writeFile(path.join(pkgDir, "src", "format.js"), "module.exports = {};");

      const fromPath = path.join(projectRoot, "src", "main.ts");
      await writeFile(fromPath, "");

      // "./utils/format" should match "./utils/*" (longer base prefix) not "./*".
      const result = native.resolveModule("my-lib/utils/format", fromPath);
      expect(result.fsPath).toBeTruthy();
      expect(result.fsPath).toMatch(/src[/\\]utils[/\\]format/);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("prefers consumer-provided peer deps for source packages before nested node_modules copies", async () => {
    if (!native?.resolveModule) {
      return;
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-resolve-peer-source-"));
    const projectRoot = path.join(tempRoot, "project");
    const designSystemRoot = path.join(projectRoot, "Core");

    try {
      await writeFile(
        path.join(projectRoot, "package.json"),
        JSON.stringify({
          name: "app",
          private: true,
          dependencies: {
            react: "18.2.0",
          },
        })
      );
      await writeFile(
        path.join(designSystemRoot, "package.json"),
        JSON.stringify({
          name: "design-system",
          version: "1.0.0",
          peerDependencies: {
            react: "^18.0.0",
          },
        })
      );

      await writeFile(
        path.join(projectRoot, "node_modules", "react", "package.json"),
        JSON.stringify({
          name: "react",
          version: "18.2.0",
          exports: {
            ".": "./index.js",
          },
        })
      );
      await writeFile(
        path.join(projectRoot, "node_modules", "react", "index.js"),
        "export const provider = 'app-root';"
      );

      await writeFile(
        path.join(designSystemRoot, "node_modules", "react", "package.json"),
        JSON.stringify({
          name: "react",
          version: "19.0.0-local",
          exports: {
            ".": "./index.js",
          },
        })
      );
      await writeFile(
        path.join(designSystemRoot, "node_modules", "react", "index.js"),
        "export const provider = 'nested-core';"
      );

      const fromPath = path.join(designSystemRoot, "src", "button.tsx");
      await writeFile(fromPath, "export const Button = () => null;");

      const result = native.resolveModule("react", fromPath);
      expect(await fs.realpath(result.fsPath as string)).toBe(
        await fs.realpath(path.join(projectRoot, "node_modules", "react", "index.js"))
      );
      expect(result.pkg?.version).toBe("18.2.0");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the local package peer when no consumer-provided copy exists above", async () => {
    if (!native?.resolveModule) {
      return;
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-resolve-peer-fallback-"));
    const projectRoot = path.join(tempRoot, "project");
    const designSystemRoot = path.join(projectRoot, "Core");

    try {
      await writeFile(
        path.join(designSystemRoot, "package.json"),
        JSON.stringify({
          name: "design-system",
          version: "1.0.0",
          peerDependencies: {
            react: "^18.0.0",
          },
        })
      );
      await writeFile(
        path.join(designSystemRoot, "node_modules", "react", "package.json"),
        JSON.stringify({
          name: "react",
          version: "19.0.0-local",
          exports: {
            ".": "./index.js",
          },
        })
      );
      await writeFile(
        path.join(designSystemRoot, "node_modules", "react", "index.js"),
        "export const provider = 'nested-core';"
      );

      const fromPath = path.join(designSystemRoot, "src", "button.tsx");
      await writeFile(fromPath, "export const Button = () => null;");

      const result = native.resolveModule("react", fromPath);
      expect(await fs.realpath(result.fsPath as string)).toBe(
        await fs.realpath(path.join(designSystemRoot, "node_modules", "react", "index.js"))
      );
      expect(result.pkg?.version).toBe("19.0.0-local");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("prefers the consumer peer provider even for nested deps inside a source package node_modules tree", async () => {
    if (!native?.resolveModule) {
      return;
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-resolve-peer-nested-"));
    const projectRoot = path.join(tempRoot, "project");
    const designSystemRoot = path.join(projectRoot, "Core");
    const nestedPkgRoot = path.join(
      designSystemRoot,
      "node_modules",
      ".pnpm",
      "use-sync-external-store@1.5.0_react@19.0.0-local",
      "node_modules",
      "use-sync-external-store"
    );

    try {
      await writeFile(
        path.join(projectRoot, "package.json"),
        JSON.stringify({
          name: "app",
          private: true,
          dependencies: {
            react: "18.2.0",
          },
        })
      );
      await writeFile(
        path.join(designSystemRoot, "package.json"),
        JSON.stringify({
          name: "design-system",
          version: "1.0.0",
          peerDependencies: {
            react: "^18.0.0",
          },
          dependencies: {
            "use-sync-external-store": "1.5.0",
          },
        })
      );

      await writeFile(
        path.join(projectRoot, "node_modules", "react", "package.json"),
        JSON.stringify({
          name: "react",
          version: "18.2.0",
          exports: {
            ".": "./index.js",
          },
        })
      );
      await writeFile(
        path.join(projectRoot, "node_modules", "react", "index.js"),
        "export const provider = 'app-root';"
      );

      await writeFile(
        path.join(designSystemRoot, "node_modules", "react", "package.json"),
        JSON.stringify({
          name: "react",
          version: "19.0.0-local",
          exports: {
            ".": "./index.js",
          },
        })
      );
      await writeFile(
        path.join(designSystemRoot, "node_modules", "react", "index.js"),
        "export const provider = 'nested-core';"
      );

      await writeFile(
        path.join(nestedPkgRoot, "package.json"),
        JSON.stringify({
          name: "use-sync-external-store",
          version: "1.5.0",
          peerDependencies: {
            react: "^18.0.0 || ^19.0.0",
          },
          exports: {
            ".": "./index.js",
          },
        })
      );
      await writeFile(path.join(nestedPkgRoot, "index.js"), "export const shim = true;");

      const fromPath = path.join(nestedPkgRoot, "index.js");
      const result = native.resolveModule("react", fromPath);
      expect(await fs.realpath(result.fsPath as string)).toBe(
        await fs.realpath(path.join(projectRoot, "node_modules", "react", "index.js"))
      );
      expect(result.pkg?.version).toBe("18.2.0");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
