import {
  compareTests,
  extractTagsFromText,
  firstLine,
  makeTestId,
  normalizeTag,
  sortedUnique,
  stripAnsi,
  toPosixPath,
} from './normalize.js';
import type {
  NormalizedAnnotation,
  NormalizedAttachment,
  NormalizedRun,
  NormalizedTest,
  TestOutcome,
} from './types.js';

export class ReportError extends Error {}

// Minimal structural view of Playwright's JSON report. Every field is treated
// as optional so the parser degrades gracefully across Playwright versions.
interface JsonSuite {
  title?: string;
  file?: string;
  suites?: JsonSuite[];
  specs?: JsonSpec[];
}

interface JsonSpec {
  title?: string;
  tags?: string[];
  file?: string;
  line?: number;
  tests?: JsonTest[];
}

interface JsonTest {
  projectName?: string;
  status?: string;
  annotations?: { type?: unknown; description?: unknown }[];
  results?: JsonResult[];
}

interface JsonError {
  message?: string;
}

interface JsonResult {
  status?: string;
  duration?: number;
  retry?: number;
  error?: JsonError;
  errors?: JsonError[];
  attachments?: { name?: string; contentType?: string; path?: string }[];
}

interface JsonReport {
  config?: { version?: string; rootDir?: string };
  suites?: JsonSuite[];
  stats?: { startTime?: string; duration?: number };
}

/** spec.file is normally rootDir-relative, but defend against absolute paths from other Playwright versions. */
function relativizeFile(file: string, rootDir: string | undefined): string {
  const posix = toPosixPath(file);
  if (!rootDir) return posix;
  const root = toPosixPath(rootDir).replace(/\/$/, '');
  if (posix === root) return '';
  if (posix.startsWith(`${root}/`)) return posix.slice(root.length + 1);
  return posix;
}

function collectSpecs(
  suite: JsonSuite,
  ancestors: string[],
  out: { spec: JsonSpec; ancestors: string[] }[],
): void {
  for (const spec of suite.specs ?? []) out.push({ spec, ancestors });
  for (const child of suite.suites ?? []) {
    collectSpecs(child, [...ancestors, child.title ?? ''], out);
  }
}

function mapOutcome(test: JsonTest): TestOutcome {
  switch (test.status) {
    case 'expected':
      return 'passed';
    case 'unexpected':
      return 'failed';
    case 'flaky':
      return 'flaky';
    case 'skipped':
      return 'skipped';
    default: {
      // Older/odd reports: fall back to the final attempt's raw status.
      const last = test.results?.at(-1);
      return last?.status === 'passed' ? 'passed' : last?.status === 'skipped' ? 'skipped' : 'failed';
    }
  }
}

function normalizeTest(
  spec: JsonSpec,
  ancestors: string[],
  test: JsonTest,
  rootDir: string | undefined,
): NormalizedTest {
  const describePath = ancestors.filter((t) => t.length > 0);
  const title = [...describePath, spec.title ?? ''].join(' › ');
  const file = relativizeFile(spec.file ?? '', rootDir);
  const line = spec.line ?? 0;
  const projectName = test.projectName ?? '';

  const tags = sortedUnique([
    ...(spec.tags ?? []).map(normalizeTag),
    ...extractTagsFromText(title),
  ]);

  const annotations: NormalizedAnnotation[] = (test.annotations ?? []).map((a) => {
    const ann: NormalizedAnnotation = { type: String(a.type ?? '') };
    if (a.description !== undefined && a.description !== null) ann.description = String(a.description);
    return ann;
  });

  const results = test.results ?? [];
  const last = results.at(-1);
  const durationMs = Math.round(results.reduce((sum, r) => sum + (r.duration ?? 0), 0));
  const retries = results.reduce((max, r) => Math.max(max, r.retry ?? 0), 0);

  const rawErrors = last?.errors ?? (last?.error ? [last.error] : []);
  const errors = rawErrors
    .map((e) => firstLine(stripAnsi(e.message ?? '')))
    .filter((m) => m.length > 0);

  const attachments: NormalizedAttachment[] = (last?.attachments ?? []).map((a) => {
    const att: NormalizedAttachment = {
      name: String(a.name ?? ''),
      contentType: String(a.contentType ?? ''),
    };
    if (a.path !== undefined) att.path = toPosixPath(String(a.path));
    return att;
  });

  return {
    id: makeTestId(file, line, projectName, title),
    title,
    file,
    line,
    projectName,
    tags,
    annotations,
    outcome: mapOutcome(test),
    durationMs,
    retries,
    errors,
    attachments,
  };
}

/** Parse a Playwright JSON report (from `--reporter=json`) into the normalized run shape. */
export function parsePlaywrightJsonReport(jsonText: string): NormalizedRun {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new ReportError('report is not valid JSON');
  }
  const report = raw as JsonReport;
  if (!Array.isArray(report.suites) || typeof report.stats?.startTime !== 'string') {
    throw new ReportError(
      'file does not look like a Playwright JSON report (expected top-level "suites" and "stats.startTime")',
    );
  }
  const startDate = new Date(report.stats.startTime);
  if (Number.isNaN(startDate.getTime())) {
    throw new ReportError(`stats.startTime is not a valid timestamp: ${report.stats.startTime}`);
  }

  const specs: { spec: JsonSpec; ancestors: string[] }[] = [];
  for (const suite of report.suites) collectSpecs(suite, [], specs);

  const tests: NormalizedTest[] = [];
  for (const { spec, ancestors } of specs) {
    for (const test of spec.tests ?? []) {
      tests.push(normalizeTest(spec, ancestors, test, report.config?.rootDir));
    }
  }
  tests.sort(compareTests);

  const run: NormalizedRun = {
    startTime: startDate.toISOString(),
    durationMs: Math.round(report.stats.duration ?? 0),
    tests,
  };
  if (report.config?.version !== undefined) run.playwrightVersion = report.config.version;
  return run;
}
