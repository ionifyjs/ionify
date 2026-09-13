import { describe, expect, it, vi } from "vitest";
import {
  detectLinuxLibc,
  loadNativeBinding,
  selectNativePackage,
} from "../src/native/native-loader";

describe("native package distribution", () => {
  it.each([
    ["darwin", "arm64", undefined, "@ionify/ionify-darwin-arm64"],
    ["darwin", "x64", undefined, "@ionify/ionify-darwin-x64"],
    ["win32", "arm64", undefined, "@ionify/ionify-win32-arm64-msvc"],
    ["win32", "x64", undefined, "@ionify/ionify-win32-x64-msvc"],
    ["linux", "arm64", "gnu", "@ionify/ionify-linux-arm64-gnu"],
    ["linux", "x64", "gnu", "@ionify/ionify-linux-x64-gnu"],
    ["linux", "arm64", "musl", "@ionify/ionify-linux-arm64-musl"],
    ["linux", "x64", "musl", "@ionify/ionify-linux-x64-musl"],
  ])("selects only the exact %s-%s-%s package", (platform, arch, libc, expected) => {
    expect(selectNativePackage(platform, arch, libc)).toBe(expected);
  });

  it("distinguishes Linux glibc from musl deterministically", () => {
    expect(detectLinuxLibc(() => ({ header: { glibcVersionRuntime: "2.39" } }))).toBe("gnu");
    expect(detectLinuxLibc(() => ({ header: {} }))).toBe("musl");
    expect(detectLinuxLibc(() => undefined)).toBe("musl");
  });

  it("rejects unsupported targets before require", () => {
    const requireFn = vi.fn();
    expect(() => loadNativeBinding({
      platform: "freebsd",
      arch: "x64",
      requireFn,
      privateCheckoutBindingPath: null,
    })).toThrow(/Unsupported native platform: freebsd-x64/);
    expect(requireFn).not.toHaveBeenCalled();
  });

  it("reports a missing optional package immediately and preserves the cause", () => {
    const cause = Object.assign(
      new Error("Cannot find module '@ionify/ionify-darwin-arm64'"),
      { code: "MODULE_NOT_FOUND" },
    );
    let thrown: (Error & { code?: string; cause?: unknown }) | undefined;
    try {
      loadNativeBinding({
        platform: "darwin",
        arch: "arm64",
        requireFn: () => { throw cause; },
        privateCheckoutBindingPath: null,
      });
    } catch (error) {
      thrown = error as Error & { code?: string; cause?: unknown };
    }

    expect(thrown?.code).toBe("IONIFY_NATIVE_PACKAGE_MISSING");
    expect(thrown?.message).toContain("Selected package: @ionify/ionify-darwin-arm64");
    expect(thrown?.message).toContain("without --omit=optional / --no-optional");
    expect(thrown?.message).toContain(cause.message);
    expect(thrown?.cause).toBe(cause);
  });

  it("does not hide a real dlopen error behind another candidate", () => {
    const cause = Object.assign(new Error("mach-o file, but is an incompatible architecture"), {
      code: "ERR_DLOPEN_FAILED",
    });
    const requireFn = vi.fn(() => { throw cause; });

    let thrown: (Error & { code?: string; cause?: unknown }) | undefined;
    try {
      loadNativeBinding({
        platform: "darwin",
        arch: "x64",
        requireFn,
        privateCheckoutBindingPath: "/should/not/be/tried.node",
      });
    } catch (error) {
      thrown = error as Error & { code?: string; cause?: unknown };
    }

    expect(requireFn).toHaveBeenCalledTimes(1);
    expect(thrown?.code).toBe("IONIFY_NATIVE_DLOPEN_FAILED");
    expect(thrown?.message).toContain("incompatible architecture");
    expect(thrown?.cause).toBe(cause);
  });
});
