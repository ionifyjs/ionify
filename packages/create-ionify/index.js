#!/usr/bin/env node
import fs from "fs";
import path from "path";
import process from "process";
import { spawnSync } from "child_process";
import readline from "readline";
import readlinePromises from "readline/promises";

const IONIFY_ENGINE_PACKAGE = "@ionify/ionify";

function log(line = "") {
  process.stdout.write(String(line) + "\n");
}

function warn(line) {
  process.stderr.write(String(line) + "\n");
}

function fail(message, code = 1) {
  warn(`[create-ionify] ${message}`);
  process.exit(code);
}

function sanitizeProjectName(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  // npm-safe-ish name (not exhaustive, but avoids obvious issues)
  const out = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_./]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return out || null;
}

function detectPackageManagerField(pm) {
  const bin =
    pm === "pnpm" ? "pnpm" : pm === "npm" ? "npm" : pm === "yarn" ? "yarn" : pm === "bun" ? "bun" : null;
  if (!bin) return null;
  try {
    const res = spawnSync(bin, ["--version"], { encoding: "utf8" });
    const raw = String(res.stdout ?? res.stderr ?? "").trim();
    const m = raw.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
    const version = m ? m[0] : null;
    // Turbo only needs the field, but keeping it semver-ish avoids follow-up errors.
    if (res.status === 0 && version) return `${pm}@${version}`;
  } catch {
    // ignore
  }
  // Deterministic fallback (still semver-ish).
  if (pm === "pnpm") return "pnpm@10.0.0";
  if (pm === "npm") return "npm@10.0.0";
  if (pm === "yarn") return "yarn@1.22.22";
  if (pm === "bun") return "bun@1.1.0";
  return null;
}

function parseArgs(argv) {
  const out = {
    name: null,
    typescript: null,
    template: null,
    monorepo: null,
    testing: null,
    componentLibrary: null,
    pm: null,
    install: null,
    git: null,
    force: false,
    defaults: false,
    help: false,
  };

  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--force" || a === "-f") out.force = true;
    else if (a === "--yes" || a === "--defaults") out.defaults = true;
    else if (a === "--name") out.name = args[++i] ?? null;
    else if (a === "--ts") out.typescript = true;
    else if (a === "--js") out.typescript = false;
    else if (a === "--template") out.template = args[++i] ?? null;
    else if (a === "--monorepo") out.monorepo = true;
    else if (a === "--no-monorepo") out.monorepo = false;
    else if (a === "--testing") out.testing = args[++i] ?? null;
    else if (a === "--components") out.componentLibrary = args[++i] ?? null;
    else if (a === "--pm") out.pm = args[++i] ?? null;
    else if (a === "--install") out.install = true;
    else if (a === "--skip-install" || a === "--no-install") out.install = false;
    else if (a === "--git") out.git = true;
    else if (a === "--skip-git" || a === "--no-git") out.git = false;
    else if (!a.startsWith("-") && !out.name) out.name = a;
  }
  return out;
}

function printHelp() {
  log(`create-ionify

Usage:
  npm create ionify@latest
  npx create-ionify@latest

Interactive:
  In a TTY terminal, lists use Up/Down arrows + Enter (defaults are marked).

Options:
  --name <dir>            Project directory name
  --ts | --js             App code language
  --template <name>       basic | dashboard
  --monorepo              Generate a turborepo-style workspace
  --no-monorepo
  --testing <preset>      vitest | playwright | both
  --components <mode>     none | copy
  --pm <pm>               pnpm | npm | yarn | bun
  --install | --skip-install
  --git | --skip-git
  --force                 Overwrite existing directory (dangerous)
  --yes                   Use defaults (non-interactive)
  -h, --help              Show help
`);
}

function isInteractiveTty() {
  return !!(process.stdin.isTTY && process.stdout.isTTY);
}

function colorsEnabled() {
  if (!isInteractiveTty()) return false;
  if (process.env.NO_COLOR) return false;
  const term = String(process.env.TERM ?? "");
  if (!term || term === "dumb") return false;
  return true;
}

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
};

function paint(code, text) {
  if (!colorsEnabled()) return String(text);
  return `${code}${text}${ANSI.reset}`;
}

function paintMany(codes, text) {
  if (!colorsEnabled()) return String(text);
  return `${codes.join("")}${text}${ANSI.reset}`;
}

const UI = {
  brand: (s) => paintMany([ANSI.bold, ANSI.cyan], s),
  q: (s) => paint(ANSI.cyan, s),
  answer: (s) => paintMany([ANSI.bold, ANSI.green], s),
  step: (s) => paint(ANSI.gray, s),
  dim: (s) => paint(ANSI.dim, s),
  gray: (s) => paint(ANSI.gray, s),
  bold: (s) => paint(ANSI.bold, s),
  selected: (s) => paintMany([ANSI.bold, ANSI.cyan], s),
};

function formatStep(step, total) {
  if (!step || !total) return "";
  return `[${step}/${total}] `;
}

function printIntro() {
  log("");
  log(UI.brand("Create Ionify App"));
  log(UI.dim("-----------------"));
  if (isInteractiveTty()) {
    log(UI.dim("Tips:"));
    log(UI.dim("  - Use Up/Down arrows to navigate"));
    log(UI.dim("  - Press Enter to confirm (defaults are marked)"));
    log(UI.dim("  - Press Ctrl+C or Esc to cancel"));
  } else {
    log(UI.dim("Tips:"));
    log(UI.dim("  - Press Enter to accept the default shown in the prompt"));
  }
}

async function promptTextPrefill(question, defValue, step, total) {
  if (!isInteractiveTty()) {
    const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await askText(rl, `${formatStep(step, total)}${question}`, defValue);
    } finally {
      rl.close();
    }
  }

  const query = `${UI.q("?")} ${UI.step(formatStep(step, total))}${UI.bold(`${question}:`)} `;
  return await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(String(answer ?? "").trim() || String(defValue ?? ""));
    });
  if (defValue) rl.write(String(defValue));
  });
}

async function promptSelect(question, options, defValue, step, total) {
  if (!isInteractiveTty()) {
    const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await askChoice(rl, `${formatStep(step, total)}${question}`, options, defValue);
    } finally {
      rl.close();
    }
  }

  const labels = options.map((o) => String(o.label));
  const values = options.map((o) => o.value);
  const defIndex = Math.max(0, values.findIndex((v) => v === defValue));
  let index = defIndex;

  const stdout = process.stdout;
  const stdin = process.stdin;

  // Render: question + options (no per-question hint; tips are shown once at the top)
  const totalLines = 1 + options.length;

  const render = (first = false) => {
    if (!first) {
      readline.moveCursor(stdout, 0, -totalLines);
    }
    readline.cursorTo(stdout, 0);
    readline.clearScreenDown(stdout);

    stdout.write(`${UI.q("?")} ${UI.step(formatStep(step, total))}${UI.bold(question)}\n`);
    for (let i = 0; i < options.length; i++) {
      const isSelected = i === index;
      const isDefault = i === defIndex;
      const mark = isSelected ? UI.q(">") : " ";
      const label = isSelected ? UI.selected(labels[i]) : labels[i];
      const def = isDefault ? UI.gray(" (default)") : "";
      stdout.write(`  ${mark} ${label}${def}\n`);
    }
  };

  readline.emitKeypressEvents(stdin);
  stdin.resume();
  try {
    stdin.setRawMode(true);
  } catch {
    // ignore (should not happen on a TTY, but keep robust)
  }

  render(true);

  return await new Promise((resolve) => {
    function cleanup(onExit) {
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore
      }
      stdin.pause();
      stdin.removeListener("keypress", onKeypress);
      if (typeof onExit === "function") onExit();
    }

    function onKeypress(_str, key) {
      if (!key) return;

      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        cleanup(() => {
          // Clear the prompt area and exit
          readline.moveCursor(stdout, 0, -totalLines);
          readline.cursorTo(stdout, 0);
          readline.clearScreenDown(stdout);
          stdout.write("\n");
        });
        process.exit(0);
      }

      if (key.name === "up" || key.name === "k") {
        index = (index - 1 + options.length) % options.length;
        render();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        index = (index + 1) % options.length;
        render();
        return;
      }
      if (key.name === "return") {
        const selectedLabel = labels[index];
        const selectedValue = values[index];
        cleanup(() => {
          readline.moveCursor(stdout, 0, -totalLines);
          readline.cursorTo(stdout, 0);
          readline.clearScreenDown(stdout);
          stdout.write(
            `${UI.q("?")} ${UI.step(formatStep(step, total))}${UI.bold(question)} ${UI.answer(
              selectedLabel,
            )}\n`,
          );
        });
        resolve(selectedValue);
      }
    }

    stdin.on("keypress", onKeypress);
  });
}

async function promptConfirm(question, defBool, step, total) {
  if (!isInteractiveTty()) {
    const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await askYesNo(rl, `${formatStep(step, total)}${question}`, !!defBool);
    } finally {
      rl.close();
    }
  }
  const options = [
    { label: "Yes", value: true },
    { label: "No", value: false },
  ];
  return await promptSelect(question, options, !!defBool, step, total);
}

async function askText(rl, question, def) {
  const q = def ? `${question} (${def}): ` : `${question}: `;
  const ans = String(await rl.question(q)).trim();
  return ans || def || "";
}

async function askYesNo(rl, question, defBool) {
  const suffix = defBool ? "Y/n" : "y/N";
  const ans = String(await rl.question(`${question} (${suffix}): `)).trim().toLowerCase();
  if (!ans) return !!defBool;
  if (["y", "yes", "1", "true"].includes(ans)) return true;
  if (["n", "no", "0", "false"].includes(ans)) return false;
  return !!defBool;
}

async function askChoice(rl, question, options, defValue) {
  log(question);
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    const mark = o.value === defValue ? "*" : " ";
    log(`  ${mark} ${i + 1}. ${o.label}`);
  }
  const defIndex = options.findIndex((o) => o.value === defValue);
  const defHint = defIndex >= 0 ? ` [default: ${defIndex + 1}]` : "";
  const raw = String(await rl.question(`Select (1-${options.length})${defHint}: `)).trim();
  if (!raw) return defValue;
  const idx = Number(raw);
  if (!Number.isFinite(idx) || idx < 1 || idx > options.length) return defValue;
  return options[idx - 1].value;
}

function ensureEmptyDir(targetDir, force) {
  if (!fs.existsSync(targetDir)) return;
  const entries = fs.readdirSync(targetDir);
  if (entries.length === 0) return;
  if (!force) {
    fail(`Target directory is not empty: ${targetDir} (use --force to overwrite)`);
  }
  // Very conservative: remove only known scaffold outputs.
  // If you want true wipe, do it manually.
  for (const name of entries) {
    const p = path.join(targetDir, name);
    fs.rmSync(p, { recursive: true, force: true });
  }
}

function writeFileAbs(absPath, content) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

function writeJsonAbs(absPath, obj) {
  writeFileAbs(absPath, JSON.stringify(obj, null, 2) + "\n");
}

function basicAppFiles({ ts }) {
  const ext = ts ? "tsx" : "jsx";
  const main = ts
    ? `import React from \"react\";\nimport { createRoot } from \"react-dom/client\";\nimport { BrowserRouter } from \"react-router-dom\";\nimport App from \"./App\";\nimport \"./styles.css\";\n\ncreateRoot(document.getElementById(\"root\")!).render(\n  <React.StrictMode>\n    <BrowserRouter>\n      <App />\n    </BrowserRouter>\n  </React.StrictMode>,\n);\n`
    : `import React from \"react\";\nimport { createRoot } from \"react-dom/client\";\nimport { BrowserRouter } from \"react-router-dom\";\nimport App from \"./App\";\nimport \"./styles.css\";\n\ncreateRoot(document.getElementById(\"root\")).render(\n  <React.StrictMode>\n    <BrowserRouter>\n      <App />\n    </BrowserRouter>\n  </React.StrictMode>,\n);\n`;

  const app = ts
    ? `import React from \"react\";\nimport { Link, Route, Routes } from \"react-router-dom\";\nimport Home from \"./pages/Home\";\nimport About from \"./pages/About\";\n\nexport default function App() {\n  return (\n    <div className=\"app\">\n      <header className=\"app__header\">\n        <div className=\"app__brand\">Ionify</div>\n        <nav className=\"app__nav\">\n          <Link to=\"/\">Home</Link>\n          <Link to=\"/about\">About</Link>\n        </nav>\n      </header>\n      <main className=\"app__main\">\n        <Routes>\n          <Route path=\"/\" element={<Home />} />\n          <Route path=\"/about\" element={<About />} />\n        </Routes>\n      </main>\n    </div>\n  );\n}\n`
    : `import React from \"react\";\nimport { Link, Route, Routes } from \"react-router-dom\";\nimport Home from \"./pages/Home\";\nimport About from \"./pages/About\";\n\nexport default function App() {\n  return (\n    <div className=\"app\">\n      <header className=\"app__header\">\n        <div className=\"app__brand\">Ionify</div>\n        <nav className=\"app__nav\">\n          <Link to=\"/\">Home</Link>\n          <Link to=\"/about\">About</Link>\n        </nav>\n      </header>\n      <main className=\"app__main\">\n        <Routes>\n          <Route path=\"/\" element={<Home />} />\n          <Route path=\"/about\" element={<About />} />\n        </Routes>\n      </main>\n    </div>\n  );\n}\n`;

  const home = ts
    ? `export default function Home() {\n  return (\n    <section>\n      <h1>Welcome</h1>\n      <p>\n        You are running Ionify dev with a persistent graph + content-addressed transforms.\n      </p>\n      <p>\n        Try editing this file and confirm Fast Refresh preserves state.\n      </p>\n    </section>\n  );\n}\n`
    : `export default function Home() {\n  return (\n    <section>\n      <h1>Welcome</h1>\n      <p>\n        You are running Ionify dev with a persistent graph + content-addressed transforms.\n      </p>\n      <p>\n        Try editing this file and confirm Fast Refresh preserves state.\n      </p>\n    </section>\n  );\n}\n`;

  const about = ts
    ? `export default function About() {\n  return (\n    <section>\n      <h1>About</h1>\n      <p>\n        Ionify unifies dev and prod into one engine: resolver → graph → transforms → CAS → output.\n      </p>\n    </section>\n  );\n}\n`
    : `export default function About() {\n  return (\n    <section>\n      <h1>About</h1>\n      <p>\n        Ionify unifies dev and prod into one engine: resolver → graph → transforms → CAS → output.\n      </p>\n    </section>\n  );\n}\n`;

  return {
    "index.html": `<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>Ionify App</title>\n  </head>\n  <body>\n    <div id=\"root\"></div>\n    <script type=\"module\" src=\"/src/main.${ext}\"></script>\n  </body>\n</html>\n`,
    "ionify.config.ts": `import { defineConfig } from \"${IONIFY_ENGINE_PACKAGE}\";\n\nexport default defineConfig({\n  entry: \"/src/main.${ext}\",\n  optimizeDeps: {\n    // Phase 6.x: few-request mode (progressive by default)\n    sharedChunks: \"auto\",\n    vendorPacks: \"auto\",\n    // Phase 5.5: usage-driven slimming (background)\n    packSlimming: \"auto\",\n    // Optional: preload common framework deps\n    vendor: \"auto\",\n  },\n});\n`,
    [`src/main.${ext}`]: main,
    [`src/App.${ext}`]: app,
    [`src/pages/Home.${ext}`]: home,
    [`src/pages/About.${ext}`]: about,
    "src/styles.css": `:root {\n  color-scheme: light;\n  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;\n}\n\nbody {\n  margin: 0;\n  background: #0b1020;\n  color: #e9ecf1;\n}\n\n.app__header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 16px 20px;\n  border-bottom: 1px solid rgba(255, 255, 255, 0.08);\n}\n\n.app__brand {\n  font-weight: 700;\n  letter-spacing: 0.3px;\n}\n\n.app__nav {\n  display: flex;\n  gap: 12px;\n}\n\n.app__nav a {\n  color: #a7b3ff;\n  text-decoration: none;\n}\n\n.app__nav a:hover {\n  text-decoration: underline;\n}\n\n.app__main {\n  padding: 20px;\n}\n\nh1 {\n  margin-top: 0;\n}\n`,
  };
}

function dashboardAppFiles({ ts }) {
  // Keep this template compatible with Ionify's current CSS pipeline:
  // Tailwind is optional, but included to match the roadmap "Dashboard" pitch.
  const base = basicAppFiles({ ts });
  const ext = ts ? "tsx" : "jsx";
  base["src/styles.css"] = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n:root {\n  color-scheme: light;\n}\n\nbody {\n  margin: 0;\n}\n`;
  base[`src/pages/Home.${ext}`] = ts
    ? `import { useMemo } from \"react\";\n\nfunction range(n: number): number[] {\n  return Array.from({ length: n }, (_, i) => i);\n}\n\nexport default function Home() {\n  const data = useMemo(() => range(12).map((i) => ({ label: String(i + 1), value: (i * 7) % 13 })), []);\n  return (\n    <section className=\"p-6\">\n      <h1 className=\"text-2xl font-bold\">Dashboard</h1>\n      <p className=\"text-sm text-slate-600\">A template optimized for large apps (UI + data + charts).</p>\n\n      <div className=\"mt-6 grid grid-cols-1 gap-4 md:grid-cols-3\">\n        {data.slice(0, 3).map((d) => (\n          <div key={d.label} className=\"rounded-xl border border-slate-200 bg-white p-4 shadow-sm\">\n            <div className=\"text-xs uppercase text-slate-500\">Metric {d.label}</div>\n            <div className=\"mt-2 text-2xl font-semibold\">{d.value}</div>\n          </div>\n        ))}\n      </div>\n\n      <div className=\"mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm\">\n        <div className=\"text-sm font-medium\">Placeholder chart</div>\n        <div className=\"mt-3 grid grid-cols-12 gap-2\">\n          {data.map((d) => (\n            <div key={d.label} className=\"col-span-1 flex flex-col justify-end\">\n              <div className=\"rounded bg-indigo-500\" style={{ height: 8 + d.value * 6 }} />\n            </div>\n          ))}\n        </div>\n      </div>\n    </section>\n  );\n}\n`
    : `import { useMemo } from \"react\";\n\nfunction range(n) {\n  return Array.from({ length: n }, (_, i) => i);\n}\n\nexport default function Home() {\n  const data = useMemo(() => range(12).map((i) => ({ label: String(i + 1), value: (i * 7) % 13 })), []);\n  return (\n    <section className=\"p-6\">\n      <h1 className=\"text-2xl font-bold\">Dashboard</h1>\n      <p className=\"text-sm text-slate-600\">A template optimized for large apps (UI + data + charts).</p>\n\n      <div className=\"mt-6 grid grid-cols-1 gap-4 md:grid-cols-3\">\n        {data.slice(0, 3).map((d) => (\n          <div key={d.label} className=\"rounded-xl border border-slate-200 bg-white p-4 shadow-sm\">\n            <div className=\"text-xs uppercase text-slate-500\">Metric {d.label}</div>\n            <div className=\"mt-2 text-2xl font-semibold\">{d.value}</div>\n          </div>\n        ))}\n      </div>\n\n      <div className=\"mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm\">\n        <div className=\"text-sm font-medium\">Placeholder chart</div>\n        <div className=\"mt-3 grid grid-cols-12 gap-2\">\n          {data.map((d) => (\n            <div key={d.label} className=\"col-span-1 flex flex-col justify-end\">\n              <div className=\"rounded bg-indigo-500\" style={{ height: 8 + d.value * 6 }} />\n            </div>\n          ))}\n        </div>\n      </div>\n    </section>\n  );\n}\n`;

  base["tailwind.config.cjs"] = `/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  content: [\"./index.html\", \"./src/**/*.{js,jsx,ts,tsx}\"],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n};\n`;
  base["postcss.config.cjs"] = `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`;
  return base;
}

function eslintConfigText({ ts }) {
  if (ts) {
    return `import js from "@eslint/js";\nimport tseslint from "typescript-eslint";\nimport reactHooks from "eslint-plugin-react-hooks";\nimport reactRefresh from "eslint-plugin-react-refresh";\n\nexport default [\n  js.configs.recommended,\n  ...tseslint.configs.recommended,\n  {\n    files: ["**/*.{jsx,tsx}"],\n    plugins: {\n      "react-hooks": reactHooks,\n      "react-refresh": reactRefresh,\n    },\n    rules: {\n      ...reactHooks.configs.recommended.rules,\n      "react-refresh/only-export-components": [\"warn\", { allowConstantExport: true }],\n    },\n  },\n  {\n    ignores: [\n      \"dist/**\",\n      \"node_modules/**\",\n      \".ionify/**\",\n    ],\n  },\n];\n`;
  }

  return `import js from "@eslint/js";\nimport reactHooks from "eslint-plugin-react-hooks";\nimport reactRefresh from "eslint-plugin-react-refresh";\n\nexport default [\n  js.configs.recommended,\n  {\n    files: ["**/*.{jsx,js}"],\n    plugins: {\n      "react-hooks": reactHooks,\n      "react-refresh": reactRefresh,\n    },\n    rules: {\n      ...reactHooks.configs.recommended.rules,\n      "react-refresh/only-export-components": [\"warn\", { allowConstantExport: true }],\n    },\n  },\n  {\n    ignores: [\n      \"dist/**\",\n      \"node_modules/**\",\n      \".ionify/**\",\n    ],\n  },\n];\n`;
}

function writeToolingFiles({ targetDir, ts }) {
  // eslint + prettier (smart defaults)
  writeFileAbs(path.join(targetDir, "eslint.config.js"), eslintConfigText({ ts }));
  writeFileAbs(
    path.join(targetDir, ".prettierrc"),
    JSON.stringify(
      {
        semi: true,
        singleQuote: false,
        trailingComma: "all",
        printWidth: 100,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileAbs(
    path.join(targetDir, ".prettierignore"),
    "dist\nnode_modules\n.ionify\n.DS_Store\n",
  );
}

function writeHuskyPrecommit({ targetDir }) {
  const huskyDir = path.join(targetDir, ".husky");
  fs.mkdirSync(huskyDir, { recursive: true });
  const hookPath = path.join(huskyDir, "pre-commit");
  writeFileAbs(
    hookPath,
    "#!/usr/bin/env sh\n. \"$(dirname -- \"$0\")/_/husky.sh\"\n\nnpx lint-staged\n",
  );
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // Best-effort; Windows/git may ignore chmod.
  }
}

function writeComponentLibrary({ targetDir, ts }) {
  const ext = ts ? "tsx" : "jsx";
  const dir = path.join(targetDir, "src/components/ui");
  fs.mkdirSync(dir, { recursive: true });
  writeFileAbs(
    path.join(dir, `button.${ext}`),
    ts
      ? `import * as React from "react";\n\ntype ButtonVariant = "default" | "secondary" | "ghost";\n\ntype ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {\n  variant?: ButtonVariant;\n};\n\nexport const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(\n  ({ variant = "default", className = "", ...props }, ref) => {\n    const base = "ionify-button";\n    const v =\n      variant === "secondary"\n        ? "ionify-button--secondary"\n        : variant === "ghost"\n          ? "ionify-button--ghost"\n          : \"\";\n    const cn = [base, v, className].filter(Boolean).join(\" \");\n    return <button ref={ref} className={cn} {...props} />;\n  },\n);\nButton.displayName = "Button";\n`
      : `import * as React from "react";\n\nexport const Button = React.forwardRef(function Button(\n  { variant = "default", className = "", ...props },\n  ref,\n) {\n  const base = "ionify-button";\n  const v =\n    variant === "secondary"\n      ? "ionify-button--secondary"\n      : variant === "ghost"\n        ? "ionify-button--ghost"\n        : \"\";\n  const cn = [base, v, className].filter(Boolean).join(\" \");\n  return <button ref={ref} className={cn} {...props} />;\n});\n`,
  );
  writeFileAbs(
    path.join(dir, `card.${ext}`),
    ts
      ? `import * as React from "react";\n\nexport function Card({ className = \"\", ...props }: React.HTMLAttributes<HTMLDivElement>) {\n  return <div className={[\"ionify-card\", className].filter(Boolean).join(\" \")} {...props} />;\n}\n\nexport function CardHeader({ className = \"\", ...props }: React.HTMLAttributes<HTMLDivElement>) {\n  return <div className={[\"ionify-card__header\", className].filter(Boolean).join(\" \")} {...props} />;\n}\n\nexport function CardTitle({ className = \"\", ...props }: React.HTMLAttributes<HTMLHeadingElement>) {\n  return <h3 className={[\"ionify-card__title\", className].filter(Boolean).join(\" \")} {...props} />;\n}\n\nexport function CardContent({ className = \"\", ...props }: React.HTMLAttributes<HTMLDivElement>) {\n  return <div className={[\"ionify-card__content\", className].filter(Boolean).join(\" \")} {...props} />;\n}\n`
      : `import * as React from "react";\n\nexport function Card({ className = \"\", ...props }) {\n  return <div className={[\"ionify-card\", className].filter(Boolean).join(\" \")} {...props} />;\n}\n\nexport function CardHeader({ className = \"\", ...props }) {\n  return <div className={[\"ionify-card__header\", className].filter(Boolean).join(\" \")} {...props} />;\n}\n\nexport function CardTitle({ className = \"\", ...props }) {\n  return <h3 className={[\"ionify-card__title\", className].filter(Boolean).join(\" \")} {...props} />;\n}\n\nexport function CardContent({ className = \"\", ...props }) {\n  return <div className={[\"ionify-card__content\", className].filter(Boolean).join(\" \")} {...props} />;\n}\n`,
  );
}

function basePackageJson({ name, ts, template, testing, tooling, git, packageManager }) {
  const deps = {
    react: "latest",
    "react-dom": "latest",
    "react-router-dom": "^6.26.2",
  };
  const devDeps = {
    [IONIFY_ENGINE_PACKAGE]: "latest",
    "react-refresh": "^0.18.0",
  };
  if (ts) {
    devDeps.typescript = "^5.6.3";
    devDeps["@types/react"] = "^19.2.7";
    devDeps["@types/react-dom"] = "^19.2.3";
  }

  if (template === "dashboard") {
    devDeps.tailwindcss = "^3.4.17";
    devDeps.autoprefixer = "^10.4.20";
    devDeps.postcss = "^8.4.47";
  }

  const scripts = {
    dev: "ionify dev",
    build: "ionify build",
  };

  if (tooling) {
    scripts.lint = "eslint .";
    scripts.format = "prettier -w .";
    scripts["format:check"] = "prettier -c .";
    devDeps.eslint = "^9.14.0";
    devDeps["@eslint/js"] = "^9.15.0";
    devDeps.prettier = "^3.3.3";
    devDeps["eslint-plugin-react-hooks"] = "^5.0.0";
    devDeps["eslint-plugin-react-refresh"] = "^0.4.14";
    if (ts) {
      devDeps["typescript-eslint"] = "^8.12.0";
    }
    if (git) {
      devDeps.husky = "^8.0.0";
      devDeps["lint-staged"] = "^15.2.0";
      scripts.prepare = "husky install";
    }
  }

  if (testing === "vitest" || testing === "both") {
    devDeps.vitest = "4.0.18";
    scripts.test = "vitest";
  }
  if (testing === "playwright" || testing === "both") {
    devDeps["@playwright/test"] = "^1.49.1";
    if (testing === "playwright") {
      scripts.test = "playwright test";
    }
    scripts["test:e2e"] = "playwright test";
  }

  const pkg = {
    name,
    private: true,
    type: "module",
    ...(packageManager ? { packageManager } : {}),
    scripts,
    dependencies: deps,
    devDependencies: devDeps,
  };
  if (tooling && git) {
    pkg["lint-staged"] = {
      "*.{js,jsx,ts,tsx,css,json,md}": ["prettier --write"],
      "*.{js,jsx,ts,tsx}": ["eslint --fix"],
    };
  }
  return pkg;
}

function writeAppScaffold({ targetDir, name, ts, template, testing, componentLibrary, tooling, git, packageManager }) {
  const files =
    template === "dashboard" ? dashboardAppFiles({ ts }) : basicAppFiles({ ts });

  for (const [rel, content] of Object.entries(files)) {
    writeFileAbs(path.join(targetDir, rel), content);
  }

  if (ts) {
    const vitestGlobals = testing === "vitest" || testing === "both";
    writeJsonAbs(path.join(targetDir, "tsconfig.json"), {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
          "@ui/*": ["src/components/ui/*"],
          "@utils/*": ["src/utils/*"],
        },
        ...(vitestGlobals ? { types: ["vitest/globals"] } : {}),
      },
      include: ["src"],
    });
  } else {
    writeJsonAbs(path.join(targetDir, "jsconfig.json"), {
      compilerOptions: {
        checkJs: false,
        jsx: "react-jsx",
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
          "@ui/*": ["src/components/ui/*"],
          "@utils/*": ["src/utils/*"],
        },
      },
      include: ["src"],
    });
  }

  // Smart defaults / dotfiles
  writeFileAbs(
    path.join(targetDir, ".gitignore"),
    `node_modules\n.ionify\ndist\n.DS_Store\n`,
  );
  writeFileAbs(path.join(targetDir, ".env"), "IONIFY_API_URL=http://localhost:3000\n");
  writeFileAbs(path.join(targetDir, ".env.development"), "IONIFY_API_URL=http://localhost:3000\n");
  writeFileAbs(path.join(targetDir, ".env.production"), "IONIFY_API_URL=https://api.example.com\n");

  if (tooling) {
    writeToolingFiles({ targetDir, ts });
  }
  if (git) {
    writeHuskyPrecommit({ targetDir });
  }
  if (componentLibrary === "copy") {
    writeComponentLibrary({ targetDir, ts });
  }

  const pkg = basePackageJson({ name, ts, template, testing, tooling, git, packageManager });
  writeJsonAbs(path.join(targetDir, "package.json"), pkg);

  // Testing templates (minimal, deterministic)
  if (testing === "vitest" || testing === "both") {
    const testExt = ts ? "ts" : "js";
    const cfgName = ts ? "vitest.config.ts" : "vitest.config.js";
    writeFileAbs(
      path.join(targetDir, cfgName),
      `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  test: {\n    environment: "node",\n  },\n});\n`,
    );
    writeFileAbs(
      path.join(targetDir, `src/smoke.test.${testExt}`),
      `import { describe, it, expect } from "vitest";\n\ndescribe("smoke", () => {\n  it("runs", () => {\n    expect(1 + 1).toBe(2);\n  });\n});\n`,
    );
  }

  if (testing === "playwright" || testing === "both") {
    const cfgName = ts ? "playwright.config.ts" : "playwright.config.js";
    const specExt = ts ? "ts" : "js";
    writeFileAbs(
      path.join(targetDir, cfgName),
      `import { defineConfig } from "@playwright/test";\n\nexport default defineConfig({\n  testDir: "./tests",\n});\n`,
    );
    writeFileAbs(
      path.join(targetDir, `tests/home.spec.${specExt}`),
      `import { test, expect } from "@playwright/test";\n\ntest("home page has a root", async ({ page }) => {\n  await page.goto("http://localhost:5173/");\n  await expect(page.locator("#root")).toBeVisible();\n});\n`,
    );
  }

  writeFileAbs(
    path.join(targetDir, "README.md"),
    `# ${name}\n\n## Dev\n\n\`\`\`bash\npnpm dev\n\`\`\`\n\n## Why Ionify?\n\nIonify is built around a persistent dependency graph + content-addressed transforms.\nThat means fast cold starts, faster warm starts, and deterministic caching.\n\n## Notes\n\n- Try \`ionify add button\` to copy a component into \`src/components/ui\`.\n- Ionify config lives in \`ionify.config.ts\`.\n`,
  );
}

function writeMonorepoScaffold({ targetDir, name, ts, template, testing, componentLibrary, git, packageManager }) {
  // Root workspace
  writeFileAbs(
    path.join(targetDir, "pnpm-workspace.yaml"),
    `packages:\n  - \"apps/*\"\n  - \"packages/*\"\n`,
  );
  writeJsonAbs(path.join(targetDir, "package.json"), {
    name,
    private: true,
    type: "module",
    ...(packageManager ? { packageManager } : {}),
    workspaces: ["apps/*", "packages/*"],
    scripts: {
      dev: "turbo run dev --parallel --filter=web",
      build: "turbo run build --filter=web",
      test: "turbo run test --filter=web",
      lint: "eslint .",
      format: "prettier -w .",
      "format:check": "prettier -c .",
      ...(git ? { prepare: "husky install" } : {}),
    },
    devDependencies: {
      turbo: "^2.0.0",
      eslint: "^9.14.0",
      "@eslint/js": "^9.15.0",
      prettier: "^3.3.3",
      "eslint-plugin-react-hooks": "^5.0.0",
      "eslint-plugin-react-refresh": "^0.4.14",
      ...(ts ? { "typescript-eslint": "^8.12.0" } : {}),
      ...(git ? { husky: "^8.0.0", "lint-staged": "^15.2.0" } : {}),
    },
    ...(git
      ? {
          "lint-staged": {
            "*.{js,jsx,ts,tsx,css,json,md}": ["prettier --write"],
            "*.{js,jsx,ts,tsx}": ["eslint --fix"],
          },
        }
      : {}),
  });
  writeFileAbs(
    path.join(targetDir, "turbo.json"),
    JSON.stringify(
      {
        $schema: "https://turbo.build/schema.json",
        // Turbo 2.x schema: "pipeline" was renamed to "tasks".
        // Keep the config compatible with current Turbo while preserving intent.
        tasks: {
          dev: { cache: false },
          build: { dependsOn: ["^build"], outputs: ["dist/**"] },
          test: { dependsOn: ["^test"], outputs: [] },
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileAbs(path.join(targetDir, ".gitignore"), "node_modules\n.ionify\ndist\n.turbo\n.DS_Store\n");
  writeToolingFiles({ targetDir, ts });
  if (git) {
    writeHuskyPrecommit({ targetDir });
  }

  // Shared packages
  const scope = sanitizeProjectName(name)?.replace(/[^a-z0-9-_]+/g, "-") ?? "app";
  const uiName = `@${scope}/ui`;
  const utilsName = `@${scope}/utils`;

  const pkgBase = (pkgName) => ({
    name: pkgName,
    private: true,
    type: "module",
    main: `src/index.${ts ? "ts" : "js"}`,
    exports: { ".": `./src/index.${ts ? "ts" : "js"}` },
  });

  writeJsonAbs(path.join(targetDir, "packages/ui/package.json"), pkgBase(uiName));
  writeFileAbs(
    path.join(targetDir, `packages/ui/src/index.${ts ? "ts" : "js"}`),
    `export { Button } from \"./button\";\n`,
  );
  writeFileAbs(
    path.join(targetDir, `packages/ui/src/button.${ts ? "tsx" : "jsx"}`),
    ts
      ? `import * as React from \"react\";\n\nexport function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {\n  return <button {...props} />;\n}\n`
      : `import * as React from \"react\";\n\nexport function Button(props) {\n  return <button {...props} />;\n}\n`,
  );
  writeJsonAbs(path.join(targetDir, "packages/utils/package.json"), pkgBase(utilsName));
  writeFileAbs(
    path.join(targetDir, `packages/utils/src/index.${ts ? "ts" : "js"}`),
    ts
      ? `export function formatNumber(n: number): string {\n  return new Intl.NumberFormat().format(n);\n}\n`
      : `export function formatNumber(n) {\n  return new Intl.NumberFormat().format(n);\n}\n`,
  );

  // App
  const appDir = path.join(targetDir, "apps/web");
  writeAppScaffold({
    targetDir: appDir,
    name: "web",
    ts,
    template,
    testing,
    componentLibrary,
    tooling: false,
    git: false,
    packageManager,
  });

  // Wire monorepo aliases in app config/tsconfig.
  const ionifyConfigPath = path.join(appDir, "ionify.config.ts");
  const configText = fs.readFileSync(ionifyConfigPath, "utf8");
  const aliasBlock =
    `  resolve: {\n` +
    `    alias: {\n` +
    `      \"@ui\": \"../../packages/ui/src\",\n` +
    `      \"@utils\": \"../../packages/utils/src\",\n` +
    `    },\n` +
    `  },\n`;
  const needle = "export default defineConfig({\n";
  const injected = configText.includes(needle)
    ? configText.replace(needle, `export default defineConfig({\n${aliasBlock}`)
    : `// WARNING: alias injection failed (template mismatch)\n${configText}`;
  writeFileAbs(ionifyConfigPath, injected);

  if (ts) {
    const tsconfigPath = path.join(appDir, "tsconfig.json");
    const cfg = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
    cfg.compilerOptions = cfg.compilerOptions ?? {};
    cfg.compilerOptions.baseUrl = ".";
    cfg.compilerOptions.paths = {
      "@ui/*": ["../../packages/ui/src/*"],
      "@utils/*": ["../../packages/utils/src/*"],
    };
    writeJsonAbs(tsconfigPath, cfg);
  } else {
    const jsconfigPath = path.join(appDir, "jsconfig.json");
    const cfg = JSON.parse(fs.readFileSync(jsconfigPath, "utf8"));
    cfg.compilerOptions = cfg.compilerOptions ?? {};
    cfg.compilerOptions.baseUrl = ".";
    cfg.compilerOptions.paths = {
      "@ui/*": ["../../packages/ui/src/*"],
      "@utils/*": ["../../packages/utils/src/*"],
    };
    writeJsonAbs(jsconfigPath, cfg);
  }

  // Root README
  writeFileAbs(
    path.join(targetDir, "README.md"),
    `# ${name}\n\n## Dev\n\n\`\`\`bash\npnpm dev\n\`\`\`\n\n## Structure\n\n- apps/web: main app (Ionify dev server)\n- packages/ui: shared UI\n- packages/utils: shared utilities\n\n## Notes\n\n- HMR works across packages (edit \`packages/ui\` and see updates in \`apps/web\`).\n- Lint/format at the workspace root.\n`,
  );
}

function tryRun(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  return res.status === 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const defaults = {
    name: "my-ionify-app",
    typescript: true,
    template: "basic",
    monorepo: false,
    testing: "vitest",
    componentLibrary: "none",
    pm: "pnpm",
    install: true,
    git: true,
  };

  let name = sanitizeProjectName(args.name) ?? (args.defaults ? defaults.name : null);
  let typescript = args.typescript ?? (args.defaults ? defaults.typescript : null);
  let template = args.template ?? (args.defaults ? defaults.template : null);
  let monorepo = args.monorepo ?? (args.defaults ? defaults.monorepo : null);
  let testing = args.testing ?? (args.defaults ? defaults.testing : null);
  let componentLibrary =
    args.componentLibrary ?? (args.defaults ? defaults.componentLibrary : null);
  let pm = args.pm ?? (args.defaults ? defaults.pm : null);
  let install = args.install ?? (args.defaults ? defaults.install : null);
  let git = args.git ?? (args.defaults ? defaults.git : null);

  if (!args.defaults) {
    printIntro();
    const totalSteps = 9;
    let step = 1;

    const rawName = await promptTextPrefill("Project name", name ?? defaults.name, step++, totalSteps);
    name = sanitizeProjectName(rawName) ?? defaults.name;

    typescript = await promptConfirm("TypeScript?", typescript ?? defaults.typescript, step++, totalSteps);

    template = await promptSelect(
      "Template:",
      [
        { label: "Basic (React + Router)", value: "basic" },
        { label: "Dashboard (Tailwind + charts placeholder)", value: "dashboard" },
      ],
      template ?? defaults.template,
      step++,
      totalSteps,
    );

    monorepo = await promptConfirm(
      "Monorepo (apps/web + packages/* + turbo)?",
      monorepo ?? defaults.monorepo,
      step++,
      totalSteps,
    );

    testing = await promptSelect(
      "Testing preset:",
      [
        { label: "Vitest (unit)", value: "vitest" },
        { label: "Playwright (e2e)", value: "playwright" },
        { label: "Both", value: "both" },
      ],
      testing ?? defaults.testing,
      step++,
      totalSteps,
    );

    componentLibrary = await promptSelect(
      "Component library:",
      [
        { label: "None", value: "none" },
        { label: "Copy-paste (use `ionify add`)", value: "copy" },
      ],
      componentLibrary ?? defaults.componentLibrary,
      step++,
      totalSteps,
    );

    pm = await promptSelect(
      "Package manager:",
      [
        { label: "pnpm (recommended)", value: "pnpm" },
        { label: "npm", value: "npm" },
        { label: "yarn", value: "yarn" },
        { label: "bun", value: "bun" },
      ],
      pm ?? defaults.pm,
      step++,
      totalSteps,
    );

    install = await promptConfirm("Install dependencies now?", install ?? defaults.install, step++, totalSteps);
    git = await promptConfirm("Initialize git repo?", git ?? defaults.git, step++, totalSteps);
  }

  if (!name) fail("Missing project name");
  if (template !== "basic" && template !== "dashboard") template = defaults.template;
  if (testing !== "vitest" && testing !== "playwright" && testing !== "both") testing = defaults.testing;
  if (pm !== "pnpm" && pm !== "npm" && pm !== "yarn" && pm !== "bun") pm = defaults.pm;
  if (componentLibrary !== "none" && componentLibrary !== "copy") componentLibrary = defaults.componentLibrary;

  const packageManager = detectPackageManagerField(pm);

  const targetDir = path.resolve(process.cwd(), name);
  ensureEmptyDir(targetDir, args.force);
  fs.mkdirSync(targetDir, { recursive: true });

  if (monorepo) {
    writeMonorepoScaffold({
      targetDir,
      name,
      ts: !!typescript,
      template,
      testing,
      componentLibrary,
      git: !!git,
      packageManager,
    });
  } else {
    writeAppScaffold({
      targetDir,
      name,
      ts: !!typescript,
      template,
      testing,
      componentLibrary,
      tooling: true,
      git: !!git,
      packageManager,
    });
  }

  log("");
  log(UI.bold("Created project:"));
  log(`  ${UI.q(targetDir)}`);

  if (componentLibrary === "copy") {
    log("");
    log(UI.dim("Tip: add components with:"));
    log(`  ${UI.bold("ionify add button")}`);
  }

  if (git) {
    log("");
    log(UI.bold("Git:"));
    if (!tryRun("git", ["init"], targetDir)) {
      warn("  git init failed (is git installed?)");
    }
  }

  if (install) {
    log("");
    log(UI.bold("Installing dependencies..."));
    const ok =
      pm === "pnpm"
        ? tryRun("pnpm", ["install"], targetDir)
        : pm === "npm"
          ? tryRun("npm", ["install"], targetDir)
          : pm === "yarn"
            ? tryRun("yarn", [], targetDir)
            : tryRun("bun", ["install"], targetDir);
    if (!ok) {
      warn("Dependency install failed. You can install later.");
    }
  }

  log("");
  log(UI.bold("Next steps:"));
  log(`  ${UI.bold(`cd ${name}`)}`);
  if (!install) {
    log(`  ${UI.bold(`${pm} install`)}`);
  }
  log(`  ${UI.bold(`${pm} dev`)}`);
  log("");
}

main().catch((err) => {
  fail(err?.stack || String(err));
});
