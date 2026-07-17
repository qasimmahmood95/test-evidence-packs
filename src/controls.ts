import { parse } from 'yaml';
import type {
  AnnotationMatcher,
  ControlDef,
  ControlDefaults,
  ControlsDoc,
  EvidenceRequirements,
  MatchMode,
} from './types.js';

export class ControlsError extends Error {}

const CONTROL_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const STYLE_PATTERN = /^[a-z][a-z0-9-]*$/;

function fail(path: string, message: string): never {
  throw new ControlsError(`controls map: ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Typos must not silently drop evidence requirements, so unknown keys are rejected. */
function rejectUnknownKeys(record: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      fail(`${path}.${key}`, `unknown key (expected one of: ${allowed.join(', ')})`);
    }
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'must be a mapping');
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'must be a non-empty string');
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return asString(value, path);
}

function asStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, 'must be a list of strings');
  return value.map((v, i) => asString(v, `${path}[${i}]`));
}

function parseDefaults(value: unknown): ControlDefaults {
  const raw = value === undefined ? {} : asRecord(value, 'defaults');
  rejectUnknownKeys(raw, ['control_tag_prefix', 'style_tag_prefix', 'match'], 'defaults');
  const controlTagPrefix = optionalString(raw['control_tag_prefix'], 'defaults.control_tag_prefix') ?? '@control:';
  const styleTagPrefix = optionalString(raw['style_tag_prefix'], 'defaults.style_tag_prefix') ?? '@style:';
  if (!controlTagPrefix.startsWith('@')) fail('defaults.control_tag_prefix', 'must start with "@"');
  if (!styleTagPrefix.startsWith('@')) fail('defaults.style_tag_prefix', 'must start with "@"');
  const match = parseMatch(raw['match'], 'defaults.match') ?? 'all';
  return { controlTagPrefix, styleTagPrefix, match };
}

function parseMatch(value: unknown, path: string): MatchMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== 'all' && value !== 'any') fail(path, 'must be "all" or "any"');
  return value;
}

function parseAnnotations(value: unknown, path: string): AnnotationMatcher[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(path, 'must be a list');
  return value.map((item, i) => {
    const raw = asRecord(item, `${path}[${i}]`);
    rejectUnknownKeys(raw, ['type', 'value'], `${path}[${i}]`);
    const type = asString(raw['type'], `${path}[${i}].type`);
    const valueRaw = raw['value'];
    const matcher: AnnotationMatcher = { type };
    if (valueRaw !== undefined && valueRaw !== null) {
      if (typeof valueRaw !== 'string' && typeof valueRaw !== 'number') {
        fail(`${path}[${i}].value`, 'must be a string or number');
      }
      matcher.value = String(valueRaw);
    }
    return matcher;
  });
}

function parseEvidence(value: unknown, path: string): EvidenceRequirements {
  const raw = value === undefined ? {} : asRecord(value, path);
  rejectUnknownKeys(raw, ['styles', 'min_tests'], path);
  const stylesRaw = raw['styles'] === undefined ? [] : asStringArray(raw['styles'], `${path}.styles`);
  for (const style of stylesRaw) {
    if (!STYLE_PATTERN.test(style)) {
      fail(`${path}.styles`, `"${style}" is not a valid style name (lowercase words, e.g. boundary, negative, lifecycle)`);
    }
  }
  const styles = [...new Set(stylesRaw)].sort();
  let minTests = 1;
  const minRaw = raw['min_tests'];
  if (minRaw !== undefined && minRaw !== null) {
    if (typeof minRaw !== 'number' || !Number.isInteger(minRaw) || minRaw < 1) {
      fail(`${path}.min_tests`, 'must be a positive integer');
    }
    minTests = minRaw;
  }
  return { styles, minTests };
}

function parseControl(id: string, value: unknown, defaults: ControlDefaults): ControlDef {
  const path = `controls.${id}`;
  if (!CONTROL_ID_PATTERN.test(id)) {
    fail(path, 'control IDs must start with a letter and contain only letters, digits, ".", "_", "-"');
  }
  const raw = asRecord(value, path);
  rejectUnknownKeys(
    raw,
    ['title', 'description', 'tags', 'annotations', 'match', 'evidence', 'owner', 'references'],
    path,
  );
  const title = asString(raw['title'], `${path}.title`);
  const description = optionalString(raw['description'], `${path}.description`);
  const tags = raw['tags'] === undefined ? [] : asStringArray(raw['tags'], `${path}.tags`);
  for (const tag of tags) {
    if (!tag.startsWith('@')) fail(`${path}.tags`, `"${tag}" must start with "@" (Playwright tag syntax)`);
  }
  const annotations = parseAnnotations(raw['annotations'], `${path}.annotations`);
  if (tags.length === 0 && annotations.length === 0) {
    fail(path, 'must declare at least one tag or annotation matcher, otherwise no test can evidence it');
  }
  const match = parseMatch(raw['match'], `${path}.match`) ?? defaults.match;
  const evidence = parseEvidence(raw['evidence'], `${path}.evidence`);
  const owner = optionalString(raw['owner'], `${path}.owner`);
  const references = raw['references'] === undefined ? [] : asStringArray(raw['references'], `${path}.references`);

  const control: ControlDef = { id, title, tags, annotations, match, evidence, references };
  if (description !== undefined) control.description = description;
  if (owner !== undefined) control.owner = owner;
  return control;
}

/** Parse and validate a controls.yaml document. Controls are returned sorted by ID. */
export function parseControls(yamlText: string): ControlsDoc {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (err) {
    throw new ControlsError(`controls map is not valid YAML: ${(err as Error).message}`);
  }
  const doc = asRecord(raw, '(document)');
  rejectUnknownKeys(doc, ['version', 'meta', 'defaults', 'controls'], '(document)');
  if (doc['version'] !== 1) fail('version', 'must be 1 (the only schema version so far)');

  const meta: Record<string, string> = {};
  if (doc['meta'] !== undefined) {
    const rawMeta = asRecord(doc['meta'], 'meta');
    for (const key of Object.keys(rawMeta).sort()) {
      const v = rawMeta[key];
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        fail(`meta.${key}`, 'must be a scalar');
      }
      meta[key] = String(v);
    }
  }

  const defaults = parseDefaults(doc['defaults']);
  const controlsRaw = asRecord(doc['controls'], 'controls');
  const ids = Object.keys(controlsRaw).sort();
  if (ids.length === 0) fail('controls', 'must declare at least one control');
  // Control IDs become file names (controls/<id>.md); case-insensitive filesystems
  // (NTFS, APFS) would silently merge IDs that differ only by case.
  const seenFolded = new Map<string, string>();
  for (const id of ids) {
    const folded = id.toLowerCase();
    const clash = seenFolded.get(folded);
    if (clash !== undefined) {
      fail(`controls.${id}`, `collides with "${clash}" when case is ignored — control IDs must be unique case-insensitively`);
    }
    seenFolded.set(folded, id);
  }
  const controls = ids.map((id) => parseControl(id, controlsRaw[id], defaults));

  return { version: 1, meta, defaults, controls };
}
