// ---------------------------------------------------------------------------
// Controls map (controls.yaml)
// ---------------------------------------------------------------------------

export type MatchMode = 'all' | 'any';

export interface ControlDefaults {
  /** Tag prefix that marks a control ID on a test, e.g. "@control:". */
  controlTagPrefix: string;
  /** Tag prefix that marks an assertion style on a test, e.g. "@style:". */
  styleTagPrefix: string;
  /** Whether a test must carry all of a control's tags, or any of them. */
  match: MatchMode;
}

/** Matches a Playwright annotation: `type` must match; `value` (if given) must equal the annotation description. */
export interface AnnotationMatcher {
  type: string;
  value?: string;
}

export interface EvidenceRequirements {
  /** Assertion styles this control expects (canonically: boundary, negative, lifecycle). */
  styles: string[];
  /** Minimum number of passing tests required to consider the control evidenced. */
  minTests: number;
}

export interface ControlDef {
  id: string;
  title: string;
  description?: string;
  /** Tags a test must carry (per `match`) to evidence this control. */
  tags: string[];
  /** Annotations a test must carry (all of them) to evidence this control. */
  annotations: AnnotationMatcher[];
  match: MatchMode;
  evidence: EvidenceRequirements;
  owner?: string;
  references: string[];
}

export interface ControlsDoc {
  version: number;
  /** Free-form metadata copied into every pack (system, framework, owner, ...). */
  meta: Record<string, string>;
  defaults: ControlDefaults;
  /** Sorted by control ID. */
  controls: ControlDef[];
}

// ---------------------------------------------------------------------------
// Normalized test run (shared shape between the CLI's JSON-report parser and
// the live Playwright reporter)
// ---------------------------------------------------------------------------

export type TestOutcome = 'passed' | 'failed' | 'skipped' | 'flaky';

export interface NormalizedAttachment {
  name: string;
  contentType: string;
  path?: string;
  /** sha256 of the attachment file, when it exists on disk at pack time. */
  sha256?: string;
}

export interface NormalizedAnnotation {
  type: string;
  description?: string;
}

export interface NormalizedTest {
  /** Stable short hash of (file, line, project, title). */
  id: string;
  /** Describe-path + title, joined with " › " (excludes file and project). */
  title: string;
  /** Path relative to the Playwright root, posix separators. */
  file: string;
  line: number;
  projectName: string;
  /** Normalized (leading "@"), deduplicated, sorted. */
  tags: string[];
  annotations: NormalizedAnnotation[];
  outcome: TestOutcome;
  durationMs: number;
  /** Number of retry attempts recorded beyond the first run. */
  retries: number;
  /** First line of each error message from the final attempt (ANSI stripped). */
  errors: string[];
  attachments: NormalizedAttachment[];
}

export interface NormalizedRun {
  /** ISO-8601 UTC start time, taken from run metadata — never from the wall clock. */
  startTime: string;
  durationMs: number;
  playwrightVersion?: string;
  /** Sorted by file, line, title, project. */
  tests: NormalizedTest[];
}

// ---------------------------------------------------------------------------
// Git metadata
// ---------------------------------------------------------------------------

export interface GitMeta {
  commit: string;
  branch?: string;
  tag?: string;
  /** True when the working tree had uncommitted changes at pack time. */
  dirty?: boolean;
}

// ---------------------------------------------------------------------------
// Evaluation: controls × run
// ---------------------------------------------------------------------------

export type ControlStatus = 'passed' | 'failed' | 'gap';

export interface StyleEvidence {
  style: string;
  /** IDs of passing tests exercising the style. */
  testIds: string[];
  /** Annotation descriptions for this style (e.g. boundary values exercised). */
  cases: string[];
}

export interface ControlResult {
  control: ControlDef;
  /** All tests matched to this control, sorted. */
  tests: NormalizedTest[];
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  /** Styles with at least one passing test, with detail. */
  stylesExercised: StyleEvidence[];
  status: ControlStatus;
}

export type Gap =
  | { kind: 'no-passing-evidence'; controlId: string }
  | { kind: 'missing-style'; controlId: string; style: string }
  | { kind: 'insufficient-tests'; controlId: string; required: number; passing: number }
  | { kind: 'unknown-control-tag'; tag: string; tests: string[] };

export interface Evaluation {
  results: ControlResult[];
  gaps: Gap[];
}

// ---------------------------------------------------------------------------
// Manifest & ledger
// ---------------------------------------------------------------------------

export interface ManifestControlSummary {
  title: string;
  status: ControlStatus;
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  stylesDeclared: string[];
  stylesExercised: string[];
}

export interface Manifest {
  schemaVersion: 1;
  generator: { name: string; version: string };
  packId: string;
  run: {
    startTime: string;
    durationMs: number;
    playwrightVersion?: string;
    tests: { total: number; passed: number; failed: number; skipped: number; flaky: number };
  };
  git: GitMeta | null;
  controls: Record<string, ManifestControlSummary>;
  gaps: Gap[];
  summary: {
    controls: number;
    passed: number;
    failed: number;
    gapControls: number;
    gaps: number;
  };
  /** sha256 of every file in the pack (posix-relative path → hex digest), except manifest.json itself. */
  files: Record<string, string>;
}

export interface LedgerEntry {
  seq: number;
  packId: string;
  /** sha256 of the pack's manifest.json bytes. */
  manifestSha256: string;
  /** sha256 of the previous ledger line's bytes; 64 zeros for the first entry. */
  prevSha256: string;
  runStartTime: string;
}
