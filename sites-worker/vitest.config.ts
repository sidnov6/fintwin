import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@fintwin/engine": resolve(__dirname, "../packages/engine/src/index.ts"), "@fintwin/contracts": resolve(__dirname, "../packages/contracts/src/index.ts") } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
