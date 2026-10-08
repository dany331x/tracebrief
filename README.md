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

- Node.js 22.19+ (developed and tested on 24.21)
- A REA MCP registration for the agent doing the authoring — for example
  `npx rea-agents@latest setup --client opencode`

TraceBrief itself has **zero dependencies** (no `dependencies` or
`devDependencies`; nothing to install).

## Install

```bash
git clone <this repo> tracebrief
cd tracebrief
npm test
```

Use it as an OpenCode command:

```bash
npm run install:command     # installs /tracebrief globally
npm run uninstall:command
```

OpenCode discovers commands from `.opencode/commands/` in the project you are
working in, or `~/.config/opencode/commands/` for global use. TraceBrief is
normally used somewhere *other* than its own repository — in the project
holding the target you are investigating — and the repo copy of the command
invokes `node bin/tracebrief.mjs`, which only resolves inside this repository.
The installer therefore rewrites that one invocation to an absolute path and
copies the file to `~/.config/opencode/commands/tracebrief.md`. It refuses to
overwrite an existing install unless you pass `--force`, is idempotent, and
refuses to guess if the command file no longer contains the invocation it
expects. Restart OpenCode afterwards.

```bash
node scripts/install-command.mjs --target <dir>   # install elsewhere
node scripts/install-command.mjs --uninstall
```

The repository copy at `.opencode/commands/tracebrief.md` also works as-is when
your cwd is this project.

## Usage

```bash
node bin/tracebrief.mjs validate --report report.json --bundle bundle.json [--json]
node bin/tracebrief.mjs render   --report report.json --bundle bundle.json [--out report.md] [--allow-invalid]
node bin/tracebrief.mjs index    --bundle bundle.json [--json]
node bin/tracebrief.mjs --help
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Clean. Warnings may still have been printed. |
| `1` | Validation errors. `render` wrote nothing unless `--allow-invalid`. |
| `2` | Usage or I/O failure: missing/unreadable/invalid-JSON report **or** bundle, unknown command, unknown or malformed flag. |

Unknown flags, single-dash typos (`-v`), stray positional arguments and flags
used with the wrong subcommand are rejected rather than ignored, so a typo
cannot silently change what runs — or make a render write no file and still
exit 0.

Try it against the committed real bundle:

```bash
npm run validate:sample
npm run render:sample
```

## Report schema

`report.json`, schema tag `tracebrief/report@1`. All nine keys are required.

| Field | Type | Notes |
| --- | --- | --- |
| `title`, `question` | non-empty string | Free prose; newlines are flattened on render |
| `target.name` | non-empty string | **Not** nullable |
| `target.version`, `target.format`, `target.architecture`, `target.local_path` | string or `null` | `null` renders as *unknown — not collected* |
| `target.artifact_digest` | sha256 hex or `null` | Omitting it disables cross-artifact verification and warns |
| `bundle_digest` | sha256 hex, or omitted | **Optional.** Pins the report to one exact bundle; a mismatch is an error. An explicit `null` is rejected, because it would look pinned while verifying nothing |
| `reproduction.environment` | array of strings | Use `[]` for *not collected*; `null` is rejected |
| `reproduction.tool_versions[]` | `{ name, version?, evidence_ids }` | `name` and `evidence_ids` required; `version` must be a string if present |
| `reproduction.commands[]` | `{ command, purpose?, evidence_ids }` | `command` and `evidence_ids` required; `purpose` must be a string if present |
| `findings[]`, `relationships[]` | claims | May be empty arrays |
| `open_questions[]` | `{ id, question, status, evidence_ids, unknown_id? }` | `status` is one of `open`, `investigating`, `blocked`, `contradicted`. `evidence_ids` is required and may be `[]` |
| `summary.established` | array of claim ids | Each must exist in `findings` or `relationships` |
| `summary.not_established` | array of non-empty strings | |

`evidence_ids` is **always required**, including on a `kind: "unknown"` claim,
where it is simply `[]`.

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

`kind` is `observed` | `derived` | `inferred`, mirroring REA's own confidence
vocabulary, plus `unknown` for a gap that was deliberately left open.

`claim_type` is what the claim asserts, and drives the integrity rules:

| `claim_type` | Allowed when |
| --- | --- |
| `structure` | Describes the artifact's static shape, with at least one `observed` or `derived` record cited |
| `behavior` | Describes what code does, with at least one `observed` or `derived` record cited |
| `runtime-behavior` | Cites a record with authority `controlled-replay` or `external-service` |
| `source-equivalence` | Cites a `historical-reference` record (an imported historical source tree) |
| `analysis-coverage` | States what the analysis did or could not establish; exempt from the observed-basis rule, since reporting an evidence gap is a legitimate result |

## Evidence integrity rules

Errors block rendering. Warnings inform. These are the rules in
`src/rules.mjs`:

| Code | Level | Rejects |
| --- | --- | --- |
| `evidence_not_in_bundle` | error | A citation that is not in the bundle — the fabrication case |
| `evidence_subject_mismatch` | error | Evidence about a different artifact than the reported target |
| `claim_without_evidence` | error | A non-`unknown` claim citing nothing |
| `claim_requires_observed_basis` | error | `structure`/`behavior` resting only on `inferred` records |
| `runtime_claim_without_runtime_authority` | error | Runtime behavior asserted from static-only authority |
| `source_equivalence_without_historical_source` | error | "This is the original source" with no historical source record |
| `residual_unknown_not_carried` | error | A bundle unknown missing from `open_questions` |
| `target_not_in_bundle` | error | A target digest absent from `bundle.artifacts` |
| `summary_establishes_unknown` | error | A summary claiming a claim that is marked `unknown` |
| `bundle_digest_mismatch` | error | A pinned `bundle_digest` that is not the supplied bundle |
| `target_digest_missing` | warning | No target digest, so cross-artifact verification is off. Warned unconditionally, including when the bundle lists no artifacts |
| `evidence_subject_unavailable` | warning | Cited records carry no subject, so the digest link rests on `evidence_links` alone |
| `claim_limitations_not_carried` | warning | The claim quotes **none** of the limitations its cited records carry |
| `evidence_link_unresolved` | warning | A cited record links to evidence outside the bundle |
| `command_unverified` | warning | A reproduction command asserted without a citation |
| `tool_version_unverified` | warning | A tool version asserted without a citation |
| `bundle_digest_unverified` | warning | A pinned digest with no bundle file to compare against |

Document and bundle checks are separate, structural passes:

- **Report schema** (`src/report.mjs`): `report_not_object`,
  `report_key_missing`, `report_key_unknown`, `report_schema_mismatch`,
  `text_missing`, `target_invalid`, `target_field_invalid`,
  `target_digest_malformed`, `report_bundle_digest_malformed`,
  `report_section_invalid`, `claim_invalid`, `claim_id_duplicated`,
  `claim_kind_invalid`, `claim_type_invalid`, `claim_limitations_invalid`,
  `claim_limitation_empty`, `evidence_ids_missing`, `evidence_ids_invalid`,
  `evidence_id_malformed`, `open_questions_invalid`, `open_question_invalid`,
  `open_question_id_duplicated`, `open_question_status_invalid`,
  `open_question_unknown_id_malformed`, `summary_invalid`,
  `summary_field_invalid`, `summary_claim_unknown`, `reproduction_invalid`,
  `reproduction_key_missing`, `reproduction_list_invalid`,
  `reproduction_entry_invalid`, `reproduction_environment_invalid`.
- **Evidence bundle** (`src/bundle.mjs`): `bundle_not_object`,
  `bundle_missing_array`, `bundle_unknown_key`, `record_not_object`,
  `record_id_malformed`, `record_id_duplicated`, `record_confidence_invalid`,
  `record_authority_invalid`, `record_provider_missing`,
  `record_limitations_invalid`, `record_links_invalid`,
  `record_subject_invalid`, `record_locations_invalid`,
  `record_location_invalid`, `record_location_field_missing`,
  `record_location_kind_unknown`, `unknown_not_object`,
  `unknown_id_malformed`.

`validate --json` prints every issue with its code, severity and JSON path.

## What is verified, and what is not

120 tests (`npm test`, `node --test`, zero dependencies), including a
`test/regression.test.mjs` suite where each test corresponds to a real crash,
bypass or silent failure reproduced before it was fixed — including a crash
introduced by the hardening itself and caught by a second review pass:

- fabricated, malformed, duplicate and missing citations are rejected
- issue paths point at the citation index the author actually wrote, including
  when a non-string entry sits earlier in the list
- evidence from the wrong artifact is rejected, and omitting the target digest
  warns instead of silently disabling the check
- runtime claims require runtime authority; source-equivalence requires a
  historical source; inference-only support for a structural claim is rejected
- limitation acknowledgement requires a substantive quotation: unrelated text,
  empty strings and single characters are all rejected
- residual unknowns cannot be silently dropped
- malformed **bundles and reports** (non-array `records`, bad `locations`,
  non-object `subject`, or a report file containing `null`) are reported instead
  of crashing the validator or the renderer
- missing, unparseable and BOM-prefixed report **and** bundle files all exit 2
  with a clean message and no stack trace
- unknown flags, single-dash typos, stray positional arguments, misplaced flags,
  `--help`, and a value flag with no value
- authored text cannot inject headings, list items, table rows or code fences —
  including via a lone carriage return or a backtick inside a claim id
- `kind: "unknown"` is always rendered, never silently dropped
- unresolved citations are marked `(missing)` in claim bodies, the tools table
  and the evidence index alike
- `--allow-invalid` still runs the integrity rules and stamps a visible banner
- rendering is deterministic and never inlines `raw_result`
- the command installer pins a CLI path that exists, is idempotent, refuses to
  overwrite without `--force`, and preserves the command verbatim otherwise
- the committed real REA bundle still validates after all of the above

**Not verified, by design:** TraceBrief can prove a citation exists. It cannot
prove a sentence reads the cited bytes correctly. Prose that misinterprets
evidence still passes. It also does not render Markdown itself, so "cannot
inject" is asserted as a line-level property of the output, not by round-tripping
a CommonMark parser. Both limits are stated here rather than implied away.

## Sample

`reports/clipnote-search.md` is generated from real REA output:

- target: `fixtures/clipnote`, a small Electron fixture application
- evidence: `fixtures/clipnote-bundle.json`, exported from a live REA 6.0.0
  session (3 records: `analyze_javascript_application`,
  `trace_application_feature`, `trace_javascript_semantics`)
- claims: `fixtures/report.clipnote.json`

The sample validates with 0 errors and 3 warnings, one of which says the
TraceBrief render command itself is not backed by REA evidence. It also
demonstrates the tool working against its own author: two drafted claims were
rejected as unsupported assertions about the application until they were
reclassified as `analysis-coverage`, which is what they actually were.

Environment note: this sample is static JavaScript analysis only. Hopper is
macOS/Linux, and no Ghidra or IDA installation was configured, so the report
makes no native claim. A second integration check against a real PE
(`inspect_managed_artifact` on a Windows PowerShell assembly) was run during
development to exercise different record shapes — `format: pe`, `file-offset`
locations — and to confirm cross-artifact detection against a mixed bundle.

## Limitations

- Evidence ids are content digests. Pin `bundle_digest` in the report and
  TraceBrief will refuse a mismatched bundle; without it, re-validating a stale
  report against a changed bundle succeeds and only the footer digest differs.
- Bundles can be large (this sample is 2.3 MB) and contain `raw_result`
  payloads. Commit them only if they are safe to publish; TraceBrief never
  copies them into the report.
- Reports are authored by an LLM, so wording quality is unverified. Only
  citations and assertion classes are machine-checked.
- The limitation-acknowledgement rule requires quoting at least one carried
  limitation, not all of them: a record may carry a dozen. Every carried
  limitation is printed in the report regardless.
- Native analysis paths are untested on this host (no Hopper/Ghidra/IDA).

## Roadmap

1. `/tracebrief` command plus validator (current).
2. A `tracebrief` custom tool for OpenCode (`.opencode/tools/`) so validation
   happens inside the tool call instead of as a separate step.
3. Upstream discussion with the REA maintainers. REA owns canonical Evidence
   serialization, so a bundle-to-Markdown renderer arguably belongs in REA
   itself; the claim model and integrity rules are the part specific to agent
   workflows.

## Layout

```
.opencode/commands/tracebrief.md   /tracebrief command (repo copy)
scripts/install-command.mjs        installs /tracebrief globally
bin/tracebrief.mjs                 CLI: validate | render | index
src/bundle.mjs                     Evidence bundle reading and structural checks
src/report.mjs                     report.json schema validation
src/rules.mjs                      evidence integrity rules
src/render-markdown.mjs            deterministic, injection-proof renderer
test/                              node:test suite
fixtures/clipnote/                 Electron fixture application
fixtures/clipnote-bundle.json      real REA evidence export
fixtures/report.clipnote.json      authored claims for the sample
reports/                           generated reports
```

## Licence

MIT