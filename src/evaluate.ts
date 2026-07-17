import { compareTests } from './normalize.js';
import type {
  ControlDef,
  ControlResult,
  ControlsDoc,
  Evaluation,
  Gap,
  NormalizedRun,
  NormalizedTest,
  StyleEvidence,
} from './types.js';

function testMatchesControl(control: ControlDef, test: NormalizedTest): boolean {
  if (control.tags.length > 0) {
    const has = (tag: string): boolean => test.tags.includes(tag);
    const tagsOk = control.match === 'all' ? control.tags.every(has) : control.tags.some(has);
    if (!tagsOk) return false;
  }
  for (const matcher of control.annotations) {
    const found = test.annotations.some(
      (a) => a.type === matcher.type && (matcher.value === undefined || a.description === matcher.value),
    );
    if (!found) return false;
  }
  return true;
}

function isPassing(test: NormalizedTest): boolean {
  return test.outcome === 'passed' || test.outcome === 'flaky';
}

/**
 * Styles exercised by passing tests: via style tags (any style), and via
 * annotations whose type is one of the control's declared styles — annotation
 * descriptions become the recorded "cases" (e.g. boundary values).
 */
function stylesExercisedFor(
  control: ControlDef,
  styleTagPrefix: string,
  passingTests: NormalizedTest[],
): StyleEvidence[] {
  const byStyle = new Map<string, { testIds: Set<string>; cases: Set<string> }>();
  const ensure = (style: string): { testIds: Set<string>; cases: Set<string> } => {
    let entry = byStyle.get(style);
    if (!entry) {
      entry = { testIds: new Set(), cases: new Set() };
      byStyle.set(style, entry);
    }
    return entry;
  };
  for (const test of passingTests) {
    for (const tag of test.tags) {
      if (tag.startsWith(styleTagPrefix) && tag.length > styleTagPrefix.length) {
        ensure(tag.slice(styleTagPrefix.length)).testIds.add(test.id);
      }
    }
    for (const ann of test.annotations) {
      if (control.evidence.styles.includes(ann.type)) {
        const entry = ensure(ann.type);
        entry.testIds.add(test.id);
        if (ann.description) entry.cases.add(ann.description);
      }
    }
  }
  return [...byStyle.keys()].sort().map((style) => {
    const entry = byStyle.get(style)!;
    return { style, testIds: [...entry.testIds].sort(), cases: [...entry.cases].sort() };
  });
}

/** Match every control against the run, compute per-control status and all coverage gaps. */
export function evaluateRun(doc: ControlsDoc, run: NormalizedRun): Evaluation {
  const gaps: Gap[] = [];

  const results: ControlResult[] = doc.controls.map((control) => {
    const tests = run.tests.filter((t) => testMatchesControl(control, t)).sort(compareTests);
    const passed = tests.filter((t) => t.outcome === 'passed').length;
    const failed = tests.filter((t) => t.outcome === 'failed').length;
    const skipped = tests.filter((t) => t.outcome === 'skipped').length;
    const flaky = tests.filter((t) => t.outcome === 'flaky').length;
    const passingTests = tests.filter(isPassing);
    const stylesExercised = stylesExercisedFor(control, doc.defaults.styleTagPrefix, passingTests);

    const controlGaps: Gap[] = [];
    if (passingTests.length === 0) {
      controlGaps.push({ kind: 'no-passing-evidence', controlId: control.id });
    } else {
      if (passingTests.length < control.evidence.minTests) {
        controlGaps.push({
          kind: 'insufficient-tests',
          controlId: control.id,
          required: control.evidence.minTests,
          passing: passingTests.length,
        });
      }
      for (const style of control.evidence.styles) {
        if (!stylesExercised.some((s) => s.style === style)) {
          controlGaps.push({ kind: 'missing-style', controlId: control.id, style });
        }
      }
    }
    gaps.push(...controlGaps);

    const status = failed > 0 ? 'failed' : controlGaps.length > 0 ? 'gap' : 'passed';
    return { control, tests, passed, failed, skipped, flaky, stylesExercised, status };
  });

  // Control tags that map to no declared control — typos or missing map entries.
  const knownControlTags = new Set(doc.controls.flatMap((c) => c.tags));
  const prefix = doc.defaults.controlTagPrefix;
  const unknown = new Map<string, Set<string>>();
  for (const test of run.tests) {
    for (const tag of test.tags) {
      if (tag.startsWith(prefix) && !knownControlTags.has(tag)) {
        const set = unknown.get(tag) ?? new Set<string>();
        set.add(`${test.title} (${test.file}:${test.line})`);
        unknown.set(tag, set);
      }
    }
  }
  for (const tag of [...unknown.keys()].sort()) {
    gaps.push({ kind: 'unknown-control-tag', tag, tests: [...unknown.get(tag)!].sort() });
  }

  return { results, gaps };
}

export function describeGap(gap: Gap): string {
  switch (gap.kind) {
    case 'no-passing-evidence':
      return `${gap.controlId}: no passing tests evidence this control`;
    case 'insufficient-tests':
      return `${gap.controlId}: ${gap.passing} passing test(s), ${gap.required} required`;
    case 'missing-style':
      return `${gap.controlId}: declared style "${gap.style}" has no passing evidence`;
    case 'unknown-control-tag':
      return `${gap.tag}: tag matches no declared control (typo, or missing controls.yaml entry?)`;
  }
}
