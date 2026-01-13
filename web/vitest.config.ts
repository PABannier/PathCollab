/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Use jsdom for DOM simulation
    environment: 'jsdom',

    // Setup files run before each test file
    setupFiles: ['./src/test/setup.ts'],

    // Global test utilities (describe, it, expect, etc.)
    globals: true,

    // Include test files
    include: ['src/**/*.{test,spec}.{ts,tsx}'],

    // Exclude patterns
    exclude: ['node_modules', 'dist', 'e2e'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/test/**/*',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      // Coverage thresholds - start low, increase as tests are added
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 50,
        lines: 50,
      },
    },

    // Reporter configuration
    reporters: ['default', 'html'],

    // Watch mode configuration
    watch: true,
    watchExclude: ['node_modules', 'dist'],

    // Disable pooling for bun compatibility
    // tinypool has issues with bun's process model
    fileParallelism: false,

    // Timeout for async tests
    testTimeout: 10000,
    hookTimeout: 10000,

    // Clear mocks between tests
    clearMocks: true,
    restoreMocks: true,

    // Enable CSS parsing (for component tests)
    css: true,
  },
})
