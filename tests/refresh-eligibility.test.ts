import { describe, it, expect } from "vitest";
import { containsJSX, shouldUseReactRefresh } from "@core/refresh/refreshEligibility";

describe("refreshEligibility", () => {
  describe("containsJSX", () => {
    it("detects basic JSX tags", () => {
      expect(containsJSX(`export const App = () => <div />;`)).toBe(true);
    });

    it("detects fragments", () => {
      expect(containsJSX(`export const App = () => <>hi</>;`)).toBe(true);
    });

    it("detects React.createElement", () => {
      expect(containsJSX(`export const App = () => React.createElement('div');`)).toBe(true);
    });

    it("does not treat TS generics as JSX", () => {
      expect(containsJSX(`const id = <T>(x: T) => x; export { id };`)).toBe(false);
    });
  });

  describe("shouldUseReactRefresh", () => {
    it("returns false in production", () => {
      expect(
        shouldUseReactRefresh({
          ext: ".tsx",
          code: `export const App = () => <div/>;`,
          isDev: false,
        }),
      ).toBe(false);
    });

    it("returns false when fastRefresh is disabled", () => {
      expect(
        shouldUseReactRefresh({
          ext: ".tsx",
          code: `export const App = () => <div/>;`,
          isDev: true,
          config: { fastRefresh: false } as any,
        }),
      ).toBe(false);
    });

    it("uses content-based gating for .tsx", () => {
      expect(
        shouldUseReactRefresh({
          ext: ".tsx",
          code: `export const x = 1;`,
          isDev: true,
        }),
      ).toBe(false);

      expect(
        shouldUseReactRefresh({
          ext: ".tsx",
          code: `export const App = () => <div/>;`,
          isDev: true,
        }),
      ).toBe(true);
    });

    it("enables refresh for JSX-in-JS", () => {
      expect(
        shouldUseReactRefresh({
          ext: ".js",
          code: `export const App = () => <div/>;`,
          isDev: true,
        }),
      ).toBe(true);
    });
  });
});
