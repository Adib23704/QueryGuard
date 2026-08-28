import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: true,
    target: "node20",
    outDir: "dist",
  },
  {
    entry: {
      queryguard: "src/cli/index.ts",
    },
    format: ["esm"],
    banner: {
      js: "#!/usr/bin/env node",
    },
    dts: false,
    sourcemap: true,
    clean: false,
    target: "node20",
    outDir: "dist/bin",
  },
]);
