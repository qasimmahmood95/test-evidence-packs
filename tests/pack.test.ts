import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LedgerError } from '../src/ledger.js';
import { PackError, generatePack } from '../src/pack.js';
import { verifyEvidenceDir } from '../src/verify.js';
import { FIXTURE_GIT } from './helpers.js';

const CONTROLS = fileURLToPath(new URL('./fixtures/controls.yaml', import.meta.url));
const REPORT = fileURLToPath(new URL('./fixtures/report.json', import.meta.url));

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'tep-pack-'));
}

function generateInto(outDir: string) {
  return generatePack({
    controlsPath: CONTROLS,
    outDir,
    source: { kind: 'report', reportPath: REPORT },
    git: FIXTURE_GIT,
    cwd: outDir,
  });
}

function walkFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = base === '' ? name : `${base}/${name}`;
    if (statSync(join(dir, name)).isDirectory()) out.push(...walkFiles(join(dir, name), rel));
    else out.push(rel);
  }
  return out;
}

describe('generatePack', () => {
  it('derives the pack ID from run start time (ms precision) and commit', () => {
    const result = generateInto(tempDir());
    expect(result.packId).toBe('2026-01-02T03-04-05-678Z_a1b2c3d');
  });

  it('writes the expected pack layout', () => {
    const out = tempDir();
    const result = generateInto(out);
    expect(walkFiles(result.packDir)).toEqual([
      'EVIDENCE.md',
      'GAPS.md',
      'controls/FX-001.md',
      'controls/FX-002.md',
      'controls/FX-003.md',
      'index.html',
      'inputs/controls.yaml',
      'inputs/report.json',
      'manifest.json',
    ]);
    expect(readFileSync(join(out, 'ledger.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('copies inputs verbatim and lists every pack file in the manifest', () => {
    const result = generateInto(tempDir());
    expect(readFileSync(join(result.packDir, 'inputs/report.json'))).toEqual(readFileSync(REPORT));
    expect(readFileSync(join(result.packDir, 'inputs/controls.yaml'))).toEqual(readFileSync(CONTROLS));
    const listed = Object.keys(result.manifest.files).sort();
    const onDisk = walkFiles(result.packDir).filter((f) => f !== 'manifest.json');
    expect(listed).toEqual(onDisk);
  });

  it('summarizes controls and gaps in the manifest', () => {
    const result = generateInto(tempDir());
    expect(result.manifest.summary).toEqual({
      controls: 3,
      passed: 1,
      failed: 1,
      gapControls: 1,
      gaps: 2,
    });
    expect(result.manifest.controls['FX-001']?.status).toBe('passed');
    expect(result.manifest.controls['FX-002']?.status).toBe('failed');
    expect(result.manifest.controls['FX-003']?.status).toBe('gap');
    expect(result.manifest.gaps).toContainEqual({ kind: 'no-passing-evidence', controlId: 'FX-003' });
    expect(result.manifest.gaps).toContainEqual({
      kind: 'unknown-control-tag',
      tag: '@control:FX-999',
      tests: ['tagged with a control that does not exist @control:FX-999 (tests/typo.spec.ts:3)'],
    });
  });

  it('is deterministic: same inputs produce byte-identical packs', () => {
    const a = generateInto(tempDir());
    const b = generateInto(tempDir());
    expect(b.packId).toBe(a.packId);
    expect(b.manifestSha256).toBe(a.manifestSha256);
    const filesA = walkFiles(a.packDir);
    expect(walkFiles(b.packDir)).toEqual(filesA);
    for (const rel of filesA) {
      expect(readFileSync(join(b.packDir, rel))).toEqual(readFileSync(join(a.packDir, rel)));
    }
  });

  it('re-running over the same inputs does not grow the ledger', () => {
    const out = tempDir();
    const first = generateInto(out);
    const second = generateInto(out);
    expect(first.ledger.appended).toBe(true);
    expect(second.ledger.appended).toBe(false);
    expect(readFileSync(join(out, 'ledger.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('refuses to overwrite an existing pack with different content', () => {
    const out = tempDir();
    generateInto(out);
    // Same startTime + commit (same packId), different content.
    const report = JSON.parse(readFileSync(REPORT, 'utf8')) as { stats: { duration: number } };
    report.stats.duration = 9999;
    const alteredReport = join(out, 'altered-report.json');
    writeFileSync(alteredReport, JSON.stringify(report), 'utf8');
    expect(() =>
      generatePack({
        controlsPath: CONTROLS,
        outDir: out,
        source: { kind: 'report', reportPath: alteredReport },
        git: FIXTURE_GIT,
        cwd: out,
      }),
    ).toThrowError(PackError);
    // The original pack and ledger are untouched.
    expect(verifyEvidenceDir(out).ok).toBe(true);
  });

  it('fails fast on a corrupted ledger without writing an orphan pack', () => {
    const out = tempDir();
    writeFileSync(join(out, 'ledger.jsonl'), 'not json\n', 'utf8');
    expect(() => generateInto(out)).toThrowError(LedgerError);
    expect(existsSync(join(out, 'packs'))).toBe(false);
  });
});

describe('verifyEvidenceDir', () => {
  it('accepts an untouched evidence directory', () => {
    const out = tempDir();
    generateInto(out);
    const result = verifyEvidenceDir(out);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.packsChecked).toBe(1);
  });

  it('flags an altered pack file', () => {
    const out = tempDir();
    const { packDir } = generateInto(out);
    const target = join(packDir, 'EVIDENCE.md');
    writeFileSync(target, `${readFileSync(target, 'utf8')}\ntampered\n`, 'utf8');
    const result = verifyEvidenceDir(out);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.level === 'error' && i.where.endsWith('EVIDENCE.md'))).toBe(true);
  });

  it('flags an altered manifest via the ledger entry', () => {
    const out = tempDir();
    const { packDir } = generateInto(out);
    const manifestPath = join(packDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { summary: { failed: number } };
    manifest.summary.failed = 0; // cook the books
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    const result = verifyEvidenceDir(out);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('ledger entry'))).toBe(true);
  });

  it('treats files planted inside a pack as errors', () => {
    const out = tempDir();
    const { packDir } = generateInto(out);
    writeFileSync(join(packDir, 'APPROVED.html'), 'looks official\n', 'utf8');
    const result = verifyEvidenceDir(out);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.level === 'error' && i.where.endsWith('APPROVED.html'))).toBe(true);
  });

  it('flags a tampered tail ledger entry via the hashed manifest', () => {
    const out = tempDir();
    generateInto(out);
    const ledgerPath = join(out, 'ledger.jsonl');
    const entry = JSON.parse(readFileSync(ledgerPath, 'utf8').trim()) as { runStartTime: string };
    entry.runStartTime = '1999-01-01T00:00:00.000Z';
    writeFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
    const result = verifyEvidenceDir(out);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('runStartTime'))).toBe(true);
  });

  it('warns when the ledger holds divergent manifests for one pack ID (regeneration tell)', () => {
    const out = tempDir();
    const first = generateInto(out);
    rmSync(first.packDir, { recursive: true });
    const report = JSON.parse(readFileSync(REPORT, 'utf8')) as { stats: { duration: number } };
    report.stats.duration = 9999;
    const alteredReport = join(out, 'altered-report.json');
    writeFileSync(alteredReport, JSON.stringify(report), 'utf8');
    generatePack({
      controlsPath: CONTROLS,
      outDir: out,
      source: { kind: 'report', reportPath: alteredReport },
      git: FIXTURE_GIT,
      cwd: out,
    });
    const result = verifyEvidenceDir(out);
    expect(result.ok).toBe(true); // legitimate regeneration, but visibly flagged
    expect(result.issues.some((i) => i.level === 'warning' && i.message.includes('re-sealed'))).toBe(true);
  });
});
