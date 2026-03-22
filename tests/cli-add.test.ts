import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAddCommand } from "../src/cli/commands/add";

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

describe("ionify add (copy-paste components)", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("writes .tsx when project is TypeScript (tsconfig.json present)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-add-ts-"));
    writeJson(path.join(dir, "package.json"), { name: "ts-proj", private: true });
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}", "utf8");

    process.chdir(dir);
    await runAddCommand("button");

    expect(fs.existsSync(path.join(dir, "src/components/ui/button.tsx"))).toBe(true);
  });

  it("writes .jsx when project is JS (no tsconfig/typescript dep)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-add-js-"));
    writeJson(path.join(dir, "package.json"), { name: "js-proj", private: true });

    process.chdir(dir);
    await runAddCommand("card");

    expect(fs.existsSync(path.join(dir, "src/components/ui/card.jsx"))).toBe(true);
  });

  it("sets exitCode=1 for unknown component", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-add-unknown-"));
    writeJson(path.join(dir, "package.json"), { name: "unknown-proj", private: true });
    process.chdir(dir);

    await runAddCommand("not-a-real-component");
    expect(process.exitCode).toBe(1);
  });
});

