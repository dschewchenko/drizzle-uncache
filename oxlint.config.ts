import nkzw from "@nkzw/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [nkzw],
  plugins: [...new Set([...nkzw.plugins, "node", "jsdoc"] as const)],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "error",
  },
  ignorePatterns: ["dist/**", "coverage/**", "node_modules/**"],
  rules: {
    "no-console": "off",
    "node/no-process-env": "off",
  },
});
