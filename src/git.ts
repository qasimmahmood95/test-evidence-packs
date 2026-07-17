import { execFileSync } from 'node:child_process';
import type { GitMeta } from './types.js';

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return undefined;
  }
}

/** Detect commit/branch/tag/dirty for the repo containing `cwd`; null when not a repo (or no commits yet). */
export function detectGitMeta(cwd: string): GitMeta | null {
  const commit = git(cwd, ['rev-parse', 'HEAD']);
  if (!commit) return null;
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const tag = git(cwd, ['describe', '--tags', '--exact-match']);
  const status = git(cwd, ['status', '--porcelain']);
  const meta: GitMeta = { commit };
  if (branch && branch !== 'HEAD') meta.branch = branch;
  if (tag) meta.tag = tag;
  if (status !== undefined) meta.dirty = status.length > 0;
  return meta;
}
