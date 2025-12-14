import { describe, expect, it } from "vitest";
import { resolveScopeHoist } from "../src/cli/utils/scope-hoist";

describe("scope hoist resolver", () => {
  it("defaults to enabled", () => {
    const resolved = resolveScopeHoist(undefined);
    expect(resolved.enable).toBe(true);
    expect(resolved.inlineFunctions).toBe(true);
  });

  it("disables when config boolean false", () => {
    const resolved = resolveScopeHoist(false);
    expect(resolved.enable).toBe(false);
    expect(resolved.inlineFunctions).toBe(false);
    expect(resolved.constantFolding).toBe(false);
    expect(resolved.combineVariables).toBe(false);
  });

  it("honors object flags", () => {
    const resolved = resolveScopeHoist({
      inlineFunctions: false,
      constantFolding: true,
      combineVariables: false,
    });
    expect(resolved.enable).toBe(true);
    expect(resolved.inlineFunctions).toBe(false);
    expect(resolved.constantFolding).toBe(true);
    expect(resolved.combineVariables).toBe(false);
  });

  it("prefers env overrides", () => {
    const resolved = resolveScopeHoist(true, {
      envMode: "off",
      inlineEnv: "true",
      constantEnv: "false",
      combineEnv: "true",
    });
    expect(resolved.enable).toBe(false);
    expect(resolved.inlineFunctions).toBe(true);
    expect(resolved.constantFolding).toBe(false);
    expect(resolved.combineVariables).toBe(true);
  });
});
