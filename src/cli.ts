#!/usr/bin/env node
import { join, relative, resolve } from 'node:path';
import { Command } from 'commander';
import { describeGap } from './evaluate.js';
import { detectGitMeta } from './git.js';
import { ledgerHeadSha } from './ledger.js';
import { generatePack } from './pack.js';
import type { GitMeta } from './types.js';
import { verifyEvidenceDir } from './verify.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('tep')
  .description('Turn Playwright test runs into audit-ready, tamper-evident evidence packs.')
  .version(VERSION);

interface GenerateCliOptions {
  report: string;
  controls: string;
  out: string;
  git: boolean;
  gitCommit?: string;
  gitBranch?: string;
  gitTag?: string;
  failOnGaps?: boolean;
  failOnFailures?: boolean;
}

program
  .command('generate')
  .description('Generate an evidence pack from a Playwright JSON report and a controls map')
  .requiredOption('-r, --report <file>', 'Playwright JSON report (from --reporter=json)')
  .requiredOption('-c, --controls <file>', 'controls map (controls.yaml)')
  .option('-o, --out <dir>', 'evidence output directory', 'evidence')
  .option('--git-commit <sha>', 'override the detected git commit')
  .option('--git-branch <name>', 'override the detected git branch')
  .option('--git-tag <name>', 'override the detected git tag')
  .option('--no-git', 'record no git metadata')
  .option('--fail-on-gaps', 'exit with code 2 when coverage gaps are detected')
  .option('--fail-on-failures', 'exit with code 1 when any control has failing tests')
  .action((opts: GenerateCliOptions) => {
    const cwd = process.cwd();

    if (!opts.git && (opts.gitCommit || opts.gitBranch || opts.gitTag)) {
      console.error('tep: --no-git contradicts --git-commit/--git-branch/--git-tag — drop one of them');
      process.exit(1);
    }

    let git: GitMeta | null = null;
    if (opts.git) {
      git = detectGitMeta(cwd);
      if (opts.gitCommit || opts.gitBranch || opts.gitTag) {
        const commit = opts.gitCommit ?? git?.commit;
        if (!commit) {
          console.error(
            'tep: --git-branch/--git-tag were given but no commit is known; pass --git-commit or run inside a git repository',
          );
          process.exit(1);
        }
        git = { commit };
        const branch = opts.gitBranch ?? undefined;
        const tag = opts.gitTag ?? undefined;
        if (branch) git.branch = branch;
        if (tag) git.tag = tag;
      }
    }

    const result = generatePack({
      controlsPath: opts.controls,
      outDir: opts.out,
      source: { kind: 'report', reportPath: opts.report },
      git,
      cwd,
    });

    const { summary } = result.manifest;
    console.log(`Evidence pack: ${relative(cwd, result.packDir)}`);
    console.log(
      `Controls: ${summary.passed} passed, ${summary.failed} failed, ${summary.gapControls} with gaps (${summary.controls} total)`,
    );
    if (result.evaluation.gaps.length > 0) {
      console.log('Gaps:');
      for (const gap of result.evaluation.gaps) console.log(`  - ${describeGap(gap)}`);
    }
    console.log(
      result.ledger.appended
        ? `Ledger: entry #${result.ledger.entry.seq} appended (manifest sha256 ${result.manifestSha256.slice(0, 12)}…)`
        : `Ledger: entry #${result.ledger.entry.seq} already covers this exact pack — nothing appended`,
    );
    const head = ledgerHeadSha(resolve(cwd, opts.out, 'ledger.jsonl'));
    if (head) {
      console.log(`Ledger head: ${head}`);
      console.log('  (record this hash externally — CI log, signed tag — to make ledger truncation detectable)');
    }

    if (opts.failOnFailures && summary.failed > 0) process.exitCode = 1;
    else if (opts.failOnGaps && summary.gaps > 0) process.exitCode = 2;
  });

program
  .command('verify')
  .description('Verify an evidence directory: ledger hash chain, pack file hashes, pack↔ledger linkage')
  .argument('<dir>', 'evidence directory (contains ledger.jsonl and packs/)')
  .option(
    '--head <sha256>',
    'expected ledger head (sha256 of the last line) from an external anchor; detects tail truncation',
  )
  .action((dir: string, opts: { head?: string }) => {
    const root = resolve(dir);
    const result = verifyEvidenceDir(root);
    for (const issue of result.issues) {
      console.log(`${issue.level.toUpperCase().padEnd(7)} ${issue.where}: ${issue.message}`);
    }
    let headOk = true;
    let head: string | null = null;
    try {
      head = ledgerHeadSha(join(root, 'ledger.jsonl'));
    } catch {
      head = null; // the chain errors above already cover an unreadable ledger
    }
    if (head) console.log(`Ledger head: ${head}`);
    if (opts.head !== undefined && opts.head !== head) {
      console.log(
        `ERROR   ledger.jsonl: head is ${head ?? '(empty)'} but ${opts.head} was expected — entries were removed from the tail or the anchor is stale`,
      );
      headOk = false;
    }
    const ok = result.ok && headOk;
    console.log(
      `${ok ? 'OK' : 'FAILED'} — ${result.ledgerEntries} ledger entr${result.ledgerEntries === 1 ? 'y' : 'ies'}, ${result.packsChecked} pack(s) checked, ${result.issues.filter((i) => i.level === 'error').length + (headOk ? 0 : 1)} error(s), ${result.issues.filter((i) => i.level === 'warning').length} warning(s)`,
    );
    if (!ok) process.exitCode = 1;
  });

try {
  program.parse();
} catch (err) {
  console.error(`tep: ${(err as Error).message}`);
  process.exitCode = 1;
}
