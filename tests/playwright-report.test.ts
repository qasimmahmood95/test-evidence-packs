import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReportError, parsePlaywrightJsonReport } from '../src/playwright-report.js';

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/report.json', import.meta.url)), 'utf8');

describe('parsePlaywrightJsonReport', () => {
  const run = parsePlaywrightJsonReport(fixture);

  it('extracts run metadata', () => {
    expect(run.startTime).toBe('2026-01-02T03:04:05.678Z');
    expect(run.durationMs).toBe(4322);
    expect(run.playwrightVersion).toBe('1.61.0');
  });

  it('flattens nested suites into sorted tests', () => {
    expect(run.tests.map((t) => `${t.file}:${t.line}`)).toEqual([
      'tests/fixture.spec.ts:5',
      'tests/fixture.spec.ts:14',
      'tests/fixture.spec.ts:25',
      'tests/fixture.spec.ts:33',
      'tests/typo.spec.ts:3',
    ]);
  });

  it('normalizes tags to "@" form and merges title tags, sorted and deduplicated', () => {
    expect(run.tests[0]?.tags).toEqual(['@compliance', '@control:FX-001', '@style:boundary']);
  });

  it('prefixes describe titles, excluding the file suite', () => {
    expect(run.tests[2]?.title).toBe('lifecycle › settles with a full audit trail @style:lifecycle');
  });

  it('maps outcomes and aggregates retries and durations across attempts', () => {
    const failing = run.tests[3]!;
    expect(failing.outcome).toBe('failed');
    expect(failing.retries).toBe(1);
    expect(failing.durationMs).toBe(79); // 40.5 + 38.2, rounded
  });

  it('takes errors from the final attempt, ANSI-stripped, first line only', () => {
    expect(run.tests[3]?.errors).toEqual(["Error: expected 'created' to be 'failed'"]);
  });

  it('keeps annotations and attachment references', () => {
    expect(run.tests[0]?.annotations).toEqual([{ type: 'boundary', description: 'T=100' }]);
    expect(run.tests[1]?.attachments).toEqual([
      {
        name: 'trace',
        contentType: 'application/zip',
        path: '/repo/test-results/rejects-above/trace.zip',
      },
    ]);
  });

  it('rejects non-JSON input', () => {
    expect(() => parsePlaywrightJsonReport('not json')).toThrowError(ReportError);
  });

  it('rejects JSON that is not a Playwright report', () => {
    expect(() => parsePlaywrightJsonReport('{"foo": 1}')).toThrowError(/Playwright JSON report/);
  });
});
