import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/canonical.js';
import { GENESIS_HASH, LedgerError, appendToLedger, ledgerHeadSha, verifyLedger } from '../src/ledger.js';

function tempLedger(): string {
  return join(mkdtempSync(join(tmpdir(), 'tep-ledger-')), 'ledger.jsonl');
}

const entry = (n: number): { packId: string; manifestSha256: string; runStartTime: string } => ({
  packId: `2026-01-0${n}T00-00-00Z_abc123${n}`,
  manifestSha256: String(n).repeat(64),
  runStartTime: `2026-01-0${n}T00:00:00.000Z`,
});

describe('ledger', () => {
  it('chains entries: first from genesis, then each from the previous line', () => {
    const file = tempLedger();
    const first = appendToLedger(file, entry(1));
    const second = appendToLedger(file, entry(2));
    const third = appendToLedger(file, entry(3));
    expect(first.entry.prevSha256).toBe(GENESIS_HASH);
    expect(second.entry.seq).toBe(2);
    expect(third.entry.seq).toBe(3);
    expect(verifyLedger(file).ok).toBe(true);
  });

  it('is idempotent for an identical (packId, manifestSha256) pair', () => {
    const file = tempLedger();
    appendToLedger(file, entry(1));
    const again = appendToLedger(file, entry(1));
    expect(again.appended).toBe(false);
    expect(again.entry.seq).toBe(1);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('appends a new entry when the same pack ID carries a different manifest', () => {
    const file = tempLedger();
    appendToLedger(file, entry(1));
    const changed = appendToLedger(file, { ...entry(1), manifestSha256: 'f'.repeat(64) });
    expect(changed.appended).toBe(true);
    expect(changed.entry.seq).toBe(2);
  });

  it('detects a tampered line', () => {
    const file = tempLedger();
    appendToLedger(file, entry(1));
    appendToLedger(file, entry(2));
    appendToLedger(file, entry(3));
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    lines[1] = lines[1]!.replace('222222', '999999'); // alter entry 2's manifest hash
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    const result = verifyLedger(file);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('altered'))).toBe(true);
  });

  it('detects a deleted line', () => {
    const file = tempLedger();
    appendToLedger(file, entry(1));
    appendToLedger(file, entry(2));
    appendToLedger(file, entry(3));
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    writeFileSync(file, `${[lines[0], lines[2]].join('\n')}\n`, 'utf8');
    expect(verifyLedger(file).ok).toBe(false);
  });

  it('refuses to append to a broken chain', () => {
    // Altering entry 1 is only detectable once entry 2 chains over it.
    const file = tempLedger();
    appendToLedger(file, entry(1));
    appendToLedger(file, entry(2));
    const raw = readFileSync(file, 'utf8');
    writeFileSync(file, raw.replace('111111', '888888'), 'utf8');
    expect(() => appendToLedger(file, entry(3))).toThrowError(LedgerError);
  });

  it('verifies an absent ledger as an empty, valid chain', () => {
    expect(verifyLedger(tempLedger()).ok).toBe(true);
  });

  it('rejects blank lines injected between entries', () => {
    const file = tempLedger();
    appendToLedger(file, entry(1));
    appendToLedger(file, entry(2));
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    writeFileSync(file, `${lines[0]}\n\n${lines[1]}\n`, 'utf8');
    const result = verifyLedger(file);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('blank'))).toBe(true);
  });

  it('rejects CRLF conversion even on a single-entry ledger', () => {
    const file = tempLedger();
    appendToLedger(file, entry(1));
    writeFileSync(file, readFileSync(file, 'utf8').replaceAll('\n', '\r\n'), 'utf8');
    const result = verifyLedger(file);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('carriage return'))).toBe(true);
  });

  it('exposes the chain head (sha256 of the last line) for external anchoring', () => {
    const file = tempLedger();
    expect(ledgerHeadSha(file)).toBeNull();
    appendToLedger(file, entry(1));
    appendToLedger(file, entry(2));
    const lastLine = readFileSync(file, 'utf8').trim().split('\n').at(-1)!;
    expect(ledgerHeadSha(file)).toBe(sha256Hex(lastLine));
  });
});
