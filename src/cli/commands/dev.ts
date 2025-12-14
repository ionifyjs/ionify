import { native } from "@native/index";
import { loadIonifyConfig } from "@cli/utils/config";
import { logInfo, logError } from "@cli/utils/logger";

interface DevOptions {
  port?: string;
}

export async function startDevServer(options: DevOptions = {}) {
  try {
    const config = await loadIonifyConfig();
    const port = parseInt(options.port || config?.server?.port || "5173");

    logInfo(`Starting Ionify dev server on port ${port}...`);
    
    // Call native Rust implementation
    const result = native.startDevServer({
      port,
      root: process.cwd(),
      config: config || {},
    });

    logInfo(`Dev server running at http://localhost:${port}`);
    return result;
  } catch (err: any) {
    logError(`Dev server failed: ${err.message}`);
    throw err;
  }
}
