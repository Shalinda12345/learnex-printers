// Lets plain Node load the app's modules for unit tests: resolves the "@/..."
// import alias (see tsconfig.json) to files in the project, with or without
// their extension.
//
//   node --import ./tests/unit/register.mjs --test "tests/unit/*.test.mjs"
import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const isFile = (url) => {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), root).href;
      const found = ["", ".js", ".ts", ".jsx", ".mjs"].map((ext) => base + ext).find(isFile);
      if (found) return nextResolve(found, context);
    }
    return nextResolve(specifier, context);
  },
});
