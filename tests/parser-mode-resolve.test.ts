import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveParser, applyParserEnv } from "../src/cli/utils/parser";

describe("parser mode resolution", () => {
  const originalEnv = process.env.IONIFY_PARSER;

  beforeEach(() => {
    delete process.env.IONIFY_PARSER;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.IONIFY_PARSER;
    } else {
      process.env.IONIFY_PARSER = originalEnv;
    }
  });

  it("defaults to oxc when unset", () => {
    const mode = resolveParser(undefined, {});
    expect(mode).toBe("hybrid");
  });

  it("honors config parser field", () => {
    const mode = resolveParser({ parser: "hybrid" } as any, {});
    expect(mode).toBe("hybrid");
  });

  it("env overrides config", () => {
    process.env.IONIFY_PARSER = "swc";
    const mode = resolveParser({ parser: "oxc" } as any, {});
    expect(mode).toBe("swc");
  });

  it("applyParserEnv sets env var", () => {
    applyParserEnv("hybrid");
    expect(process.env.IONIFY_PARSER).toBe("hybrid");
  });
});
