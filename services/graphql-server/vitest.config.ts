import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // graphql 17 ships a separate "development" build. Vitest resolves the
    // tests' `graphql` import to it, while Node would load @graphql-tools'
    // copy from the production build, and the two copies reject each other's
    // schema objects. Processing @graphql-tools through Vitest makes both
    // sides resolve the same build.
    server: { deps: { inline: [/@graphql-tools\//] } },
    // Hide the BFF's request logging unless a test fails.
    silent: "passed-only",
  },
});
