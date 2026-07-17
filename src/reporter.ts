import { dirname, relative, resolve } from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { describeGap } from './evaluate.js';
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
import { generatePack } from './pack.js';
import type {
  NormalizedAnnotation,
  NormalizedAttachment,
  NormalizedRun,
  NormalizedTest,
  TestOutcome,
} from './types.js';

export interface EvidencePackReporterOptions {
  /** Path to the controls map, resolved against the Playwright config directory. Required. */
  controls: string;
  /** Evidence output directory, resolved against the Playwright config directory. Default: "evidence". */
  outputDir?: string;
}

/**
 * Live Playwright reporter. Usage in playwright.config.ts:
 *
 *   reporter: [['list'], ['test-evidence-packs/reporter', { controls: 'controls.yaml' }]]
 */
export default class EvidencePackReporter implements Reporter {
  private config!: FullConfig;
  private readonly cases = new Map<string, { test: TestCase; results: TestResult[] }>();

  constructor(private readonly options: EvidencePackReporterOptions) {
    if (!options?.controls) {
      throw new Error('test-evidence-packs reporter: the "controls" option is required');
    }
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig): void {
    this.config = config;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const entry = this.cases.get(test.id) ?? { test, results: [] };
    entry.results.push(result);
    this.cases.set(test.id, entry);
  }

  /** config.rootDir is the testDir; anchor user-supplied paths at the config file instead. */
  private baseDir(): string {
    return this.config.configFile ? dirname(this.config.configFile) : this.config.rootDir;
  }

  onEnd(result: FullResult): void {
    const run = this.buildRun(result);
    const base = this.baseDir();
    const packResult = generatePack({
      controlsPath: resolve(base, this.options.controls),
      outDir: this.options.outputDir ?? 'evidence',
      source: { kind: 'run', run },
      cwd: base,
    });
    console.log(`[test-evidence-packs] wrote ${relative(base, packResult.packDir)}`);
    for (const gap of packResult.evaluation.gaps) {
      console.log(`[test-evidence-packs] gap: ${describeGap(gap)}`);
    }
  }

  private buildRun(result: FullResult): NormalizedRun {
    const tests: NormalizedTest[] = [];
    for (const { test, results } of this.cases.values()) {
      tests.push(this.buildTest(test, results));
    }
    tests.sort(compareTests);
    return {
      startTime: new Date(result.startTime).toISOString(),
      durationMs: Math.round(result.duration),
      playwrightVersion: this.config.version,
      tests,
    };
  }

  private buildTest(test: TestCase, results: TestResult[]): NormalizedTest {
    // titlePath: ['', project, file, ...describes, title]
    const titlePath = test.titlePath();
    const projectName = titlePath[1] ?? '';
    const title = titlePath.slice(3).join(' › ');
    const file = toPosixPath(relative(this.config.rootDir, test.location.file));
    const line = test.location.line;

    const tags = sortedUnique([
      ...test.tags.map(normalizeTag),
      ...extractTagsFromText(titlePath.join(' ')),
    ]);
    const annotations: NormalizedAnnotation[] = test.annotations.map((a) => {
      const ann: NormalizedAnnotation = { type: a.type };
      if (a.description !== undefined) ann.description = a.description;
      return ann;
    });

    const outcomeMap: Record<string, TestOutcome> = {
      expected: 'passed',
      unexpected: 'failed',
      flaky: 'flaky',
      skipped: 'skipped',
    };
    const outcome = outcomeMap[test.outcome()] ?? 'failed';

    const last = results.at(-1);
    const durationMs = Math.round(results.reduce((sum, r) => sum + r.duration, 0));
    const retries = results.reduce((max, r) => Math.max(max, r.retry), 0);
    const errors = (last?.errors ?? [])
      .map((e) => firstLine(stripAnsi(e.message ?? '')))
      .filter((m) => m.length > 0);
    const attachments: NormalizedAttachment[] = (last?.attachments ?? []).map((a) => {
      const att: NormalizedAttachment = { name: a.name, contentType: a.contentType };
      if (a.path !== undefined) att.path = toPosixPath(a.path);
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
      outcome,
      durationMs,
      retries,
      errors,
      attachments,
    };
  }
}
