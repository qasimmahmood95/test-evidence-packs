import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson, sha256Hex } from './canonical.js';
import type { LedgerEntry } from './types.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface LedgerReadResult {
  entries: LedgerEntry[];
  /** Raw line strings, exactly as hashed (no trailing newline). */
  lines: string[];
}

export class LedgerError extends Error {}

export function readLedger(file: string): LedgerReadResult {
  if (!existsSync(file)) return { entries: [], lines: [] };
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  if (lines.at(-1) === '') lines.pop(); // the file ends with a newline
  const entries = lines.map((line, i) => {
    if (line.length === 0) {
      throw new LedgerError(`ledger line ${i + 1} is blank — the ledger was altered`);
    }
    if (line.includes('\r')) {
      throw new LedgerError(
        `ledger line ${i + 1} contains a carriage return — line endings were altered (CRLF conversion breaks the hash chain)`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new LedgerError(`ledger line ${i + 1} is not valid JSON`);
    }
    return parsed as LedgerEntry;
  });
  return { entries, lines };
}

/**
 * sha256 of the ledger's last line — the chain head. Anchor it externally
 * (CI log, signed tag) to make tail truncation detectable; null when empty.
 */
export function ledgerHeadSha(file: string): string | null {
  const { lines } = readLedger(file);
  const last = lines.at(-1);
  return last === undefined ? null : sha256Hex(last);
}

export interface LedgerVerifyResult {
  ok: boolean;
  errors: string[];
  entries: LedgerEntry[];
}

/** Check the hash chain: every entry's prevSha256 must equal the sha256 of the previous line's bytes. */
export function verifyLedger(file: string): LedgerVerifyResult {
  const errors: string[] = [];
  let entries: LedgerEntry[] = [];
  let lines: string[] = [];
  try {
    ({ entries, lines } = readLedger(file));
  } catch (err) {
    return { ok: false, errors: [(err as Error).message], entries: [] };
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const expectedPrev = i === 0 ? GENESIS_HASH : sha256Hex(lines[i - 1]!);
    if (entry.prevSha256 !== expectedPrev) {
      errors.push(
        `ledger entry ${i + 1} (pack ${entry.packId}): prevSha256 does not match the previous line — the ledger has been altered`,
      );
    }
    if (entry.seq !== i + 1) {
      errors.push(`ledger entry ${i + 1} (pack ${entry.packId}): seq is ${entry.seq}, expected ${i + 1}`);
    }
  }
  return { ok: errors.length === 0, errors, entries };
}

export interface AppendResult {
  entry: LedgerEntry;
  /** False when an identical (packId, manifestSha256) entry already exists — re-runs are idempotent. */
  appended: boolean;
}

export function appendToLedger(
  file: string,
  input: { packId: string; manifestSha256: string; runStartTime: string },
): AppendResult {
  const check = verifyLedger(file);
  if (!check.ok) {
    throw new LedgerError(
      `refusing to append: ledger chain verification failed:\n  ${check.errors.join('\n  ')}`,
    );
  }
  const { entries, lines } = readLedger(file);
  const existing = entries.find(
    (e) => e.packId === input.packId && e.manifestSha256 === input.manifestSha256,
  );
  if (existing) return { entry: existing, appended: false };

  const lastLine = lines.at(-1);
  const entry: LedgerEntry = {
    seq: entries.length + 1,
    packId: input.packId,
    manifestSha256: input.manifestSha256,
    prevSha256: lastLine === undefined ? GENESIS_HASH : sha256Hex(lastLine),
    runStartTime: input.runStartTime,
  };
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${canonicalJson(entry)}\n`, 'utf8');
  return { entry, appended: true };
}
