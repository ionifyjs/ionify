import { native } from "@native/index";
import { loadIonifyConfig } from "@cli/utils/config";
import { logInfo, logError } from "@cli/utils/logger";

interface BuildOptions {
  outDir?: string;
  level?: number;
}

export async function runBuildCommand(options: BuildOptions = {}) {
  try {
    const config = await loadIonifyConfig();
    const outDir = options.outDir || config?.build?.outDir || "dist";
    const level = options.level ?? config?.optimizationLevel ?? 3;

    logInfo(`Building for production (optimization level: ${level})...`);
    
    // Call native Rust implementation
    const result = native.build({
      root: process.cwd(),
      outDir,
      optimizationLevel: level,
      config: config || {},
    });

    logInfo(`✅ Build complete! Output: ${outDir}/`);
    return result;
  } catch (err: any) {
    logError(`Build failed: ${err.message}`);
    throw err;
  }
}
