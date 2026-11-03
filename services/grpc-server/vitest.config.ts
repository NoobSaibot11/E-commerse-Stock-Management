import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./test/database-url.js";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    env: { DATABASE_URL: TEST_DATABASE_URL },
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
    // Hide the services' request logging unless a test fails.
    silent: "passed-only",
  },
});
