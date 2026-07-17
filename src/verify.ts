import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from './canonical.js';
import { verifyLedger } from './ledger.js';
import type { LedgerEntry, Manifest } from './types.js';

export interface VerifyIssue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

export interface VerifyResult {
  ok: boolean;
  issues: VerifyIssue[];
  packsChecked: number;
  ledgerEntries: number;
}

function walkFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base === '' ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

/** Verify an evidence directory: ledger hash chain, per-pack file hashes, pack↔ledger linkage. */
export function verifyEvidenceDir(root: string): VerifyResult {
  const issues: VerifyIssue[] = [];
  const error = (where: string, message: string): void => {
    issues.push({ level: 'error', where, message });
  };
  const warning = (where: string, message: string): void => {
    issues.push({ level: 'warning', where, message });
  };

  const ledgerFile = join(root, 'ledger.jsonl');
  if (!existsSync(ledgerFile)) {
    error('ledger.jsonl', 'not found — is this an evidence directory?');
    return { ok: false, issues, packsChecked: 0, ledgerEntries: 0 };
  }
  const ledger = verifyLedger(ledgerFile);
  for (const msg of ledger.errors) error('ledger.jsonl', msg);

  const latestByPackId = new Map<string, LedgerEntry>();
  const manifestsByPackId = new Map<string, Set<string>>();
  for (const entry of ledger.entries) {
    latestByPackId.set(entry.packId, entry);
    const set = manifestsByPackId.get(entry.packId) ?? new Set<string>();
    set.add(entry.manifestSha256);
    manifestsByPackId.set(entry.packId, set);
  }
  for (const [packId, manifests] of manifestsByPackId) {
    if (manifests.size > 1) {
      warning(
        `pack ${packId}`,
        `the ledger contains ${manifests.size} entries with differing manifests for this pack ID — it was regenerated or re-sealed`,
      );
    }
  }

  const packsDir = join(root, 'packs');
  const packDirs: string[] = [];
  if (existsSync(packsDir)) {
    for (const name of readdirSync(packsDir).sort()) {
      let isDir = false;
      try {
        isDir = statSync(join(packsDir, name)).isDirectory();
      } catch {
        error(`packs/${name}`, 'could not be read');
        continue;
      }
      if (isDir) packDirs.push(name);
      else warning(`packs/${name}`, 'stray file in the packs directory (packs are directories)');
    }
  }

  let packsChecked = 0;
  for (const dir of packDirs) {
    const where = `packs/${dir}`;
    const packPath = join(packsDir, dir);
    const manifestPath = join(packPath, 'manifest.json');
    if (!existsSync(manifestPath)) {
      error(where, 'manifest.json is missing');
      continue;
    }
    const manifestBytes = readFileSync(manifestPath);
    let manifest: Manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8')) as Manifest;
    } catch {
      error(where, 'manifest.json is not valid JSON');
      continue;
    }
    packsChecked++;

    const listed = manifest.files ?? {};
    for (const [rel, expected] of Object.entries(listed)) {
      const filePath = join(packPath, rel);
      if (!existsSync(filePath)) {
        error(`${where}/${rel}`, 'listed in manifest but missing from the pack');
        continue;
      }
      const actual = sha256Hex(readFileSync(filePath));
      if (actual !== expected) {
        error(`${where}/${rel}`, `sha256 mismatch — the file was altered after the pack was written`);
      }
    }
    for (const rel of walkFiles(packPath)) {
      if (rel !== 'manifest.json' && !(rel in listed)) {
        error(`${where}/${rel}`, 'present in the pack but not listed in the manifest — planted after the pack was written');
      }
    }

    const entry = latestByPackId.get(manifest.packId);
    const manifestSha = sha256Hex(manifestBytes);
    if (!entry) {
      error(where, 'no ledger entry references this pack');
    } else if (entry.manifestSha256 !== manifestSha) {
      error(where, 'manifest.json does not match its ledger entry — the pack or the ledger was altered');
    } else if (entry.runStartTime !== manifest.run?.startTime) {
      // The tail ledger line has no successor hashing it yet; the (hashed,
      // linked) manifest is the authority for its metadata fields.
      error(where, `ledger entry runStartTime (${entry.runStartTime}) does not match the pack manifest (${manifest.run?.startTime}) — the ledger entry was altered`);
    }
    if (manifest.packId !== dir) {
      warning(where, `directory name does not match the manifest packId (${manifest.packId})`);
    }
  }

  const present = new Set(packDirs);
  for (const entry of ledger.entries) {
    if (!present.has(entry.packId)) {
      warning(`ledger entry #${entry.seq}`, `pack ${entry.packId} is not present on disk (archived elsewhere?)`);
    }
  }

  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    packsChecked,
    ledgerEntries: ledger.entries.length,
  };
}
