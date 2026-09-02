import { defineConfig, devices } from "@playwright/test";

/**
 * The browser suite runs on its own ports with no provider keys, so every run
 * exercises the deterministic companion. That keeps the tests repeatable and
 * independent of any provider being reachable or rate limited, and stops them
 * reusing whatever development stack happens to be running.
 */
const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? "3099";
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "8799";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${webPort}`, trace: "retain-on-failure" },
  webServer: [
    {
      command: "node ../../scripts/dev-api.mjs",
      cwd: __dirname,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: apiPort, FINTWIN_DB: ":memory:", FINTWIN_NO_PROVIDERS: "1" },
    },
    {
      command: `pnpm exec next dev -p ${webPort}`,
      cwd: __dirname,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}` },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
