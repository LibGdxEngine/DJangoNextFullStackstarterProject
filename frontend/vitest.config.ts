import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/lib/api/__tests__/server-only.ts", import.meta.url)),
    },
  },
  test: { clearMocks: true, restoreMocks: true },
});
