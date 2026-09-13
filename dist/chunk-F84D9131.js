#!/usr/bin/env node

// tsup/assets/esm_shims.js
import path from "path";
import { fileURLToPath } from "url";
var getFilename = () => fileURLToPath(import.meta.url);
var __filename = /* @__PURE__ */ getFilename();

export {
  __filename
};
