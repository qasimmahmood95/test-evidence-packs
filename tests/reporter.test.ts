import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig, FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { describe, expect, it } from 'vitest';
import { parsePlaywrightJsonReport } from '../src/playwright-report.js';
import EvidencePackReporter from '../src/reporter.js';
import type { NormalizedRun } from '../src/types.js';

const CONTROLS = fileURLToPath(new URL('./fixtures/controls.yaml', import.meta.url));

const START_TIME = '2026-03-04T05:06:07.890Z';
const RUN_DURATION = 1234.5;

interface CaseSpec {
  file: string; // posix, relative to root
  line: number;
  project: string;
  describes: string[];
  title: string;
  tags: string[]; // with leading @
  annotations: { type: string; description?: string }[];
  outcome: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  results: {
    status: string;
    duration: number;
    retry: number;
    errors?: { message: string }[];
    attachments?: { name: string; contentType: string; path?: string }[];
  }[];
}

function makeCases(posixRoot: string): CaseSpec[] {
  return [
    {
      file: 'tests/eq.spec.ts',
      line: 5,
      project: 'unit',
      describes: [],
      title: 'boundary case @style:boundary',
      tags: ['@compliance', '@control:FX-001'],
      annotations: [{ type: 'boundary', description: 'T=1' }],
      outcome: 'expected',
      results: [{ status: 'passed', duration: 12.4, retry: 0 }],
    },
    {
      file: 'tests/eq.spec.ts',
      line: 20,
      project: 'unit',
      describes: ['grp'],
      title: 'fails hard',
      tags: ['@compliance', '@control:FX-002'],
      annotations: [],
      outcome: 'unexpected',
      results: [
        { status: 'failed', duration: 40.5, retry: 0, errors: [{ message: 'Error: boom\n  at eq.spec.ts:21' }] },
        {
          status: 'failed',
          duration: 38.2,
          retry: 1,
          errors: [{ message: 'Error: boom\n  at eq.spec.ts:21' }],
          attachments: [{ name: 'trace', contentType: 'application/zip', path: `${posixRoot}/trace.zip` }],
        },
      ],
    },
    {
      file: 'tests/eq.spec.ts',
      line: 30,
      project: 'unit',
      describes: [],
      title: 'skipped one',
      tags: ['@control:FX-003'],
      annotations: [],
      outcome: 'skipped',
      results: [{ status: 'skipped', duration: 0, retry: 0 }],
    },
  ];
}

/** Run the fake cases through the live reporter and return the pack's inputs/run.json. */
function runThroughReporter(rootDir: string, cases: CaseSpec[]): NormalizedRun {
  const evidenceDir = join(rootDir, 'evidence');
  const reporter = new EvidencePackReporter({ controls: CONTROLS, outputDir: evidenceDir });
  const config = {
    rootDir,
    configFile: join(rootDir, 'playwright.config.ts'),
    version: '1.61.0',
  } as unknown as FullConfig;
  reporter.onBegin(config);
  for (const c of cases) {
    const test = {
      id: `${c.file}:${c.line}`,
      title: c.title,
      location: { file: join(rootDir, ...c.file.split('/')), line: c.line, column: 1 },
      tags: c.tags,
      annotations: c.annotations,
      titlePath: () => ['', c.project, c.file, ...c.describes, c.title],
      outcome: () => c.outcome,
    } as unknown as TestCase;
    for (const r of c.results) {
      reporter.onTestEnd(test, {
        duration: r.duration,
        retry: r.retry,
        errors: r.errors ?? [],
        attachments: r.attachments ?? [],
      } as unknown as TestResult);
    }
  }
  reporter.onEnd({
    status: 'passed',
    startTime: new Date(START_TIME),
    duration: RUN_DURATION,
  } as FullResult);

  const packs = readdirSync(join(evidenceDir, 'packs'));
  expect(packs).toHaveLength(1);
  const runJson = readFileSync(join(evidenceDir, 'packs', packs[0]!, 'inputs', 'run.json'), 'utf8');
  return JSON.parse(runJson) as NormalizedRun;
}

/** Express the same cases as a Playwright JSON report and run the CLI-side parser. */
function runThroughParser(cases: CaseSpec[]): NormalizedRun {
  const specOf = (c: CaseSpec): unknown => ({
    title: c.title,
    tags: c.tags.map((t) => t.slice(1)), // the JSON report strips the @
    file: c.file,
    line: c.line,
    tests: [
      {
        projectName: c.project,
        status: c.outcome,
        annotations: c.annotations,
        results: c.results,
      },
    ],
  });
  const report = {
    config: { version: '1.61.0', rootDir: '/repo' },
    suites: [
      {
        title: 'eq.spec.ts',
        file: 'tests/eq.spec.ts',
        specs: cases.filter((c) => c.describes.length === 0).map(specOf),
        suites: [
          {
            title: 'grp',
            specs: cases.filter((c) => c.describes[0] === 'grp').map(specOf),
          },
        ],
      },
    ],
    stats: { startTime: START_TIME, duration: RUN_DURATION },
  };
  return parsePlaywrightJsonReport(JSON.stringify(report));
}

describe('reporter ↔ CLI equivalence', () => {
  it('the live reporter and the JSON-report parser normalize the same run identically', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'tep-reporter-'));
    const posixRoot = rootDir.replaceAll('\\', '/');
    const cases = makeCases(posixRoot);

    const fromReporter = runThroughReporter(rootDir, cases);
    const fromParser = runThroughParser(cases);

    expect(fromReporter.startTime).toBe(START_TIME);
    expect(fromReporter.startTime).toBe(fromParser.startTime);
    expect(fromReporter.durationMs).toBe(fromParser.durationMs);
    expect(fromReporter.playwrightVersion).toBe(fromParser.playwrightVersion);
    expect(fromReporter.tests).toEqual(fromParser.tests);
  });

  it('requires the controls option', () => {
    expect(() => new EvidencePackReporter({} as { controls: string })).toThrowError(/controls/);
  });
});
