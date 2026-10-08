# TraceBrief

Evidence-first reverse-engineering reports.

TraceBrief turns a [REA](https://github.com/morluto/rea) investigation into a
Markdown report another developer can read, reproduce and check — where every
technical conclusion points at a real REA Evidence record, observations are
separated from inferences, and unresolved questions stay visible.

It does not analyse anything. REA produces evidence; TraceBrief organises it
and refuses to publish a claim the evidence cannot support.

```
REA investigation ──export_evidence_bundle──▶ bundle.json
                                               │
        agent authors claims (report.json) ────┤
                                               ▼
                        validate ──fail──▶ actionable errors, no file
                           │
                          pass
                           ▼
                     reports/<name>.md
```

The split matters: an agent writes *claims*, a deterministic script checks the
citations and renders the document. A prompt alone cannot verify that
`ev_3f9c…` exists or that a runtime claim is not resting on static evidence.

## Requirements

- Node.js 22.19+ (tested on 24.21)
- A REA MCP registration for the agent doing the authoring — for example
  `npx rea-agents@latest setup --client opencode`

TraceBrief itself has **zero dependencies**.

## Install

```bash
git clone <this repo> tracebrief
cd tracebrief
npm test
```

Use it as an OpenCode project command: `.opencode/commands/tracebrief.md`
becomes `/tracebrief`. Copy it to `~/.config/opencode/commands/` to use it
globally.

## Usage

```bash
node bin/tracebrief.mjs validate --report report.json --bundle bundle.json [--json]
node bin/tracebrief.mjs render   --report report.json --bundle bundle.json [--out report.md]
node bin/tracebrief.mjs index    --bundle bundle.json [--json]
```

Exit codes: `0` clean (warnings allowed), `1` validation errors, `2` usage or
I/O failure. `render` refuses to write a report that failed validation unless
`--allow-invalid` is passed, so an unsupported claim cannot reach a file.

Try it against the committed real bundle:

```bash
npm run validate:sample
npm run render:sample
```

## Report schema

`report.json`, schema tag `tracebrief/report@1`:

| Field | Meaning |
| --- | --- |
| `title`, `question` | What was investigated |
| `target` | `name`, `version`, `artifact_digest`, `format`, `architecture`, `local_path`; use `null` for anything unknown |
| `reproduction.environment` | Host, runtime, and any missing prerequisites |
| `reproduction.tool_versions` | `{ name, version, evidence_ids }` |
| `reproduction.commands` | `{ command, purpose, evidence_ids }` |
| `findings[]`, `relationships[]` | Claims |
| `open_questions[]` | `{ id, question, status, evidence_ids, unknown_id? }` |
| `summary` | `{ established: [claim ids], not_established: [strings] }` |

A claim:

```json
{
  "id": "f-ipc-channels-paired",
  "statement": "REA recorded three literal IPC channels and paired all three renderer transmissions with a main-process handler.",
  "kind": "derived",
  "claim_type": "structure",
  "evidence_ids": ["ev_b318dce1e595a404df70e1f22c8d16d8e1216f409f20aeeacf6ecc3bb4220779"],
  "limitations": ["Electron relationships are derived from inert syntax; runtime registration, reachability, defaults, and enforcement remain unproven."]
}
```

`kind` is `observed` | `derived` | `inferred` | `unknown`, mirroring REA's
own confidence vocabulary. `claim_type` is what the claim asserts:

| `claim_type` | Allowed when |
| --- | --- |
| `structure` | Describes the artifact's static shape |
| `behavior` | Describes what code does, with at least one observed or derived record cited |
| `runtime-behavior` | Cites a record with authority `controlled-replay` or `external-service` |
| `source-equivalence` | Cites a `historical-reference` record (an imported historical source tree) |
| `analysis-coverage` | States what the analysis did or could not establish; exempt from the observed-basis rule |

## Integrity rules

Errors block rendering. Warnings inform.

| Code | Level | Rejects |
| --- | --- | --- |
| `evidence_not_in_bundle` | error | A citation that is not in the bundle — the fabrication case |
| `evidence_id_malformed` | error | An id that is not `ev_<64 hex>` |
| `claim_without_evidence` | error | A non-unknown claim citing nothing |
| `evidence_subject_mismatch` | error | Evidence about a different artifact than the reported target |
| `runtime_claim_without_runtime_authority` | error | Runtime behavior asserted from static-only authority |
| `source_equivalence_without_historical_source` | error | "This is the original source" with no historical source record |
| `claim_requires_observed_basis` | error | Structure or behavior resting only on `inferred` records |
| `residual_unknown_not_carried` | error | A bundle unknown missing from `open_questions` |
| `target_not_in_bundle` | error | A target digest absent from `bundle.artifacts` |
| `summary_establishes_unknown` | error | A summary claiming a claim that is marked unknown |
| `summary_claim_unknown` | error | A summary citing a claim id that does not exist |
| `evidence_subject_unavailable` | warning | Cited records carry no subject, so the digest link rests on `evidence_links` alone |
| `claim_limitations_not_carried` | warning | Cited limitations are not acknowledged on the claim |
| `evidence_link_unresolved` | warning | A cited record links to evidence outside the bundle |
| `command_unverified`, `tool_version_unverified` | warning | Reproduction steps asserted without a citation |

## What is verified, and what is not

Verified by the test suite (67 tests, `node --test`):

- fabricated, malformed and missing citations are rejected
- evidence from the wrong artifact is rejected
- runtime claims require runtime authority; source-equivalence requires a
  historical source
- inference-only support for a structural claim is rejected
- residual unknowns cannot be silently dropped
- rendering is deterministic and never inlines `raw_result`
- table cells, pipes and empty sections are handled correctly
- the CLI refuses to write an invalid report, and `exit 2` covers usage/IO errors

**Not verified, by design:** TraceBrief can prove a citation exists. It cannot
prove a sentence reads the cited bytes correctly. Prose that misinterprets
evidence still passes. The README, the rules and the report all state this
rather than implying the tool can catch semantic errors.

## Sample

`reports/clipnote-search.md` is generated from real REA output:

- target: `fixtures/clipnote`, a small Electron fixture application
- evidence: `fixtures/clipnote-bundle.json`, exported from a live REA 6.0.0
  session (3 records: `analyze_javascript_application`,
  `trace_application_feature`, `trace_javascript_semantics`)
- claims: `fixtures/report.clipnote.json`

The sample validates with 0 errors and 3 honest warnings, including one that
says the TraceBrief render command itself is not backed by REA evidence. It
also demonstrates the tool working against its author: two of the drafted
claims were rejected as unsupported assertions about the app until they were
reclassified as `analysis-coverage`, which is what they actually were.

Environment note: this sample is static JavaScript analysis only. Hopper is
macOS/Linux, and no Ghidra or IDA installation was configured, so the report
makes no native claim.

## Limitations

- Evidence ids are content digests. A committed report can only be re-validated
  against the bundle that produced it; the report records the bundle digest so
  a mismatch is detectable.
- Bundles can be large (this sample is 2.3 MB) and contain `raw_result`
  payloads. Commit them only if they are safe to publish; TraceBrief never
  copies them into the report.
- Reports are authored by an LLM, so wording quality is unverified. Only
  citations and assertion classes are machine-checked.
- Native sections are untested against a real provider on this host.

## Roadmap

1. `/tracebrief` command plus validator (current).
2. A `tracebrief` custom tool for OpenCode (`.opencode/tools/`) so report
   validation happens inside the tool call instead of as a separate step.
3. Upstream discussion with the REA maintainers. REA owns canonical Evidence
   serialization, so a bundle-to-Markdown renderer arguably belongs in REA
   itself; the claim model and integrity rules are the part specific to agent
   workflows.

## Layout

```
.opencode/commands/tracebrief.md   /tracebrief command
bin/tracebrief.mjs                 CLI: validate | render | index
src/bundle.mjs                     Evidence bundle reading and structural checks
src/report.mjs                     report.json schema validation
src/rules.mjs                      evidence integrity rules
src/render-markdown.mjs            deterministic Markdown renderer
test/                              node:test suite
fixtures/clipnote/                 Electron fixture application
fixtures/clipnote-bundle.json      real REA evidence export
fixtures/report.clipnote.json      authored claims for the sample
reports/                           generated reports
```

## Licence

MIT