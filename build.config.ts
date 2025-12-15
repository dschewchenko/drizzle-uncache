import { promises as fs } from "node:fs";
import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ["src/index"],
  externals: [/^drizzle-orm(\/.*)?$/, /^unstorage(\/.*)?$/],
  rollup: {
    emitCJS: true,
  },
  hooks: {
    async "build:done"(ctx) {
      const outDir = ctx.options.outDir || "dist";
      const file = `${outDir}/index.d.ts`;
      const types = await fs.readFile(file, "utf8");
      await fs.writeFile(file.replace(/\\.d\\.ts$/, ".d.mts"), types);
      await fs.writeFile(file.replace(/\\.d\\.ts$/, ".d.cts"), types);
    },
  },
});
