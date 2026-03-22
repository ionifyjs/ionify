import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadEnv, getModeAliases } from "../src/cli/utils/env";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTempDir(fn: (dir: string) => void | Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-env-test-"));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function write(dir: string, name: string, content: string) {
  fs.writeFileSync(path.join(dir, name), content, "utf8");
}

// ---------------------------------------------------------------------------
// getModeAliases
// ---------------------------------------------------------------------------

describe("getModeAliases", () => {
  it("returns the exact mode name when provided", () => {
    expect(getModeAliases("development")).toEqual(["development"]);
    expect(getModeAliases("dev")).toEqual(["dev"]);
    expect(getModeAliases("staging")).toEqual(["staging"]);
  });

  it("falls back to development when mode is empty", () => {
    expect(getModeAliases("")).toEqual(["development"]);
  });

  it("preserves custom and case-sensitive mode names", () => {
    expect(getModeAliases("custom-mode")).toEqual(["custom-mode"]);
    expect(getModeAliases("Development")).toEqual(["Development"]);
  });
});

// ---------------------------------------------------------------------------
// loadEnv — exact mode file probing
// ---------------------------------------------------------------------------

describe("loadEnv — exact mode file probing", () => {
  afterEach(() => {
    // Clean up any env vars written by loadEnv so tests don't bleed into each other.
    delete process.env.VITE_TEST_KEY;
    delete process.env.VITE_ALIAS_KEY;
    delete process.env.VITE_BASE_KEY;
  });

  it("does not cross-load .env.dev when mode is 'development'", () => {
    withTempDir((dir) => {
      write(dir, ".env.dev", "VITE_ALIAS_KEY=from-dev-file\n");
      const result = loadEnv("development", dir);
      expect(result.VITE_ALIAS_KEY).toBeUndefined();
    });
  });

  it("loads only .env.dev when mode is 'dev'", () => {
    withTempDir((dir) => {
      write(dir, ".env.dev", "VITE_ALIAS_KEY=from-dev-file\n");
      const result = loadEnv("dev", dir);
      expect(result.VITE_ALIAS_KEY).toBe("from-dev-file");
    });
  });

  it("does not cross-load .env.development when mode is 'dev'", () => {
    withTempDir((dir) => {
      write(dir, ".env.development", "VITE_TEST_KEY=canonical\n");
      const result = loadEnv("dev", dir);
      expect(result.VITE_TEST_KEY).toBeUndefined();
    });
  });

  it("base .env is always loaded regardless of mode", () => {
    withTempDir((dir) => {
      write(dir, ".env", "VITE_BASE_KEY=base-value\n");
      const result = loadEnv("development", dir);
      expect(result.VITE_BASE_KEY).toBe("base-value");
    });
  });

  it("mode-specific file overrides base .env", () => {
    withTempDir((dir) => {
      write(dir, ".env", "VITE_TEST_KEY=base\n");
      write(dir, ".env.development", "VITE_TEST_KEY=dev-override\n");
      const result = loadEnv("development", dir);
      expect(result.VITE_TEST_KEY).toBe("dev-override");
    });
  });

  it("unknown mode names load only .env.{name} (no alias expansion)", () => {
    withTempDir((dir) => {
      write(dir, ".env.my-custom-mode", "VITE_TEST_KEY=custom\n");
      const result = loadEnv("my-custom-mode", dir);
      expect(result.VITE_TEST_KEY).toBe("custom");
    });
  });

  it("matches Vite's exact-mode behavior for the UP-Portal case study", () => {
    withTempDir((dir) => {
      write(dir, ".env", "VITE_API_GATEWAY_BASE_URL=https://up-apigateway-test.moe.gov.sa/\n");
      write(dir, ".env.dev", "VITE_API_GATEWAY_BASE_URL=https://up-apigateway-dev.moe.gov.sa/\n");
      const result = loadEnv("development", dir);
      expect(result.VITE_API_GATEWAY_BASE_URL).toBe("https://up-apigateway-test.moe.gov.sa/");
    });
  });
});
