import { defineConfig } from 'vitest/config'

export default defineConfig({
  // This config is separate from vite.config.ts, so the `~/*` alias has to be
  // turned on again here.
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
