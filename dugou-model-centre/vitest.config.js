import { defineConfig } from 'vitest/config'

// Vitest configuration.
// The analytics engine is plain ESM with mostly pure functions, so the
// fast `node` environment is enough — no DOM is required for the math.
export default defineConfig({
  // Match Vite's React automatic runtime for presentation-component tests.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.js'],
    },
  },
})
