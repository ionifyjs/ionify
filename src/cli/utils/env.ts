import fs from "fs";
import path from "path";

export type EnvRecord = Record<string, string>;

function parseValue(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  return value;
}

function parseEnvFile(source: string): EnvRecord {
  const env: EnvRecord = {};
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_\.]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rest] = match;
    env[key] = parseValue(rest);
  }
  return env;
}

export function loadEnv(mode = "development", rootDir = process.cwd()): EnvRecord {
  const candidates = [
    ".env",
    ".env.local",
    `.env.${mode}`,
    `.env.${mode}.local`,
  ];
  const merged: EnvRecord = {};
  for (const name of candidates) {
    const filePath = path.resolve(rootDir, name);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      continue;
    }
    const contents = fs.readFileSync(filePath, "utf8");
    const parsed = parseEnvFile(contents);
    Object.assign(merged, parsed);
  }

  for (const [key, value] of Object.entries(merged)) {
    process.env[key] = value;
  }

  return {
    ...merged,
  };
}
