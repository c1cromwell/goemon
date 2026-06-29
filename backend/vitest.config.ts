import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "test_secret_at_least_long_enough_for_tests",
      BASE_URL: "http://localhost:3001",
      CREDENTIAL_BASE_URL: "http://localhost:3001",
      ALLOW_PASSWORD_AUTH: "true",
      RP_ID: "localhost",
      RP_ORIGIN: "http://localhost:5173",
      RP_NAME: "Goemon Test",
    },
  },
});
