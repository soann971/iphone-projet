import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/{api,worker}/src/**/*.test.ts"],
    environment: "node",
    // Les tests d'intégration (base réelle) sont activés par TEST_DATABASE_URL.
    testTimeout: 20_000,
  },
});
