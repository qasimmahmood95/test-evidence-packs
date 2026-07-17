import { createHash } from 'node:crypto';

/**
 * Recursively sort object keys (UTF-16 code-unit order — deterministic and
 * locale-independent) and drop undefined-valued entries, so serialization is
 * deterministic.
 */
export function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortDeep(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/** Compact canonical JSON — used for ledger lines and hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

/** Pretty canonical JSON with trailing newline — used for files humans read. */
export function canonicalJsonPretty(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
