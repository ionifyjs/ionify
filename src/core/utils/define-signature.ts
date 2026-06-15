function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== "object") return val;
    if (Array.isArray(val)) return val;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      out[k] = (val as Record<string, unknown>)[k];
    }
    return out;
  });
}

export function computeDefineSignature(defineConfig: Record<string, unknown>): string {
  const keys = Object.keys(defineConfig).sort();
  if (keys.length === 0) return "";
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${key}=${stableStringify((defineConfig as any)[key])}`);
  }
  return parts.join("|");
}
