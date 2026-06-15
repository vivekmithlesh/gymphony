import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Deliberately standalone — it does NOT import the app's vite.config.ts (which
// pulls in the TanStack Start / Nitro SSR plugins). Tests target pure logic, so
// a lean node environment keeps them fast and free of SSR/build machinery. The
// only thing we borrow is `@/*` path resolution via tsconfig.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The legacy hand-run harness uses a .e2e.ts suffix; don't double-run it.
    exclude: ["**/*.e2e.ts", "node_modules/**"],
  },
});
