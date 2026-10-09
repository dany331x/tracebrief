# TraceBrief — proposal for upstream REA integration

This is a draft issue for [`morluto/rea`](https://github.com/morluto/rea/issues),
written before any pull request. REA's `CONTRIBUTING.md` asks contributors to
"open an issue before a large contract or architecture change so its scope can
be agreed before implementation", and this is unambiguously a large change.
So: no PR until the scope is agreed.

## What TraceBrief is

A standalone, zero-dependency Node CLI that turns a finished REA investigation
into a Markdown report another developer can read, reproduce and check.

```
REA investigation -> export_evidence_bundle -> bundle.json
                       |
        agent authors claims (report.json)
                       |
              validate -> fail -> actionable errors, no file
                       | pass
                reports/<name>.md
```

The design point is the split. An agent writes *claims*; a deterministic script
verifies the citations and renders the document. A prompt alone cannot verify
that an `ev_<64 hex>` id exists, that a runtime claim is not resting on static
evidence, or that every residual unknown in the bundle is carried into the
report as an open question.

TraceBrief does not analyse anything and calls no REA tools. It consumes the
JSON that `export_evidence_bundle` already produces.

## Why it is not a drop-in patch

TraceBrief as written does not satisfy REA's contribution gates, and pretending
otherwise would waste a reviewer's time:

| REA expects | TraceBrief today |
| --- | --- |
| TypeScript across `src/` | plain `.mjs` modules |
| `vitest` | `node --test` |
| `oxlint` / `oxfmt` | not formatted for either |
| `knip` clean | would flag unused exports |
| `jscpd` duplication gate | not measured |
| layered domain/contracts/provider/application/server/adapter | a flat 4-module pipeline |
| `npm run verify:test-discovery`, `metadata:generate` | n/a |

Porting is straightforward but real: roughly 2,165 lines of tests would become
vitest specs, and the modules would need to sit inside REA's layering. That is
maintenance surface, so it needs agreement before anyone writes it.

## Three integration shapes, cheapest first

1. **Documentation pointer.** A page in `docs/` describing the
   investigation-to-report workflow and linking to TraceBrief as an external
   tool. Smallest diff, no maintenance burden, and consistent with the existing
   workflow guides in `docs/` (see `reconstruction-obligation-ledgers.md` and
   `reconstruction-readiness.md`, which are adjacent in spirit).

2. **A managed skill in `skill-src/`.** REA already ships managed skills, and
   the `/tracebrief` command is essentially a workflow guide plus a validator
   invocation. This reuses REA's existing distribution mechanism and needs a
   `metadata:generate` bump.

3. **First-party tool.** Port TraceBrief into `src/` as a supported command with
   full REA toolchain conformance. Largest benefit, largest ongoing cost, and it
   puts a second opinion about report structure inside the same repository.

## What has actually been verified

TraceBrief's own suite, on this host, against real REA 6.0.0 output:

- **179 tests, 0 failures**, `node --test`, no dependencies, no `node_modules`.
- **25/25 mutations caught by the intended test.** `npm run test:mutations`
  reverts each fix in turn and asserts a named test fails. The harness runs a
  baseline control first and exits 2 if the baseline does not pass, because an
  earlier version of that harness reported a false 20/20.
- **Three sample reports built from live REA exports**, not synthetic fixtures:
  an Electron feature trace, real residual unknowns created through REA's own
  `record_unknown` / `update_unknown` bookkeeping, and a genuinely managed
  `System.Data.dll` (34 metadata tables, 9 assembly references, three mixed
  `file-offset` locations).
- **`/tracebrief` exercised through OpenCode itself.** `opencode run
  "/tracebrief"` in an empty directory resolved the installed command and the
  agent followed it, including refusing to invent `ev_` ids when the session had
  zero records.

Working against real bundles found a genuine TraceBrief bug worth mentioning
here: REA exports retain unknown *revision history*, so a single `unk_` id
appears once as `open` and later as `resolved` in the same bundle. Any consumer
that treats "unknown with this id exists" as "this unknown is unresolved" will
mis-report. `residualUnknownHeads()` reduces the history to one head per id.

## What has not been verified

Stated plainly, because REA asks contributors to "be clear about anything you
couldn't test":

- **Native decompilation was never exercised.** Hopper is macOS/Linux only, and
  Ghidra/IDA need a JDK that is not installed on the verification host.
  TraceBrief consumes their output, but no native-decompiler record has passed
  through the validator.
- No EVM bytecode, firmware, Android (no JDK), pwntools ELF/core-dump, or live
  process-capture targets.
- Windows-only host: no macOS or Linux verification.

## Question

Which of the three shapes, if any, is worth carrying? If the answer is
"none, ship it standalone and link it", that is a fine outcome and costs the
project nothing.