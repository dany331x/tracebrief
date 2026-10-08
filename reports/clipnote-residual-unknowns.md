# What the ClipNote search investigation established, and what it did not

## Investigation question

After static analysis of the ClipNote search path, which questions are actually settled, and which remain open?

## Target overview

- **Name:** clipnote
- **Version:** 2.4.1
- **Format:** directory
- **Architecture:** unknown — not collected
- **Artifact digest:** unknown — not collected
- **Local path:** fixtures/clipnote

> No artifact digest was recorded, so TraceBrief could not verify that the cited evidence describes this target.

## Key findings

### 1. REA retained three residual unknowns for this investigation: two remain open and one was closed as out of scope, and the bundle keeps the full revision history of each.

- **Claim id:** `f-unknowns-are-bookkept`
- **Kind:** observed · **Type:** structure
- **Evidence:** `ev_8c639fb17dfb…`, `ev_c0886c22b6c3…`, `ev_307880359d4b…`
- **Cited evidence reports:** authority analyst-inference; confidence derived
- **Limitations:**
  - Artifact identity is unavailable for this observation.
  - Registry mutation evidence records analyst intent, not proof of the answer.

### 2. Both remaining open questions require controlled-replay authority, and no record in this bundle carries it, so no amount of further static analysis on this host can close them.

- **Claim id:** `f-static-cannot-close-runtime-questions`
- **Kind:** derived · **Type:** analysis-coverage
- **Evidence:** `ev_8c639fb17dfb…`, `ev_c0886c22b6c3…`
- **Cited evidence reports:** authority analyst-inference; confidence derived
- **Limitations:**
  - Artifact identity is unavailable for this observation.
  - Registry mutation evidence records analyst intent, not proof of the answer.

## Relationships

_Not collected._

## Confidence and limitations

- **Confidence of cited evidence:** derived 4
- **Authority of cited evidence:** analyst-inference 4
- **Reading rule:** `observed` is a direct provider reading, `derived` is computed from observed data, `inferred` is a candidate that static analysis cannot confirm at runtime.

Limitations carried by the cited evidence:

- Artifact identity is unavailable for this observation.
- Registry mutation evidence records analyst intent, not proof of the answer.

## Reproduction

### Environment

- windows-x86\_64
- REA 6.0.0 (npx rea-agents@6.0.0 mcp)
- No analysis engine configured: Hopper is unsupported on this host and neither Ghidra nor IDA was set, so every record here is static analysis or registry bookkeeping.

### Tools

| Tool | Version | Evidence |
| --- | --- | --- |
| REA residual-unknown registry | 6.0.0 | `ev_8c639fb17dfbeebc0d5284a5113c74041404dd6f04b8404f8c64d156a07c0e09` |

### Commands

- `record_unknown { question, severity, domain, required_authority }` — Record an unresolved question in REA so it cannot be silently dropped from the investigation
  Evidence: `ev_8c639fb17dfbeebc0d5284a5113c74041404dd6f04b8404f8c64d156a07c0e09`, `ev_c0886c22b6c3eba615371501ee705abcbc5e8388bdc25d23494a32552e62a687`, `ev_307880359d4beba957a16d8c9af63913a1278c0f4ebb6f80257a6846bd1388e7`
- `update_unknown { status: resolved, resolution: { disposition: out-of-scope } }` — Close a question as out of scope, with a rationale and a new revision
  Evidence: `ev_c36dec3cdbe1b30f4444aa885a66ef26fa3338d1295f470c2af6ea3c68be5fbf`

## Open questions

- **open** (unk_2fece72eef45972af3918adc9a78f9dbf6f7ad8b26143ad184a68e5c9c811f30) — Does the ClipNote renderer reach the main process in this order at runtime, and does the search handler run before the window is shown? (no evidence cited)
- **open** (unk_f9b1ddb7fd9340265a8cfcb053e386d712ae7fada843f553b46aba5c636e9263) — Are contextIsolation and nodeIntegration enforced by the shipped runtime, or only declared in the window options text? (no evidence cited)

## Summary

### Established

- `f-unknowns-are-bookkept`
- `f-static-cannot-close-runtime-questions`

### Not established

- Does the ClipNote renderer reach the main process in this order at runtime, and does the search handler run before the window is shown?
- Are contextIsolation and nodeIntegration enforced by the shipped runtime, or only declared in the window options text?

## Evidence index

| Evidence | Operation | Subject | Provider | Confidence | Authority | Locations |
| --- | --- | --- | --- | --- | --- | --- |
| `ev_307880359d4beba957a16d8c9af63913a1278c0f4ebb6f80257a6846bd1388e7` | record_unknown | no subject | rea-unknown-registry@1 | derived | analyst-inference | none recorded |
| `ev_8c639fb17dfbeebc0d5284a5113c74041404dd6f04b8404f8c64d156a07c0e09` | record_unknown | no subject | rea-unknown-registry@1 | derived | analyst-inference | none recorded |
| `ev_c0886c22b6c3eba615371501ee705abcbc5e8388bdc25d23494a32552e62a687` | record_unknown | no subject | rea-unknown-registry@1 | derived | analyst-inference | none recorded |
| `ev_c36dec3cdbe1b30f4444aa885a66ef26fa3338d1295f470c2af6ea3c68be5fbf` | update_unknown | no subject | rea-unknown-registry@1 | derived | analyst-inference | none recorded |

Bundle digest (sha256 of the exported file): `a3e677001d985ace03d2b9d89400bd395296828d83721046d85f3e2519ab64b7`

---

TraceBrief report. Evidence bundle contains 4 record(s), 4 residual unknown(s), digest `a3e677001d985ace03d2b9d89400bd395296828d83721046d85f3e2519ab64b7`.

Regenerate with `node bin/tracebrief.mjs render --report <report.json> --bundle <bundle.json>`. Identical inputs produce identical output.
