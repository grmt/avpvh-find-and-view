import { defineConfig } from 'vitest/config';

// Unit tests for src/ts. CI runs them through grmt/wp-plugin-ci's quality
// workflow, which adds lcov coverage for Codecov and SonarQube Cloud.
export default defineConfig({
  test: {
    include: ['tests/ts/**/*.test.ts'],
    environment: 'jsdom',
    restoreMocks: true,
    coverage: {
      include: ['src/ts/**/*.ts'],
    },
  },
});
