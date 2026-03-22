import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { weakEtagFromContent, weakEtagFromStat } from "../src/core/http-cache";

describe("HTTP cache validators", () => {
  it("derives stable weak etags from emitted content", () => {
    const first = Buffer.from("export const value = 1;\n", "utf8");
    const second = Buffer.from("export const value = 2;\n", "utf8");

    expect(weakEtagFromContent("mod-dev", first)).toBe(weakEtagFromContent("mod-dev", first));
    expect(weakEtagFromContent("mod-dev", first)).not.toBe(weakEtagFromContent("mod-dev", second));
  });

  it("keeps stat-based etags available for immutable on-disk artifacts", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-http-cache-"));
    const filePath = path.join(tempDir, "asset.js");
    fs.writeFileSync(filePath, "export const ok = true;\n", "utf8");

    const stat = fs.statSync(filePath);
    expect(weakEtagFromStat("deps-asset", stat)).toMatch(/^W\/"deps-asset-/);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
