/**
 * Unit tests for React Refresh Instrumentation (Phase 5.6.2.1)
 * 
 * These tests verify that the extracted instrumentation module
 * preserves the exact behavior from js.ts (d63add4).
 */

import { describe, it, expect } from "vitest";
import { instrumentReactRefresh } from "@core/refresh/reactRefreshInstrumentation";

describe("instrumentReactRefresh", () => {
  describe("early exits (no instrumentation)", () => {
    it("returns empty when not dev mode", async () => {
      const result = await instrumentReactRefresh({
        code: "export const App = () => <div/>",
        filePath: "/src/App.tsx",
        ext: ".tsx",
        isDev: false,
      });
      
      expect(result.shouldInstrument).toBe(false);
      expect(result.prologue).toBe("");
      expect(result.registrations).toBe("");
      expect(result.epilogue).toBe("");
    });

    it("returns empty for non-JSX extensions", async () => {
      const result = await instrumentReactRefresh({
        code: "export const config = { foo: 'bar' }",
        filePath: "/src/config.ts",
        ext: ".ts",
        isDev: true,
      });
      
      expect(result.shouldInstrument).toBe(false);
      expect(result.prologue).toBe("");
      expect(result.registrations).toBe("");
      expect(result.epilogue).toBe("");
    });

    it("instruments entry modules but skips registrations", async () => {
      const result = await instrumentReactRefresh({
        code: "export const App = () => <div/>",
        filePath: "/src/main.tsx",
        ext: ".tsx",
        isDev: true,
        isEntry: true,
      });
      
      expect(result.shouldInstrument).toBe(true);
      expect(result.prologue).toContain("setupReactRefresh");
      expect(result.registrations).toBe("");
      expect(result.epilogue).toContain("finalize");
    });

    it("keeps entry runtime init even for typical entry code", async () => {
      // This is the key test for Phase 5.6.2.1 Task 2
      const entryCode = `
        import { createRoot } from "react-dom/client";
        import { App } from "./App";
        const root = createRoot(document.getElementById("root")!);
        root.render(<App />);
      `;
      
      const result = await instrumentReactRefresh({
        code: entryCode,
        filePath: "/src/main.tsx",
        ext: ".tsx",
        isDev: true,
        isEntry: true, // Entry modules get runtime init but no registrations
      });
      
      // Entry modules should get runtime init but never per-component registrations.
      expect(result.shouldInstrument).toBe(true);
      expect(result.prologue).toContain("setupReactRefresh");
      expect(result.registrations).toBe("");
      expect(result.epilogue).toContain("import.meta.hot.accept");
    });
  });

  describe("instrumentation generation", () => {
    it("generates prologue for .tsx files in dev", async () => {
      const result = await instrumentReactRefresh({
        code: "export const App = () => <div/>",
        filePath: "/src/App.tsx",
        ext: ".tsx",
        isDev: true,
      });
      
      expect(result.shouldInstrument).toBe(true);
      expect(result.prologue).toContain("import { setupReactRefresh, normalizeRefreshModuleId }");
      expect(result.prologue).toContain("/__ionify_hmr_client.js");
      expect(result.prologue).toContain("const __ionifyRefresh__ = setupReactRefresh");
      expect(result.prologue).toContain("normalizeRefreshModuleId(import.meta.url)");
    });

    it("generates prologue for .jsx files in dev", async () => {
      const result = await instrumentReactRefresh({
        code: "export const App = () => <div/>",
        filePath: "/src/App.jsx",
        ext: ".jsx",
        isDev: true,
      });
      
      expect(result.shouldInstrument).toBe(true);
      expect(result.prologue).toContain("setupReactRefresh");
    });

    it("generates epilogue with finalize and HMR accept", async () => {
      const result = await instrumentReactRefresh({
        code: "export const App = () => <div/>",
        filePath: "/src/App.tsx",
        ext: ".tsx",
        isDev: true,
      });
      
      expect(result.shouldInstrument).toBe(true);
      expect(result.epilogue).toContain("__ionifyRefresh__?.finalize?.()");
      expect(result.epilogue).toContain("import.meta.hot.accept");
      expect(result.epilogue).toContain("__ionifyRefresh__?.refresh?.(newModule)");
      expect(result.epilogue).toContain("import.meta.hot.dispose");
      expect(result.epilogue).toContain("__ionifyRefresh__?.dispose?.()");
    });
  });

  describe("registration generation", () => {
    it("generates registrations for PascalCase named exports", async () => {
      const code = `export const Counter = () => <div/>`;
      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/Counter.tsx",
        ext: ".tsx",
        isDev: true,
      });
      
      expect(result.shouldInstrument).toBe(true);
      expect(result.registrations).toContain("window.$RefreshReg$");
      expect(result.registrations).toContain("Counter");
      expect(result.registrations).toContain("normalizeRefreshModuleId(import.meta.url)");
      expect(result.registrations).toContain(`+ ":" + "Counter"`);
    });

    it("generates registrations for default exports", async () => {
      const code = `export default function App() { return <div/> }`;
      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/App.tsx",
        ext: ".tsx",
        isDev: true,
      });
      
      expect(result.shouldInstrument).toBe(true);
      expect(result.registrations).toContain("window.$RefreshReg$");
      expect(result.registrations).toContain("App");
      expect(result.registrations).toContain("normalizeRefreshModuleId(import.meta.url)");
      expect(result.registrations).toContain(`+ ":" + "default"`);
    });

    it("generates registrations for exported class components", async () => {
      const code = `
        import React from "react";
        export class HelloClass extends React.Component {
          render() { return <div>Hello</div>; }
        }
      `;
      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/components/HelloClass.tsx",
        ext: ".tsx",
        isDev: true,
      });

      expect(result.shouldInstrument).toBe(true);
      expect(result.registrations).toContain("window.$RefreshReg$");
      expect(result.registrations).toContain("HelloClass");
      expect(result.registrations).toContain(`+ ":" + "HelloClass"`);
    });

    it("generates registrations for default exported class components", async () => {
      const code = `
        import React from "react";
        export default class HelloClass extends React.Component {
          render() { return <div>Hello</div>; }
        }
      `;
      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/components/HelloClass.tsx",
        ext: ".tsx",
        isDev: true,
      });

      expect(result.shouldInstrument).toBe(true);
      expect(result.registrations).toContain("window.$RefreshReg$");
      expect(result.registrations).toContain("HelloClass");
      expect(result.registrations).toContain(`+ ":" + "default"`);
    });

    it("generates registrations for local export lists", async () => {
      const code = `
        const Counter = () => <div/>;
        export { Counter };
      `;

      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/Counter.tsx",
        ext: ".tsx",
        isDev: true,
      });

      expect(result.shouldInstrument).toBe(true);
      expect(result.registrations).toContain("window.$RefreshReg$");
      expect(result.registrations).toContain("Counter");
      expect(result.registrations).toContain(`+ ":" + "Counter"`);
    });

    it("supports export list aliases and `as default`", async () => {
      const code = `
        const Counter = () => <div/>;
        export { Counter as FancyCounter };
        export { Counter as default };
      `;

      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/Counter.tsx",
        ext: ".tsx",
        isDev: true,
      });

      expect(result.shouldInstrument).toBe(true);
      expect(result.registrations).toContain("window.$RefreshReg$");
      expect(result.registrations).toContain("Counter");
      expect(result.registrations).toContain(`+ ":" + "FancyCounter"`);
      expect(result.registrations).toContain(`+ ":" + "default"`);
    });

    it("does not register re-exports from other modules", async () => {
      const code = `export { Counter } from "./Counter";`;
      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/index.tsx",
        ext: ".tsx",
        isDev: true,
      });

      expect(result.shouldInstrument).toBe(true);
      expect(result.registrations).toBe("");
    });

    it("skips registrations for non-PascalCase exports", async () => {
      const code = `export const config = { foo: 'bar' }`;
      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/config.tsx",
        ext: ".tsx",
        isDev: true,
      });
      
      expect(result.shouldInstrument).toBe(true);
      expect(result.registrations).toBe(""); // no component to register
    });

    it("skips registrations if already present (avoid duplicates)", async () => {
      const code = `
        export const App = () => <div/>;
        window.$RefreshReg$(App, "existing");
      `;
      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/App.tsx",
        ext: ".tsx",
        isDev: true,
      });
      
      expect(result.shouldInstrument).toBe(true);
      expect(result.registrations).toBe(""); // already has $RefreshReg$
    });

    it("generates stable IDs without query parameters", async () => {
      const code = `export const Counter = () => <div/>`;
      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/components/Counter.tsx",
        ext: ".tsx",
        isDev: true,
      });
      
      expect(result.registrations).toContain("normalizeRefreshModuleId(import.meta.url)");
      // ID stability is enforced at runtime by stripping import.meta.url search params.
      expect(result.registrations).not.toContain("import.meta.url?");
      expect(result.registrations).not.toContain("ionify-hmr");
    });
  });

  describe("complete instrumentation flow", () => {
    it("assembles all parts correctly", async () => {
      // Use transpiled code (no JSX) since instrumentation runs AFTER transform
      const code = `export const Counter = () => { return React.createElement("button", null, "Click me"); };`;
      
      const result = await instrumentReactRefresh({
        code,
        filePath: "/src/Counter.tsx",
        ext: ".tsx",
        isDev: true,
      });
      
      // Verify complete flow
      expect(result.shouldInstrument).toBe(true);
      
      // Prologue imports runtime
      expect(result.prologue).toContain("import { setupReactRefresh");
      
      // Registrations register components
      expect(result.registrations).toContain("$RefreshReg$");
      expect(result.registrations).toContain("Counter");
      
      // Epilogue calls finalize and sets up HMR
      expect(result.epilogue).toContain("__ionifyRefresh__?.finalize");
      expect(result.epilogue).toContain("import.meta.hot.accept");
      
      // Final assembled code structure (when used):
      // prologue + [original code] + registrations + epilogue
      const assembledStructure = `${result.prologue}[CODE]${result.registrations}${result.epilogue}`;
      expect(assembledStructure).toMatch(/setupReactRefresh.*\[CODE\].*\$RefreshReg\$.*finalize/s);
    });
  });
});
