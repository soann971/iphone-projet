import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/{api,worker}/src/**/*.test.ts"],
    environment: "node",
    // Les tests d'intégration (base réelle) sont activés par TEST_DATABASE_URL.
    testTimeout: 20_000,
    // Les tests d'intégration partagent la même base : on exécute les fichiers l'un après l'autre.
    fileParallelism: false,
    env: { LOG_LEVEL: "warn" },
  },
});
