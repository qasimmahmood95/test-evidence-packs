import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generatePack } from '../src/pack.js';
import { FIXTURE_GIT } from './helpers.js';

const CONTROLS = fileURLToPath(new URL('./fixtures/controls.yaml', import.meta.url));
const REPORT = fileURLToPath(new URL('./fixtures/report.json', import.meta.url));
const GOLDEN = fileURLToPath(new URL('./golden/evidence', import.meta.url));

function walkFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = base === '' ? name : `${base}/${name}`;
    if (statSync(join(dir, name)).isDirectory()) out.push(...walkFiles(join(dir, name), rel));
    else out.push(rel);
  }
  return out;
}

// A full-pack snapshot: any change to pack bytes must be reviewed by
// regenerating the golden files with `pnpm golden:update`.
describe('golden pack', () => {
  it('matches the committed golden evidence directory byte for byte', () => {
    const out = mkdtempSync(join(tmpdir(), 'tep-golden-'));
    generatePack({
      controlsPath: CONTROLS,
      outDir: out,
      source: { kind: 'report', reportPath: REPORT },
      git: FIXTURE_GIT,
      cwd: out,
    });

    if (process.env['UPDATE_GOLDEN']) {
      rmSync(GOLDEN, { recursive: true, force: true });
      cpSync(out, GOLDEN, { recursive: true });
      return;
    }

    expect(
      existsSync(GOLDEN),
      'golden files missing — run `pnpm golden:update` and commit the result',
    ).toBe(true);

    const expected = walkFiles(GOLDEN);
    expect(walkFiles(out)).toEqual(expected);
    for (const rel of expected) {
      const actual = readFileSync(join(out, rel));
      const golden = readFileSync(join(GOLDEN, rel));
      expect(actual.equals(golden), `byte mismatch in ${rel}`).toBe(true);
    }
  });
});
