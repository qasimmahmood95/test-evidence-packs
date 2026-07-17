import { describe, expect, it } from 'vitest';
import { ControlsError, parseControls } from '../src/controls.js';

const VALID = `
version: 1
meta:
  system: demo
defaults:
  match: any
controls:
  B-002:
    title: Second control
    tags: ["@x"]
  A-001:
    title: First control
    description: Something.
    tags: ["@compliance", "@control:A-001"]
    match: all
    evidence:
      styles: [negative, boundary, boundary]
      min_tests: 2
    owner: team-a
    references: ["POL-1"]
`;

describe('parseControls', () => {
  it('parses a valid document and sorts controls by ID', () => {
    const doc = parseControls(VALID);
    expect(doc.controls.map((c) => c.id)).toEqual(['A-001', 'B-002']);
    expect(doc.meta['system']).toBe('demo');
    expect(doc.defaults.match).toBe('any');
  });

  it('dedupes and sorts declared styles', () => {
    const doc = parseControls(VALID);
    expect(doc.controls[0]?.evidence.styles).toEqual(['boundary', 'negative']);
  });

  it('applies defaults: match, prefixes, min_tests', () => {
    const doc = parseControls(VALID);
    expect(doc.defaults.controlTagPrefix).toBe('@control:');
    expect(doc.defaults.styleTagPrefix).toBe('@style:');
    expect(doc.controls[1]?.match).toBe('any'); // inherited from defaults
    expect(doc.controls[0]?.match).toBe('all'); // per-control override
    expect(doc.controls[1]?.evidence.minTests).toBe(1);
  });

  it('parses annotation matchers and stringifies numeric values', () => {
    const doc = parseControls(`
version: 1
controls:
  R-1:
    title: Rule matched by annotation
    annotations:
      - type: rule
        value: MC-DUAL-APPROVAL
      - type: reviewed
`);
    expect(doc.controls[0]?.annotations).toEqual([
      { type: 'rule', value: 'MC-DUAL-APPROVAL' },
      { type: 'reviewed' },
    ]);
  });

  const rejects = (yaml: string, pattern: RegExp): void => {
    expect(() => parseControls(yaml)).toThrowError(ControlsError);
    expect(() => parseControls(yaml)).toThrowError(pattern);
  };

  it('rejects a wrong schema version', () => {
    rejects('version: 2\ncontrols:\n  A:\n    title: t\n    tags: ["@a"]', /version/);
  });

  it('rejects a control without title', () => {
    rejects('version: 1\ncontrols:\n  A:\n    tags: ["@a"]', /title/);
  });

  it('rejects tags missing the "@" prefix', () => {
    rejects('version: 1\ncontrols:\n  A:\n    title: t\n    tags: ["compliance"]', /must start with "@"/);
  });

  it('rejects a control with neither tags nor annotations', () => {
    rejects('version: 1\ncontrols:\n  A:\n    title: t', /at least one tag or annotation/);
  });

  it('rejects a non-positive min_tests', () => {
    rejects(
      'version: 1\ncontrols:\n  A:\n    title: t\n    tags: ["@a"]\n    evidence:\n      min_tests: 0',
      /min_tests/,
    );
  });

  it('rejects invalid control IDs', () => {
    rejects('version: 1\ncontrols:\n  "bad id":\n    title: t\n    tags: ["@a"]', /control IDs/);
  });

  it('rejects invalid YAML with a helpful message', () => {
    rejects('version: [1', /not valid YAML/);
  });

  it('rejects duplicate control IDs (YAML duplicate keys throw)', () => {
    rejects(
      'version: 1\ncontrols:\n  A:\n    title: t\n    tags: ["@a"]\n  A:\n    title: t2\n    tags: ["@a"]',
      /not valid YAML/,
    );
  });

  it('rejects control IDs that collide case-insensitively (they share a file name on NTFS/APFS)', () => {
    rejects(
      'version: 1\ncontrols:\n  TR-001:\n    title: t\n    tags: ["@a"]\n  tr-001:\n    title: t2\n    tags: ["@a"]',
      /case-insensitively/,
    );
  });

  it('rejects unknown keys so typos cannot silently drop requirements', () => {
    rejects('version: 1\ncontrols:\n  A:\n    title: t\n    tags: ["@a"]\n    referances: ["x"]', /unknown key/);
    rejects('version: 1\nkontrols: {}\ncontrols:\n  A:\n    title: t\n    tags: ["@a"]', /unknown key/);
    rejects(
      'version: 1\ncontrols:\n  A:\n    title: t\n    tags: ["@a"]\n    evidence:\n      min_test: 2',
      /unknown key/,
    );
  });
});
