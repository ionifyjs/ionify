export function isTypeDeclarationPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase().split("?")[0]?.split("#")[0] ?? "";
  return (
    normalized.endsWith(".d.ts") ||
    normalized.endsWith(".d.mts") ||
    normalized.endsWith(".d.cts")
  );
}
