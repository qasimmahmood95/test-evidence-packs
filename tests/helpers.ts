import { makeTestId } from '../src/normalize.js';
import { parseControls } from '../src/controls.js';
import type { ControlsDoc, NormalizedRun, NormalizedTest } from '../src/types.js';

export function makeTest(partial: Partial<NormalizedTest> & { title: string }): NormalizedTest {
  const file = partial.file ?? 'tests/a.spec.ts';
  const line = partial.line ?? 1;
  const projectName = partial.projectName ?? 'unit';
  return {
    id: makeTestId(file, line, projectName, partial.title),
    title: partial.title,
    file,
    line,
    projectName,
    tags: partial.tags ?? [],
    annotations: partial.annotations ?? [],
    outcome: partial.outcome ?? 'passed',
    durationMs: partial.durationMs ?? 10,
    retries: partial.retries ?? 0,
    errors: partial.errors ?? [],
    attachments: partial.attachments ?? [],
  };
}

export function makeRun(tests: NormalizedTest[]): NormalizedRun {
  return {
    startTime: '2026-01-02T03:04:05.000Z',
    durationMs: 1000,
    playwrightVersion: '1.61.0',
    tests,
  };
}

export function doc(yaml: string): ControlsDoc {
  return parseControls(yaml);
}

export const FIXTURE_GIT = {
  commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  branch: 'main',
  tag: 'v0.1.0-demo',
  dirty: false,
};
