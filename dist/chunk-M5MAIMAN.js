#!/usr/bin/env node
import {
  logError,
  logInfo
} from "./chunk-SNACSSNX.js";

// src/cli/commands/login.ts
import readline2 from "readline";

// src/cli/utils/cloud-auth.ts
import fs from "fs";
import os from "os";
import path from "path";
var CREDENTIALS_FILE = path.join(os.homedir(), ".ionify", "credentials.json");
function resolveCloudToken(profile = "default") {
  const fromEnv = process.env.IONIFY_CLOUD_TOKEN;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  const creds = readCredentialsFile();
  return creds?.[profile]?.token ?? null;
}
function resolveCloudProfile(profile = "default") {
  const creds = readCredentialsFile();
  const entry = creds?.[profile];
  if (!entry?.token) return null;
  return entry;
}
function readCredentialsFile() {
  if (!fs.existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeCredentials(entry, profile = "default") {
  const dir = path.dirname(CREDENTIALS_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const existing = readCredentialsFile() ?? {};
  existing[profile] = entry;
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(existing, null, 2) + "\n", {
    encoding: "utf8",
    mode: 384
  });
}
function removeCredentials(profile = "default") {
  const creds = readCredentialsFile();
  if (!creds || !(profile in creds)) return;
  delete creds[profile];
  if (Object.keys(creds).length === 0) {
    fs.rmSync(CREDENTIALS_FILE, { force: true });
  } else {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2) + "\n", {
      encoding: "utf8",
      mode: 384
    });
  }
}

// src/cli/utils/prompt.ts
import readline from "readline";
import chalk from "chalk";
async function selectMenu(opts) {
  const { title, subtitle, options } = opts;
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) {
    return null;
  }
  let idx = Math.max(0, Math.min(opts.initial ?? 0, options.length - 1));
  const wasRaw = stdin.isRaw === true;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  readline.emitKeypressEvents(stdin);
  let renderedLines = 0;
  const render = () => {
    if (renderedLines > 0) {
      stdout.write(`\x1B[${renderedLines}A`);
    }
    let lines = 0;
    const write = (s) => {
      stdout.write(s + "\x1B[K\n");
      lines++;
    };
    write("");
    write(`${chalk.bold.cyan("?")}  ${chalk.bold(title)}`);
    if (subtitle) write(`   ${chalk.dim(subtitle)}`);
    write("");
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      const active = i === idx;
      const num = chalk.dim(`${i + 1}.`);
      const pointer = active ? chalk.cyanBright("\u276F") : " ";
      const label = active ? chalk.cyanBright.bold(o.label) : chalk.white(o.label);
      const tag = o.recommended ? "  " + chalk.green("(recommended)") : "";
      write(`  ${pointer} ${num} ${label}${tag}`);
      if (o.description) {
        write(`       ${active ? chalk.cyan(o.description) : chalk.dim(o.description)}`);
      }
    }
    write("");
    write(
      chalk.dim("  \u2191/\u2193 move   1-9 jump   \u23CE select   esc cancel")
    );
    renderedLines = lines;
  };
  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = (val) => {
      if (resolved) return;
      resolved = true;
      stdin.removeListener("keypress", onKey);
      try {
        stdin.setRawMode(wasRaw);
      } catch {
      }
      stdin.pause();
      stdout.write("\n");
      resolve(val);
    };
    const onKey = (_, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") return cleanup(null);
      if (key.name === "escape") return cleanup(null);
      if (key.name === "up" || key.name === "k") {
        idx = (idx - 1 + options.length) % options.length;
        render();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        idx = (idx + 1) % options.length;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup(options[idx].value);
        return;
      }
      const seq = key.sequence ?? "";
      if (/^[1-9]$/.test(seq)) {
        const n = parseInt(seq, 10) - 1;
        if (n >= 0 && n < options.length) {
          idx = n;
          render();
          cleanup(options[idx].value);
        }
      }
    };
    stdin.on("keypress", onKey);
    render();
  });
}

// src/cli/commands/login.ts
async function runLoginCommand(options = {}) {
  const prompt = (q) => new Promise((resolve) => {
    const rl = readline2.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
  logInfo("ionify login \u2014 connect to Ionify Cloud");
  logInfo("Login authenticates this machine. Use `ionify bind` to link a folder to a cloud project.\n");
  try {
    const existing = readCredentialsFile()?.default;
    const fallbackApiUrl = existing?.apiUrl?.trim() || "https://api.ionify.cloud";
    const apiUrl = options.apiUrl?.trim() || await prompt(`API URL [${fallbackApiUrl}]: `) || fallbackApiUrl;
    const token = options.token?.trim() || await promptForExistingToken(prompt);
    if (existing?.token && process.stdin.isTTY === true && process.stdout.isTTY === true && existing.apiUrl !== apiUrl) {
      const choice = await selectMenu({
        title: "Default login already exists",
        subtitle: `Current default API: ${existing.apiUrl ?? "unknown API"}.
New login API: ${apiUrl}`,
        options: [
          {
            value: "replace",
            label: "Replace default login",
            description: "Use the new token and API URL for future Ionify commands.",
            recommended: true
          },
          {
            value: "cancel",
            label: "Cancel",
            description: "Keep the current default login unchanged."
          }
        ],
        initial: 0
      });
      if (choice !== "replace") {
        logInfo("Login cancelled. Existing default credentials were kept.");
        return;
      }
    }
    writeCredentials({
      token,
      apiUrl
    });
    logInfo(`
\u2713 Logged in. Credentials saved to ~/.ionify/credentials.json`);
    logInfo(`  api_url    : ${apiUrl}`);
    logInfo("  next       : run `ionify bind --project <project-id>` from your project root");
  } finally {
  }
}
async function promptForExistingToken(prompt) {
  const token = await prompt("Token (ionify_pat_...): ");
  if (!token) {
    logError("login: token is required.");
    process.exit(1);
  }
  return token;
}
function runLogoutCommand() {
  removeCredentials();
  logInfo("\u2713 Logged out. Credentials removed from ~/.ionify/credentials.json");
}
async function runWhoamiCommand() {
  const token = resolveCloudToken();
  const source = process.env.IONIFY_CLOUD_TOKEN ? "IONIFY_CLOUD_TOKEN env" : "~/.ionify/credentials.json";
  if (!token) {
    logInfo("Not logged in. Run `ionify login` or set IONIFY_CLOUD_TOKEN.");
    return;
  }
  const creds = readCredentialsFile();
  const profile = creds?.default;
  logInfo("ionify whoami:");
  logInfo(`  token source : ${source}`);
  if (profile?.apiUrl) logInfo(`  api_url      : ${profile.apiUrl}`);
  logInfo(`  token        : ${token.slice(0, 12)}\u2026`);
}

export {
  resolveCloudToken,
  resolveCloudProfile,
  selectMenu,
  runLoginCommand,
  runLogoutCommand,
  runWhoamiCommand
};
