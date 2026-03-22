/**
 * Unit tests for Entry Module Detection (Phase 5.6.2.1 Task 2)
 */

import { describe, it, expect } from "vitest";
import { isEntryModule, looksLikeComponent } from "@core/refresh/entryDetection";
import path from "path";

describe("isEntryModule", () => {
  describe("heuristic-based detection (no config)", () => {
    it("detects /src/main.tsx as entry", () => {
      const filePath = "/project/src/main.tsx";
      expect(isEntryModule(filePath)).toBe(true);
    });

    it("detects /src/main.ts as entry", () => {
      const filePath = "/project/src/main.ts";
      expect(isEntryModule(filePath)).toBe(true);
    });

    it("detects /src/main.jsx as entry", () => {
      const filePath = "/project/src/main.jsx";
      expect(isEntryModule(filePath)).toBe(true);
    });

    it("detects /src/main.js as entry", () => {
      const filePath = "/project/src/main.js";
      expect(isEntryModule(filePath)).toBe(true);
    });

    it("detects /src/index.tsx as entry", () => {
      const filePath = "/project/src/index.tsx";
      expect(isEntryModule(filePath)).toBe(true);
    });

    it("detects /src/index.ts as entry", () => {
      const filePath = "/project/src/index.ts";
      expect(isEntryModule(filePath)).toBe(true);
    });

    it("does not detect component files as entries", () => {
      expect(isEntryModule("/project/src/App.tsx")).toBe(false);
      expect(isEntryModule("/project/src/Counter.tsx")).toBe(false);
      expect(isEntryModule("/project/src/components/Button.tsx")).toBe(false);
    });

    it("does not detect nested main files as entries", () => {
      expect(isEntryModule("/project/src/components/main.tsx")).toBe(false);
    });
  });

  describe("config-based detection", () => {
    it("detects explicit config.entry", () => {
      const config = {
        root: "/project",
        entry: "src/app.tsx",
      };
      const filePath = "/project/src/app.tsx";
      expect(isEntryModule(filePath, config)).toBe(true);
    });

    it("supports config.entry as an array", () => {
      const config = {
        root: "/project",
        entry: ["src/main.tsx", "src/admin.tsx"],
      };
      expect(isEntryModule("/project/src/admin.tsx", config)).toBe(true);
      expect(isEntryModule("/project/src/App.tsx", config)).toBe(false);
    });

    it("resolves relative entry path", () => {
      const config = {
        root: "/project",
        entry: "./src/custom-entry.tsx",
      };
      const filePath = path.resolve("/project", "src/custom-entry.tsx");
      expect(isEntryModule(filePath, config)).toBe(true);
    });

    it("does not match non-entry when config.entry is set", () => {
      const config = {
        root: "/project",
        entry: "src/main.tsx",
      };
      expect(isEntryModule("/project/src/App.tsx", config)).toBe(false);
    });

    it("falls back to heuristic if file doesn't match config.entry", () => {
      const config = {
        root: "/project",
        entry: "src/app.tsx", // different entry
      };
      // main.tsx still detected by heuristic
      expect(isEntryModule("/project/src/main.tsx", config)).toBe(true);
    });
  });

  describe("Windows path handling", () => {
    it("handles Windows backslashes", () => {
      const filePath = "C:\\project\\src\\main.tsx";
      expect(isEntryModule(filePath)).toBe(true);
    });

    it("handles mixed slashes", () => {
      const filePath = "C:\\project/src\\main.tsx";
      expect(isEntryModule(filePath)).toBe(true);
    });
  });
});

describe("looksLikeComponent", () => {
  it("detects PascalCase component names", () => {
    expect(looksLikeComponent("/project/src/App.tsx")).toBe(true);
    expect(looksLikeComponent("/project/src/Counter.tsx")).toBe(true);
    expect(looksLikeComponent("/project/src/MyComponent.tsx")).toBe(true);
  });

  it("rejects camelCase names", () => {
    expect(looksLikeComponent("/project/src/main.tsx")).toBe(false);
    expect(looksLikeComponent("/project/src/index.tsx")).toBe(false);
    expect(looksLikeComponent("/project/src/utils.tsx")).toBe(false);
  });

  it("rejects kebab-case names", () => {
    expect(looksLikeComponent("/project/src/my-component.tsx")).toBe(false);
  });

  it("handles files in nested folders", () => {
    expect(looksLikeComponent("/project/src/components/Button.tsx")).toBe(true);
    expect(looksLikeComponent("/project/src/hooks/useCounter.tsx")).toBe(false);
  });
});
