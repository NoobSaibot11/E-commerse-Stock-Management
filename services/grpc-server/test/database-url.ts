// Tests run against their own database so they never touch dev data.
// Override with TEST_DATABASE_URL (e.g. in CI).
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://ecommerce:ecommerce@localhost:5433/ecommerce_test";
