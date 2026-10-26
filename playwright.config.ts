import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:47832",
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath: process.env.PW_EXECUTABLE_PATH ?? "/home/dnames/bin/chromium-ai",
    },
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run build && HIMALAYA_WEB_PORT=47832 npm run dev",
    url: "http://127.0.0.1:47832/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
