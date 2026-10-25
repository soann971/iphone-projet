import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  // Les paquets du monorepo sont en TypeScript : on les embarque dans le bundle.
  noExternal: [/^@ms\//],
  sourcemap: true,
  clean: true,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
