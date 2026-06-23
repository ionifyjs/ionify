#!/usr/bin/env node
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// node_modules/.pnpm/tsup@8.5.0_@swc+core@1.13.5_jiti@1.21.7_postcss@8.5.6_tsx@4.20.6_typescript@5.9.3_yaml@2.8.1/node_modules/tsup/assets/esm_shims.js
import path from "path";
import { fileURLToPath } from "url";
var getFilename = () => fileURLToPath(import.meta.url);
var __filename = /* @__PURE__ */ getFilename();

export {
  __require,
  __filename
};
