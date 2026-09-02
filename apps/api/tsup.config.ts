import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/cli/bootstrap-admin.ts", "src/cli/migrate.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: [/^@photostream\//u],
});
