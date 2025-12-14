const { parentPort } = require("worker_threads");
const path = require("path");
const fs = require("fs");
const { transform } = require("@swc/core");
const postcss = require("postcss");
const postcssLoadConfig = require("postcss-load-config");
const postcssModules = require("postcss-modules");

let cachedPostcssConfig = null;
let postcssConfigFailed = false;

async function loadPostcssConfig(rootDir) {
  if (cachedPostcssConfig) return cachedPostcssConfig;
  if (postcssConfigFailed) return { plugins: [], options: {} };
  try {
    const { plugins, options } = await postcssLoadConfig({}, rootDir);
    cachedPostcssConfig = {
      plugins: Array.isArray(plugins) ? plugins : [],
      options: options ?? {},
    };
  } catch {
    postcssConfigFailed = true;
    cachedPostcssConfig = { plugins: [], options: {} };
  }
  return cachedPostcssConfig;
}

const enableSourceMaps = process.env.IONIFY_SOURCEMAPS === "true";

function parseMode() {
  const mode = (process.env.IONIFY_PARSER || "hybrid").toLowerCase();
  if (mode === "swc") return "swc";
  if (mode === "oxc") return "oxc";
  return "hybrid";
}

function resolveNativeBinding() {
  // Minimal loader to avoid importing TS helpers in worker context.
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "native", "ionify_core.node"),
    path.join(cwd, "target", "release", "ionify_core.node"),
    path.join(cwd, "target", "debug", "ionify_core.node"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(candidate);
      }
    } catch {
      // ignore and try next
    }
  }
  return null;
}

const native = resolveNativeBinding();

async function runSwcTransform(job) {
  const isTs = job.ext === ".ts" || job.ext === ".tsx";
  const isTsx = job.ext === ".tsx";
  const isJsx = job.ext === ".jsx";

  const result = await transform(job.code, {
    filename: job.filePath,
    sourceMaps: enableSourceMaps ? "inline" : false,
    minify: true,
    module: { type: "es6" },
    jsc: {
      target: "es2022",
      minify: {
        compress: true,
        mangle: true,
      },
      parser: isTs
        ? {
            syntax: "typescript",
            tsx: isTsx,
            decorators: true,
            dynamicImport: true,
          }
        : {
            syntax: "ecmascript",
            jsx: isJsx,
            decorators: true,
            dynamicImport: true,
          },
      transform: isTsx || isJsx
        ? {
            react: {
              development: false,
              runtime: "automatic",
            },
          }
        : undefined,
    },
  });

  return { code: result.code, map: result.map || undefined, type: "js" };
}

async function runCssTransform(job) {
  const rootDir = process.cwd();
  const { plugins, options } = await loadPostcssConfig(rootDir);
  const isModule = /\.module\.css$/i.test(job.filePath);

  const pipeline = [...plugins];
  if (isModule) {
    pipeline.push(
      postcssModules({
        generateScopedName: (name, filename) => {
          const base = path.basename(filename).replace(/\.[^.]+$/, "");
          return `${base}__${name}`;
        },
      })
    );
  }

  const runner = postcss(pipeline);
  const result = await runner.process(job.code, {
    ...options,
    from: job.filePath,
    map: false,
  });

  return { code: result.css, type: "css" };
}

function runNativeOxcTransform(job) {
  if (!native?.parseAndTransformOxc) {
    throw new Error("Native oxc transform not available");
  }
  
  const result = native.parseAndTransformOxc(job.code, {
    filename: job.filePath,
    jsx: job.ext === ".jsx" || job.ext === ".tsx",
    typescript: job.ext === ".ts" || job.ext === ".tsx",
    react_refresh: false, // Production build - no refresh
  });
  
  return { code: result.code, map: result.map || undefined, type: "js" };
}

function runNativeSwcTransform(job) {
  if (!native?.parseAndTransformSwc) {
    throw new Error("Native SWC transform not available");
  }
  
  const result = native.parseAndTransformSwc(job.code, {
    filename: job.filePath,
    jsx: job.ext === ".jsx" || job.ext === ".tsx",
    typescript: job.ext === ".ts" || job.ext === ".tsx",
    react_refresh: false, // Production build - no refresh
  });
  
  return { code: result.code, map: result.map || undefined, type: "js" };
}

async function handleJob(job) {
  const mode = parseMode();
  const ext = job.ext.toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    if (mode === "swc") {
      // Force SWC via native or fallback
      if (native?.parseAndTransformSwc) {
        return runNativeSwcTransform(job);
      }
      return runSwcTransform(job);
    }
    if (mode === "oxc") {
      // Force oxc via native (fail if unavailable)
      if (!native?.parseAndTransformOxc) {
        throw new Error("parser=oxc requires native binding");
      }
      return runNativeOxcTransform(job);
    }
    // hybrid: try native oxc, silent fallback to native swc or JS swc
    if (native?.parseAndTransformOxc) {
      try {
        return runNativeOxcTransform(job);
      } catch {
        // Silent fallback
      }
    }
    if (native?.parseAndTransformSwc) {
      return runNativeSwcTransform(job);
    }
    // Last resort: JS-side SWC
    return runSwcTransform(job);
  }
  if (ext === ".css") {
    return runCssTransform(job);
  }
  return { code: job.code, type: "asset" };
}

parentPort.on("message", async (job) => {
  try {
    const result = await handleJob(job);
    parentPort.postMessage({
      id: job.id,
      filePath: job.filePath,
      code: result.code,
      map: result.map,
      type: result.type,
    });
  } catch (err) {
    parentPort.postMessage({
      id: job.id,
      filePath: job.filePath,
      code: job.code,
      type: "asset",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
