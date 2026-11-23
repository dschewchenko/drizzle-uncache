import { copyFile } from "node:fs/promises";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  fixedExtension: true,
  async onSuccess() {
    await copyFile("dist/index.d.mts", "dist/index.d.ts");
  },
});
