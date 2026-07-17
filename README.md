# test-evidence-packs

[![CI](https://github.com/qasimmahmood95/test-evidence-packs/actions/workflows/ci.yml/badge.svg)](https://github.com/qasimmahmood95/test-evidence-packs/actions/workflows/ci.yml)

A Playwright reporter + CLI that turns test runs into **audit-ready, tamper-evident
evidence packs** — for teams whose testing has to be *demonstrated*, not just done.

## The problem

In regulated environments (payments, health, finance, safety-critical software), an
audit question is rarely "do you have tests?". It's:

> Which controls were tested, **when**, against **which version** of the system, with
> **what results** — and how do I know this record wasn't edited afterwards?

Most QA teams answer that by hand: screenshots of CI dashboards, exported HTML reports,
spreadsheets mapping test names to control IDs, assembled in the week before the audit.
The mapping goes stale, the artifacts are scattered, and none of it is tamper-evident.

`test-evidence-packs` makes the evidence a **build artifact**. You declare your controls
once in `controls.yaml`, tag the tests that exercise them, and every test run can emit a
self-contained pack: per-control evidence documents, coverage gaps, a sha256 manifest of
everything, and an append-only ledger that chains each run to the one before it.

## Quickstart (from a clean clone)

```bash
pnpm install
pnpm demo          # build → run the bundled demo suite → generate the pack
```

That runs the tiny tagged suite in [demo/tests](demo/tests) against
[demo/controls.yaml](demo/controls.yaml) and writes a pack to
`demo/evidence/packs/<run-timestamp>_<commit>/`. Then check its integrity:

```bash
node dist/cli.js verify demo/evidence
# OK — 1 ledger entry, 1 pack(s) checked, 0 error(s), 0 warning(s)
```

### In your own project

Post-hoc over an existing JSON report (the primary integration — no test changes needed
beyond tagging):

```bash
npx playwright test --reporter=json > report.json   # or the json reporter's outputFile
tep generate --report report.json --controls controls.yaml --out evidence
tep verify evidence
```

Or live, as a Playwright reporter:

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['list'],
    ['test-evidence-packs/reporter', { controls: 'controls.yaml', outputDir: 'evidence' }],
  ],
});
```

Both paths produce the same pack shape from the same normalized run data.

## Pack anatomy

```
evidence/
├── ledger.jsonl                           # append-only; entry N hashes entry N-1
└── packs/
    └── 2026-07-17T14-03-22Z_a1b2c3d/      # <run-start-UTC>_<short-commit>
        ├── manifest.json                  # sha256 of every file below + run metadata,
        │                                  #   git commit/branch/tag/dirty, per-control
        │                                  #   summaries, gaps — the machine interface
        ├── EVIDENCE.md                    # run summary + control scoreboard — the human interface
        ├── controls/
        │   ├── TR-001.md                  # per-control: requirements met, tests run,
        │   └── …                          #   boundary cases exercised, failures, artifacts
        ├── GAPS.md                        # what's missing, in plain language
        ├── index.html                     # self-contained HTML index (no external assets)
        └── inputs/
            ├── controls.yaml              # verbatim copy of the map used
            └── report.json                # verbatim copy of the Playwright report
```

Here is a real `controls/TR-001.md` generated from the demo suite (excerpt):

> # TR-001 — Transfer amount limit is enforced at the boundary
>
> - **Status:** PASS
> - **Owner:** payments-qa
> - **References:** POL-7 §3.2 (transfer limits)
>
> ## Evidence requirements
>
> | Requirement | Expected | Observed | Met |
> | --- | --- | --- | --- |
> | Passing tests | ≥ 3 | 4 | yes |
> | Style: boundary | exercised by a passing test | 3 passing test(s) — cases: T+0.01=10000.01, T-0.01=9999.99, T=10000 | yes |
> | Style: negative | exercised by a passing test | 2 passing test(s) | yes |
>
> ## Tests
>
> | Test | Location | Project | Outcome | Duration | Retries |
> | --- | --- | --- | --- | --- | --- |
> | transfer limits › accepts a transfer exactly at the limit | `transfers.spec.ts:5` | — | passed | 13 ms | 0 |
> | transfer limits › rejects a transfer one cent above the limit | `transfers.spec.ts:29` | — | passed | 4 ms | 0 |
> | … | | | | | |

## The controls map

`controls.yaml` is the single source of truth linking control IDs to tests:

```yaml
version: 1

meta:                                  # free-form; copied into every pack
  system: demo-transfer-service

defaults:
  control_tag_prefix: "@control:"      # used to detect unmapped control tags
  style_tag_prefix: "@style:"
  match: all                           # a test must carry ALL of a control's tags (or: any)

controls:
  TR-001:
    title: Transfer amount limit is enforced at the boundary
    description: >
      Transfers at and below the configured limit are accepted; transfers
      above the limit and non-positive amounts are rejected.
    tags: ["@compliance", "@control:TR-001"]   # tags a test must carry
    annotations:                               # AND annotations it must carry (optional)
      - type: rule                             #   matches { type: 'rule',
        value: TR-001                          #             description: 'TR-001' }
    evidence:
      styles: [boundary, negative]             # assertion styles expected (see below)
      min_tests: 3                             # gap if fewer passing tests
    owner: payments-qa
    references: ["POL-7 §3.2 (transfer limits)"]
```

A test evidences a control when it matches the control's `tags` (per `match`) **and**
all of its `annotations` matchers. Declare either or both.

### Assertion styles

Styles state *how* a control is expected to be tested — `boundary`, `negative`,
`lifecycle` are the canonical three. A declared style counts as exercised when a
**passing** test carries the style tag (`@style:boundary`) or an annotation whose type
is the style name:

```ts
test('accepts a transfer exactly at the limit', {
  tag: ['@compliance', '@control:TR-001'],
  annotation: [{ type: 'boundary', description: 'T=10000' }],
}, () => { /* … */ });
```

Annotation descriptions surface in the evidence as the concrete **cases exercised**
(`T-0.01=9999.99, T=10000, T+0.01=10000.01`) — exactly the "did you test the boundary
or just a happy-path example?" question auditors ask. Styles are declared expectations
checked against explicit test markers; nothing is inferred from assertion code.

### Gap detection

Every pack reports, bidirectionally:

- **Controls with no passing evidence** — declared but not demonstrated in this run
- **Controls below `min_tests`** — evidenced by fewer passing tests than required
- **Declared styles not exercised** — e.g. `boundary` promised, only happy paths ran
- **Unmapped control tags** — `@control:*` tags in the run that match no declared
  control (typos, or tests ahead of the map)

The demo intentionally ships one uncovered control (`DB-004`) and one unmapped tag
(`@control:AC-999`) so a generated `GAPS.md` shows both. In CI, `--fail-on-gaps`
(exit 2) and `--fail-on-failures` (exit 1) turn these into gates.

## Determinism and tamper evidence

**Same inputs → byte-identical pack.** All JSON is serialized with recursively sorted
keys; every timestamp comes from the run's own metadata (never the wall clock); test
ordering is fixed; the pack ID derives from run start + commit. Two runs over the same
report and controls map produce identical bytes — packs diff cleanly, and regenerating
a pack is idempotent (the ledger doesn't grow). This is enforced by tests, including a
golden-file snapshot of a full pack.

**The manifest seals the pack.** `manifest.json` records the sha256 of every other file
in the pack, including the verbatim input copies. Change one byte of the evidence and
`tep verify` reports exactly which file was altered.

**The ledger seals history — up to its head.** `ledger.jsonl` appends one canonical-JSON
line per pack: `{seq, packId, manifestSha256, prevSha256, runStartTime}` where
`prevSha256` is the sha256 of the previous line (64 zeros for the first). Editing,
deleting, or reordering any *interior* entry breaks the chain, and the tool refuses to
append to a broken chain.

What a bare hash chain **cannot** self-detect is *tail truncation*: deleting the newest
entries (and their pack directories) leaves a shorter but internally valid chain. That's
why every `generate` and `verify` prints the **ledger head** — the sha256 of the last
line. Record it somewhere outside the evidence directory (your CI log does this for free;
a signed git tag is stronger) and check it later:

```bash
tep verify evidence --head <sha256-recorded-at-generation-time>
```

A truncated ledger no longer matches the anchored head, so removal of the newest runs
becomes detectable too. This is integrity by hashing, not authenticity by signature —
see [Limitations](#limitations).

## What auditors actually ask for

Generic framing of the questions this tool is built to answer:

| Auditor question | Where it's answered |
| --- | --- |
| Which controls were tested in this release? | `EVIDENCE.md` scoreboard, `manifest.json.controls` |
| Against which version of the system? | `git` block: commit, branch, tag, dirty flag |
| When, and with what results? | Run metadata + per-control test tables |
| Were negative/boundary cases covered, or only happy paths? | Style requirements + recorded cases per control |
| What was *not* covered? | `GAPS.md` — stated, not discovered by the auditor |
| How do I know this record is complete and unaltered? | Manifest hashes + ledger chain, `tep verify` |
| Can you show me the raw underlying data? | `inputs/` verbatim copies, artifact hashes |

## Worked example: VaultChain's @compliance suite

[VaultChain](https://github.com/qasimmahmood95/vaultchain) is a demo bank with a real
compliance gate: nine `@compliance`-tagged Playwright tests encoding four rules
(Travel Rule boundary, dual approval, segregation of duties, audit-log completeness).
Its tests identify the rule under test with an annotation —
`{ type: 'rule', description: 'MC-DUAL-APPROVAL' }` — and mark boundary cases as
`{ type: 'boundary', description: 'T=1000.00' }`. That convention maps directly onto
this tool's annotation matchers; the ready-made controls map is
[examples/vaultchain.controls.yaml](examples/vaultchain.controls.yaml).

From a VaultChain checkout (after its own setup — it drives a running app):

```bash
PLAYWRIGHT_JSON_OUTPUT_NAME=compliance-report.json \
  npx playwright test --grep "@compliance" --reporter=json

tep generate \
  --report compliance-report.json \
  --controls path/to/examples/vaultchain.controls.yaml \
  --out compliance-evidence
```

The resulting pack shows each rule's status with the exact boundary values exercised
(`T-1=999.99, T=1000.00, T+1=1000.01`) — evidence that the Travel Rule threshold was
asserted *at* the boundary, not near it.

## CLI reference

```
tep generate  -r <report.json> -c <controls.yaml> [-o <dir>]
              [--git-commit <sha>] [--git-branch <name>] [--git-tag <name>] [--no-git]
              [--fail-on-gaps] [--fail-on-failures]
tep verify    <evidence-dir> [--head <sha256>]
```

Git metadata is auto-detected from the working directory; overrides exist for CI
setups where the checkout isn't the repo under test. `generate` refuses to run against
a broken ledger and refuses to overwrite an existing pack whose content differs
(regenerating an identical pack is idempotent). `verify` checks the ledger chain, every
pack's file hashes, the pack↔ledger linkage, and — given `--head` — that no entries
were removed from the tail; exit code 1 on any error. Files planted inside a pack after
generation are errors, not warnings.

## Engineering notes

- TypeScript strict, ESM, no runtime dependencies beyond `commander` and `yaml`
- The CLI parser and the live reporter feed one shared, normalized run model — packs
  from either path have the same shape
- Tests cover manifest hashing, gap detection, ledger tampering (edit / delete /
  broken-chain append), and full-pack determinism via a byte-for-byte golden snapshot
  ([tests/golden](tests/golden), regenerated with `pnpm golden:update`)
- CI runs lint, typecheck, unit tests, then generates and verifies the demo pack and
  uploads it as a workflow artifact — you can download a real pack from any CI run

## Limitations

Honest scope, because evidence tooling that oversells itself defeats its purpose:

- **This evidences testing; it does not certify compliance.** A pack shows which
  declared controls had passing tests in a run. Whether those controls are the right
  ones, and whether the tests genuinely encode them, remains human judgment.
- **Hash-chained, not signed.** The chain makes alteration of *interior* history
  detectable, but **tail truncation** (deleting the newest entries plus their packs) and
  full consistent rewrites are only detectable against an externally recorded ledger
  head (`verify --head`) or a signature. Anchor the head outside the evidence directory
  — CI logs, a signed tag — or sign `manifest.json` (GPG, Sigstore); the format leaves
  room for that layer.
- **Tag discipline is load-bearing.** A mis-tagged test evidences the wrong control.
  Unmapped-tag detection catches typos in one direction; review still matters.
- **Trace/screenshot artifacts are referenced and hashed, not embedded.** Keep them
  (or don't) per your retention policy; the hashes stay valid either way. Corollary:
  an artifact's hash is only recorded if the file is present at pack time, so "same
  inputs" for byte-identical packs includes the artifact files on disk.
- **One run per pack.** Cross-run aggregation ("was TR-001 evidenced every release
  this quarter?") is deliberately left to tooling over the ledger + manifests.

## License

[MIT](LICENSE) © Qasim Mahmood
