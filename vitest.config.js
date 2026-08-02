import { defineConfig } from 'vitest/config'

// Tests cover src/app/core/** only -- the drag math, the undo funnel, the migrations,
// and the data-model invariants. No component tests; the value here is the invariants.
export default defineConfig({
  test: {
    include: ['src/app/core/**/*.test.ts'],
    environment: 'node',
  },
})
