import type { ControlsDoc, ControlStatus, Evaluation, GitMeta, NormalizedRun } from '../types.js';

export interface RenderContext {
  packId: string;
  doc: ControlsDoc;
  run: NormalizedRun;
  git: GitMeta | null;
  evaluation: Evaluation;
  generatorVersion: string;
}

export function statusWord(status: ControlStatus): string {
  switch (status) {
    case 'passed':
      return 'PASS';
    case 'failed':
      return 'FAIL';
    case 'gap':
      return 'GAP';
  }
}

export function outcomeWord(outcome: string): string {
  switch (outcome) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'FAILED';
    case 'flaky':
      return 'passed (flaky)';
    case 'skipped':
      return 'skipped';
    default:
      return outcome;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} m ${rest} s`;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

export function runTotals(run: NormalizedRun): RunTotals {
  const totals: RunTotals = { total: run.tests.length, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const t of run.tests) {
    if (t.outcome === 'passed') totals.passed++;
    else if (t.outcome === 'failed') totals.failed++;
    else if (t.outcome === 'skipped') totals.skipped++;
    else totals.flaky++;
  }
  return totals;
}
