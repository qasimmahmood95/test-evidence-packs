import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { canonicalJsonPretty, sha256Hex } from './canonical.js';
import { parseControls } from './controls.js';
import { evaluateRun } from './evaluate.js';
import { detectGitMeta } from './git.js';
import { LedgerError, appendToLedger, verifyLedger, type AppendResult } from './ledger.js';
import { compareTests } from './normalize.js';
import { parsePlaywrightJsonReport } from './playwright-report.js';
import type { RenderContext } from './render/context.js';
import { renderIndexHtml } from './render/html.js';
import { renderControlMd, renderEvidenceMd, renderGapsMd } from './render/markdown.js';
import type {
  Evaluation,
  GitMeta,
  Manifest,
  ManifestControlSummary,
  NormalizedRun,
  NormalizedTest,
} from './types.js';
import { GENERATOR_NAME, VERSION } from './version.js';

export class PackError extends Error {}

export type PackSource =
  | { kind: 'report'; reportPath: string }
  | { kind: 'run'; run: NormalizedRun };

export interface GeneratePackOptions {
  controlsPath: string;
  /** Evidence root directory; the pack is written to `<outDir>/packs/<packId>/`. */
  outDir: string;
  source: PackSource;
  /** undefined → detect from cwd; null → record no git metadata. */
  git?: GitMeta | null | undefined;
  cwd?: string;
}

export interface GeneratePackResult {
  packDir: string;
  packId: string;
  manifest: Manifest;
  manifestSha256: string;
  evaluation: Evaluation;
  ledger: AppendResult;
}

/** `<run-start-UTC-with-ms>_<short-commit>` — filesystem-safe, sortable, collision-resistant. */
export function formatPackId(startTime: string, commit?: string): string {
  const iso = new Date(startTime).toISOString(); // 2026-01-02T03:04:05.678Z
  const stamp = `${iso.slice(0, 23).replaceAll(':', '-').replaceAll('.', '-')}Z`;
  return `${stamp}_${commit ? commit.slice(0, 7) : 'nogit'}`;
}

function readInput(path: string, what: string): Buffer {
  if (!existsSync(path)) throw new PackError(`${what} not found: ${path}`);
  return readFileSync(path);
}

/** Hash referenced artifact files (traces, screenshots) so later alteration is detectable. */
function withAttachmentHashes(test: NormalizedTest, baseDir: string): NormalizedTest {
  if (test.attachments.length === 0) return test;
  const attachments = test.attachments.map((a) => {
    if (!a.path) return a;
    const p = isAbsolute(a.path) ? a.path : resolve(baseDir, a.path);
    if (!existsSync(p)) return a;
    try {
      return { ...a, sha256: sha256Hex(readFileSync(p)) };
    } catch {
      return a;
    }
  });
  return { ...test, attachments };
}

export function generatePack(options: GeneratePackOptions): GeneratePackResult {
  const cwd = options.cwd ?? process.cwd();
  const controlsPath = resolve(cwd, options.controlsPath);
  const controlsBytes = readInput(controlsPath, 'controls map');
  const doc = parseControls(controlsBytes.toString('utf8'));

  let run: NormalizedRun;
  let inputName: string;
  let inputContent: Buffer | string;
  if (options.source.kind === 'report') {
    const raw = readInput(resolve(cwd, options.source.reportPath), 'Playwright JSON report');
    run = parsePlaywrightJsonReport(raw.toString('utf8'));
    inputName = 'inputs/report.json';
    inputContent = raw;
  } else {
    run = options.source.run;
    inputName = 'inputs/run.json';
    inputContent = ''; // filled in below, after normalization
  }

  run = {
    ...run,
    startTime: new Date(run.startTime).toISOString(),
    tests: run.tests.map((t) => withAttachmentHashes(t, cwd)).sort(compareTests),
  };
  if (options.source.kind === 'run') inputContent = canonicalJsonPretty(run);

  const git = options.git === undefined ? detectGitMeta(cwd) : options.git;
  const evaluation = evaluateRun(doc, run);
  const packId = formatPackId(run.startTime, git?.commit);
  const outRoot = resolve(cwd, options.outDir);
  const packDir = join(outRoot, 'packs', packId);

  const ctx: RenderContext = { packId, doc, run, git, evaluation, generatorVersion: VERSION };

  const files = new Map<string, Buffer | string>();
  files.set('inputs/controls.yaml', controlsBytes);
  files.set(inputName, inputContent);
  for (const result of evaluation.results) {
    files.set(`controls/${result.control.id}.md`, renderControlMd(ctx, result));
  }
  files.set('EVIDENCE.md', renderEvidenceMd(ctx));
  files.set('GAPS.md', renderGapsMd(ctx));
  files.set('index.html', renderIndexHtml(ctx));

  const fileHashes: Record<string, string> = {};
  for (const rel of [...files.keys()].sort()) {
    const content = files.get(rel)!;
    fileHashes[rel] = sha256Hex(typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
  }

  const controlSummaries: Record<string, ManifestControlSummary> = {};
  for (const r of evaluation.results) {
    controlSummaries[r.control.id] = {
      title: r.control.title,
      status: r.status,
      tests: r.tests.length,
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
      flaky: r.flaky,
      stylesDeclared: r.control.evidence.styles,
      stylesExercised: r.stylesExercised.map((s) => s.style),
    };
  }

  const totals = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const t of run.tests) {
    totals.total++;
    if (t.outcome === 'passed') totals.passed++;
    else if (t.outcome === 'failed') totals.failed++;
    else if (t.outcome === 'skipped') totals.skipped++;
    else totals.flaky++;
  }

  const manifest: Manifest = {
    schemaVersion: 1,
    generator: { name: GENERATOR_NAME, version: VERSION },
    packId,
    run: {
      startTime: run.startTime,
      durationMs: run.durationMs,
      ...(run.playwrightVersion !== undefined ? { playwrightVersion: run.playwrightVersion } : {}),
      tests: totals,
    },
    git,
    controls: controlSummaries,
    gaps: evaluation.gaps,
    summary: {
      controls: evaluation.results.length,
      passed: evaluation.results.filter((r) => r.status === 'passed').length,
      failed: evaluation.results.filter((r) => r.status === 'failed').length,
      gapControls: evaluation.results.filter((r) => r.status === 'gap').length,
      gaps: evaluation.gaps.length,
    },
    files: fileHashes,
  };
  const manifestText = canonicalJsonPretty(manifest);
  const manifestSha256 = sha256Hex(manifestText);

  // Fail fast, before anything is written: a broken ledger must not gain an
  // orphan pack, and an existing pack with different content must not be
  // silently destroyed (pack IDs collide only for reruns of the same instant).
  const ledgerFile = join(outRoot, 'ledger.jsonl');
  const chain = verifyLedger(ledgerFile);
  if (!chain.ok) {
    throw new LedgerError(
      `refusing to write a pack: ledger chain verification failed:\n  ${chain.errors.join('\n  ')}`,
    );
  }
  if (existsSync(packDir)) {
    let identical = false;
    try {
      identical = sha256Hex(readFileSync(join(packDir, 'manifest.json'))) === manifestSha256;
    } catch {
      identical = false;
    }
    if (!identical) {
      throw new PackError(
        `pack ${packId} already exists at ${packDir} with different content; refusing to overwrite evidence — remove that directory first if regeneration is intended`,
      );
    }
  }

  rmSync(packDir, { recursive: true, force: true });
  for (const [rel, content] of files) {
    const target = join(packDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  writeFileSync(join(packDir, 'manifest.json'), manifestText, 'utf8');

  const ledger = appendToLedger(ledgerFile, {
    packId,
    manifestSha256,
    runStartTime: run.startTime,
  });

  return { packDir, packId, manifest, manifestSha256, evaluation, ledger };
}
