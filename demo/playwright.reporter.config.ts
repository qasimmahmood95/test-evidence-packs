import { defineConfig } from '@playwright/test';

// Alternative wiring: the live reporter generates the pack as part of the run.
// (In an external project you'd reference 'test-evidence-packs/reporter'
// instead of the relative dist path.) Requires `pnpm build` first.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [
    ['list'],
    ['../dist/reporter.js', { controls: 'controls.yaml', outputDir: 'evidence-live' }],
  ],
});
