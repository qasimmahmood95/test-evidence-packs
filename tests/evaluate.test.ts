import { describe, expect, it } from 'vitest';
import { evaluateRun } from '../src/evaluate.js';
import { doc, makeRun, makeTest } from './helpers.js';

const DOC = doc(`
version: 1
controls:
  C-1:
    title: Boundary control
    tags: ["@compliance", "@control:C-1"]
    evidence:
      styles: [boundary, negative]
      min_tests: 2
  C-2:
    title: Lifecycle control
    tags: ["@compliance", "@control:C-2"]
    evidence:
      styles: [lifecycle]
  C-3:
    title: Uncovered control
    tags: ["@control:C-3"]
`);

describe('evaluateRun', () => {
  it('matches tests by tags (match: all) and reports status per control', () => {
    const run = makeRun([
      makeTest({ title: 'at boundary', tags: ['@compliance', '@control:C-1', '@style:boundary'] }),
      makeTest({ title: 'above boundary', line: 2, tags: ['@compliance', '@control:C-1', '@style:negative'] }),
      makeTest({ title: 'lifecycle', line: 3, tags: ['@compliance', '@control:C-2', '@style:lifecycle'] }),
      makeTest({ title: 'untagged', line: 4, tags: ['@compliance'] }),
    ]);
    const { results, gaps } = evaluateRun(DOC, run);
    expect(results.map((r) => [r.control.id, r.status])).toEqual([
      ['C-1', 'passed'],
      ['C-2', 'passed'],
      ['C-3', 'gap'],
    ]);
    expect(gaps).toEqual([{ kind: 'no-passing-evidence', controlId: 'C-3' }]);
  });

  it('a test carrying only one of the control tags does not match under "all"', () => {
    const run = makeRun([makeTest({ title: 't', tags: ['@control:C-1'] })]);
    const { results } = evaluateRun(DOC, run);
    expect(results[0]?.tests).toHaveLength(0);
  });

  it('match: any accepts a test with any declared tag', () => {
    const anyDoc = doc(`
version: 1
controls:
  C-1:
    title: t
    tags: ["@aaa", "@bbb"]
    match: any
`);
    const run = makeRun([makeTest({ title: 't', tags: ['@bbb'] })]);
    const { results } = evaluateRun(anyDoc, run);
    expect(results[0]?.tests).toHaveLength(1);
  });

  it('matches by annotations (VaultChain style) and records annotation cases per style', () => {
    const annDoc = doc(`
version: 1
controls:
  MC-TRAVEL-RULE:
    title: Travel rule
    tags: ["@compliance"]
    annotations:
      - type: rule
        value: MC-TRAVEL-RULE
    evidence:
      styles: [boundary]
`);
    const run = makeRun([
      makeTest({
        title: 'at threshold',
        tags: ['@compliance'],
        annotations: [
          { type: 'rule', description: 'MC-TRAVEL-RULE' },
          { type: 'boundary', description: 'T=1000.00' },
        ],
      }),
      makeTest({
        title: 'below threshold',
        line: 2,
        tags: ['@compliance'],
        annotations: [
          { type: 'rule', description: 'MC-TRAVEL-RULE' },
          { type: 'boundary', description: 'T-1=999.99' },
        ],
      }),
      makeTest({
        title: 'different rule',
        line: 3,
        tags: ['@compliance'],
        annotations: [{ type: 'rule', description: 'MC-OTHER' }],
      }),
    ]);
    const { results } = evaluateRun(annDoc, run);
    const result = results[0]!;
    expect(result.tests).toHaveLength(2);
    expect(result.status).toBe('passed');
    expect(result.stylesExercised).toEqual([
      { style: 'boundary', testIds: result.tests.map((t) => t.id).sort(), cases: ['T-1=999.99', 'T=1000.00'] },
    ]);
  });

  it('reports insufficient-tests and missing-style gaps', () => {
    const run = makeRun([
      makeTest({ title: 'only one', tags: ['@compliance', '@control:C-1', '@style:boundary'] }),
      makeTest({ title: 'lifecycle', line: 2, tags: ['@compliance', '@control:C-2'] }),
      makeTest({ title: 'c3', line: 3, tags: ['@control:C-3'] }),
    ]);
    const { results, gaps } = evaluateRun(DOC, run);
    expect(gaps).toEqual([
      { kind: 'insufficient-tests', controlId: 'C-1', required: 2, passing: 1 },
      { kind: 'missing-style', controlId: 'C-1', style: 'negative' },
      { kind: 'missing-style', controlId: 'C-2', style: 'lifecycle' },
    ]);
    expect(results.map((r) => r.status)).toEqual(['gap', 'gap', 'passed']);
  });

  it('a failing matching test makes the control FAIL even when passing evidence exists', () => {
    const run = makeRun([
      makeTest({ title: 'ok 1', tags: ['@compliance', '@control:C-1', '@style:boundary'] }),
      makeTest({ title: 'ok 2', line: 2, tags: ['@compliance', '@control:C-1', '@style:negative'] }),
      makeTest({
        title: 'broken',
        line: 3,
        tags: ['@compliance', '@control:C-1'],
        outcome: 'failed',
        errors: ['expected 402 to be 200'],
      }),
    ]);
    const { results } = evaluateRun(DOC, run);
    expect(results[0]?.status).toBe('failed');
  });

  it('flaky tests count as passing evidence', () => {
    const run = makeRun([
      makeTest({ title: 'f1', tags: ['@compliance', '@control:C-1', '@style:boundary'], outcome: 'flaky' }),
      makeTest({ title: 'f2', line: 2, tags: ['@compliance', '@control:C-1', '@style:negative'], outcome: 'flaky' }),
    ]);
    const { results } = evaluateRun(DOC, run);
    expect(results[0]?.status).toBe('passed');
    expect(results[0]?.flaky).toBe(2);
  });

  it('skipped tests are not passing evidence', () => {
    const run = makeRun([
      makeTest({ title: 's', tags: ['@compliance', '@control:C-2'], outcome: 'skipped' }),
    ]);
    const { results, gaps } = evaluateRun(DOC, run);
    expect(results[1]?.status).toBe('gap');
    expect(gaps).toContainEqual({ kind: 'no-passing-evidence', controlId: 'C-2' });
  });

  it('flags control-prefixed tags that match no declared control', () => {
    const run = makeRun([
      makeTest({ title: 'typo', tags: ['@compliance', '@control:C-99'] }),
    ]);
    const { gaps } = evaluateRun(DOC, run);
    expect(gaps).toContainEqual({
      kind: 'unknown-control-tag',
      tag: '@control:C-99',
      tests: ['typo (tests/a.spec.ts:1)'],
    });
  });
});
