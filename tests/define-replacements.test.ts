import { describe, it, expect } from "vitest";
import { applyDefineReplacements, buildDefineConfig } from "../src/core/utils/define";

describe("Define Replacements", () => {
  describe("applyDefineReplacements", () => {
    it("should replace simple identifiers", () => {
      const code = `
        console.log(__VERSION__);
        console.log(__DEBUG__);
      `;
      
      const result = applyDefineReplacements(code, {
        __VERSION__: "1.0.0",
        __DEBUG__: true,
      });
      
      expect(result).toContain('"1.0.0"');
      expect(result).toContain("true");
      expect(result).not.toContain("__VERSION__");
      expect(result).not.toContain("__DEBUG__");
    });

    it("should replace member expressions", () => {
      const code = `
        if (process.env.NODE_ENV === 'production') {
          console.log('Production mode');
        }
      `;
      
      const result = applyDefineReplacements(code, {
        "process.env.NODE_ENV": "production",
      });
      
      expect(result).toContain('"production"');
      expect(result).not.toContain("process.env.NODE_ENV");
    });

    it("should replace import.meta.env expressions", () => {
      const code = `
        const apiUrl = import.meta.env.VITE_API_URL;
        const mode = import.meta.env.MODE;
        const isDev = import.meta.env.DEV;
      `;
      
      const result = applyDefineReplacements(code, {
        "import.meta.env.VITE_API_URL": "https://api.example.com",
        "import.meta.env.MODE": "development",
        "import.meta.env.DEV": true,
      });
      
      expect(result).toContain('"https://api.example.com"');
      expect(result).toContain('"development"');
      expect(result).toContain("true");
      expect(result).not.toContain("import.meta.env.VITE_API_URL");
      expect(result).not.toContain("import.meta.env.MODE");
      expect(result).not.toContain("import.meta.env.DEV");
    });

    it("should handle numbers and booleans", () => {
      const code = `
        const port = __PORT__;
        const enabled = __FEATURE_ENABLED__;
      `;
      
      const result = applyDefineReplacements(code, {
        __PORT__: 3000,
        __FEATURE_ENABLED__: false,
      });
      
      expect(result).toContain("3000");
      expect(result).toContain("false");
      expect(result).not.toContain("__PORT__");
      expect(result).not.toContain("__FEATURE_ENABLED__");
    });

    it("should handle null values", () => {
      const code = `
        const value = __NULL_VALUE__;
      `;
      
      const result = applyDefineReplacements(code, {
        __NULL_VALUE__: null,
      });
      
      expect(result).toContain("null");
      expect(result).not.toContain("__NULL_VALUE__");
    });

    it("should not replace partial matches", () => {
      const code = `
        const __VERSION__2 = '2.0.0';
        const MY__VERSION__ = '3.0.0';
        console.log(__VERSION__);
      `;
      
      const result = applyDefineReplacements(code, {
        __VERSION__: "1.0.0",
      });
      
      // Only exact __VERSION__ should be replaced
      expect(result).toContain("__VERSION__2");
      expect(result).toContain("MY__VERSION__");
      expect(result).toContain('"1.0.0"');
    });

    it("should handle multiple replacements in order", () => {
      const code = `
        console.log(__VERSION__, __DEBUG__, process.env.NODE_ENV);
      `;
      
      const result = applyDefineReplacements(code, {
        __VERSION__: "1.0.0",
        __DEBUG__: true,
        "process.env.NODE_ENV": "production",
      });
      
      expect(result).toContain('"1.0.0"');
      expect(result).toContain("true");
      expect(result).toContain('"production"');
    });

    it("should handle objects and arrays", () => {
      const code = `
        const config = __CONFIG__;
        const items = __ITEMS__;
      `;
      
      const result = applyDefineReplacements(code, {
        __CONFIG__: { foo: "bar", num: 123 },
        __ITEMS__: [1, 2, 3],
      });
      
      expect(result).toContain('{"foo":"bar","num":123}');
      expect(result).toContain("[1,2,3]");
    });

    it("should handle pre-stringified values", () => {
      const code = `
        const version = __VERSION__;
      `;
      
      // If value is already quoted, use as-is
      const result = applyDefineReplacements(code, {
        __VERSION__: '"1.0.0"',  // Already quoted
      });
      
      expect(result).toContain('"1.0.0"');
      expect(result).not.toContain('""1.0.0""'); // Should not double-quote
    });
  });

  describe("buildDefineConfig", () => {
    it("should auto-expose VITE_ prefixed variables", () => {
      const envValues = {
        VITE_API_URL: "https://api.example.com",
        VITE_APP_TITLE: "My App",
        OTHER_VAR: "should not be exposed",
      };
      
      const config = buildDefineConfig(undefined, envValues);
      
      expect(config["import.meta.env.VITE_API_URL"]).toBe("https://api.example.com");
      expect(config["import.meta.env.VITE_APP_TITLE"]).toBe("My App");
      expect(config["import.meta.env.OTHER_VAR"]).toBeUndefined();
    });

    it("should auto-expose IONIFY_ prefixed variables", () => {
      const envValues = {
        IONIFY_DEBUG: "true",
        IONIFY_PORT: "3000",
      };
      
      const config = buildDefineConfig(undefined, envValues);
      
      expect(config["import.meta.env.IONIFY_DEBUG"]).toBe("true");
      expect(config["import.meta.env.IONIFY_PORT"]).toBe("3000");
    });

    it("should always expose NODE_ENV and MODE", () => {
      const envValues = {
        NODE_ENV: "production",
        MODE: "production",
      };
      
      const config = buildDefineConfig(undefined, envValues);
      
      expect(config["import.meta.env.NODE_ENV"]).toBe("production");
      expect(config["import.meta.env.MODE"]).toBe("production");
      expect(config["process.env.NODE_ENV"]).toBe("production");
      expect(config["process.env.MODE"]).toBe("production");
    });

    it("should auto-define DEV and PROD based on MODE", () => {
      const devEnv = { MODE: "development" };
      const prodEnv = { MODE: "production" };
      
      const devConfig = buildDefineConfig(undefined, devEnv);
      const prodConfig = buildDefineConfig(undefined, prodEnv);
      
      expect(devConfig["import.meta.env.DEV"]).toBe(true);
      expect(devConfig["import.meta.env.PROD"]).toBe(false);
      
      expect(prodConfig["import.meta.env.DEV"]).toBe(false);
      expect(prodConfig["import.meta.env.PROD"]).toBe(true);
    });

    it("should merge user define with auto-generated", () => {
      const userDefine = {
        __VERSION__: "1.0.0",
        "process.env.NODE_ENV": "production",
      };
      
      const envValues = {
        VITE_API_URL: "https://api.example.com",
        MODE: "production",
      };
      
      const config = buildDefineConfig(userDefine, envValues);
      
      // User-defined
      expect(config.__VERSION__).toBe("1.0.0");
      expect(config["process.env.NODE_ENV"]).toBe("production");
      
      // Auto-generated
      expect(config["import.meta.env.VITE_API_URL"]).toBe("https://api.example.com");
      expect(config["import.meta.env.MODE"]).toBe("production");
      expect(config["import.meta.env.PROD"]).toBe(true);
    });

    it("should not override user-defined values", () => {
      const userDefine = {
        "import.meta.env.VITE_API_URL": "https://override.example.com",
      };
      
      const envValues = {
        VITE_API_URL: "https://api.example.com",
      };
      
      const config = buildDefineConfig(userDefine, envValues);
      
      // User value should take precedence
      expect(config["import.meta.env.VITE_API_URL"]).toBe("https://override.example.com");
    });

    it("should support custom envPrefix", () => {
      const envValues = {
        MYAPP_API_URL: "https://api.example.com",
        VITE_OTHER: "should not be exposed",
      };
      
      const config = buildDefineConfig(undefined, envValues, "MYAPP_");
      
      expect(config["import.meta.env.MYAPP_API_URL"]).toBe("https://api.example.com");
      expect(config["import.meta.env.VITE_OTHER"]).toBeUndefined();
    });

    it("should support multiple envPrefixes", () => {
      const envValues = {
        VITE_VAR1: "value1",
        IONIFY_VAR2: "value2",
        CUSTOM_VAR3: "value3",
        OTHER_VAR: "should not be exposed",
      };
      
      const config = buildDefineConfig(undefined, envValues, ["VITE_", "IONIFY_", "CUSTOM_"]);
      
      expect(config["import.meta.env.VITE_VAR1"]).toBe("value1");
      expect(config["import.meta.env.IONIFY_VAR2"]).toBe("value2");
      expect(config["import.meta.env.CUSTOM_VAR3"]).toBe("value3");
      expect(config["import.meta.env.OTHER_VAR"]).toBeUndefined();
    });

    it("injects import.meta.env as a full object including known VITE_ vars", () => {
      const config = buildDefineConfig(undefined, {
        VITE_API_URL: "https://api.example.com",
        MODE: "development",
      });

      const envObj = config["import.meta.env"];
      expect(typeof envObj).toBe("object");
      // Known prefix-matched vars are present in the object
      expect((envObj as any).VITE_API_URL).toBe("https://api.example.com");
      // Standard Vite-compatible fields
      expect((envObj as any).MODE).toBe("development");
      expect((envObj as any).DEV).toBe(true);
      expect((envObj as any).PROD).toBe(false);
      expect((envObj as any).BASE_URL).toBe("/");
      expect((envObj as any).SSR).toBe(false);
    });
  });

  describe("applyDefineReplacements — import.meta.env object fallback", () => {
    it("replaces bare import.meta.env with the env object (destructuring pattern)", () => {
      const define = buildDefineConfig(undefined, {
        VITE_FOO: "bar",
        MODE: "development",
      });
      const code = `const { DEV, VITE_FOO } = import.meta.env;`;
      const result = applyDefineReplacements(code, define);
      // The bare `import.meta.env` reference (not followed by `.`) is replaced
      expect(result).not.toContain("import.meta.env");
      expect(result).toContain("DEV");
    });

    it("replaces import.meta.env.UNKNOWN_KEY with object property access (|| fallback works)", () => {
      // VITE_ENCRYPTION_KEY is intentionally NOT in the define config.
      const define = buildDefineConfig(undefined, {
        VITE_OTHER: "value",
        MODE: "development",
      });
      const code = `const KEY = import.meta.env.VITE_ENCRYPTION_KEY || 'fallback';`;
      const result = applyDefineReplacements(code, define);
      // The result must not contain a bare `import.meta.env` that would be
      // `undefined` at browser runtime. The full env object must be substituted
      // so that `.VITE_ENCRYPTION_KEY` resolves to `undefined` rather than throwing.
      expect(result).not.toMatch(/import\.meta\.env(?!\w)/);
      // The fallback string must still be present (the `||` expression is preserved).
      expect(result).toContain("'fallback'");
    });

    it("known VITE_ vars are still inlined as direct literals (not object property access)", () => {
      const define = buildDefineConfig(undefined, {
        VITE_API_URL: "https://api.example.com",
        MODE: "development",
      });
      const code = `const url = import.meta.env.VITE_API_URL;`;
      const result = applyDefineReplacements(code, define);
      // Known var → direct literal, not `{...}.VITE_API_URL`
      expect(result).toContain('"https://api.example.com"');
      expect(result).not.toContain("import.meta.env.VITE_API_URL");
    });
  });
});
