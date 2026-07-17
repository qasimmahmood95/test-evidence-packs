import { defineConfig } from '@playwright/test';

// Pure-Node demo suite: no browsers required, runs from a clean clone.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list'], ['json', { outputFile: 'report.json' }]],
});
