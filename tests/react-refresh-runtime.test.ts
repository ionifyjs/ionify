import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshRuntimeMock = vi.hoisted(() => ({
  injectIntoGlobalHook: vi.fn(),
  register: vi.fn(),
  createSignatureFunctionForTransform: vi.fn(() => (type: unknown) => type),
  performReactRefresh: vi.fn(),
}));

vi.mock("react-refresh/runtime", () => ({
  default: refreshRuntimeMock,
}));

describe("react refresh runtime warning lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    const target = globalThis as any;
    target.window = target;
    delete target.document;
    delete target.$RefreshReg$;
    delete target.$RefreshSig$;
    delete target.__IONIFY_REACT_REFRESH__;
  });

  afterEach(() => {
    const target = globalThis as any;
    delete target.window;
    delete target.document;
    delete target.$RefreshReg$;
    delete target.$RefreshSig$;
    delete target.__IONIFY_REACT_REFRESH__;
  });

  it("does not warn during initial class component registration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { setupReactRefresh } = await import("../src/client/react-refresh-runtime.js");
    const refresh = setupReactRefresh({ accept() {}, dispose() {} }, "/src/Legacy.tsx");
    class LegacyComponent {}
    (LegacyComponent as any).prototype.isReactComponent = {};

    (globalThis as any).window.$RefreshReg$(LegacyComponent, "LegacyComponent");

    expect(warn).not.toHaveBeenCalled();
    refresh?.finalize?.();
    warn.mockRestore();
  });

  it("warns once when a refresh would reset class component state", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { setupReactRefresh } = await import("../src/client/react-refresh-runtime.js");
    const refresh = setupReactRefresh({ accept() {}, dispose() {} }, "/src/Legacy.tsx");
    class LegacyComponent {}
    (LegacyComponent as any).prototype.isReactComponent = {};

    (globalThis as any).window.$RefreshReg$(LegacyComponent, "LegacyComponent");
    expect(refresh?.refresh?.()).toBe(true);
    await Promise.resolve();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("State will reset after edits.");
    expect(refreshRuntimeMock.performReactRefresh).toHaveBeenCalledTimes(1);

    expect(refresh?.refresh?.()).toBe(true);
    await Promise.resolve();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(refreshRuntimeMock.performReactRefresh).toHaveBeenCalledTimes(2);
    refresh?.finalize?.();
    warn.mockRestore();
  });
});
