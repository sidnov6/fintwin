import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? "3000";
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "8787";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${webPort}`, trace: "retain-on-failure" },
  webServer: [
    { command: "node ../../scripts/dev-api.mjs", cwd: __dirname, url: `http://127.0.0.1:${apiPort}/health`, reuseExistingServer: true, timeout: 60_000, env: { PORT: apiPort, FINTWIN_DB: process.env.FINTWIN_DB ?? ":memory:", GROQ_API_KEY: "" } },
    { command: `pnpm dev -p ${webPort}`, url: `http://127.0.0.1:${webPort}`, reuseExistingServer: true, timeout: 120_000, env: { NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}` } },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
