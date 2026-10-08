# How ClipNote search travels from the renderer to the main process

## Investigation question

In the shipped ClipNote Electron application, how does a query typed in the renderer reach the main process, and which parts of that path are established statically versus still unproven at runtime?

## Target overview

- **Name:** clipnote
- **Version:** 2.4.1
- **Format:** directory
- **Architecture:** unknown — not collected
- **Artifact digest:** `8ff2d109f779756047f9c1f2786ab05adaa5d6dcb4f82871a6032d2663c84d46`
- **Local path:** fixtures/clipnote

## Key findings

### 1. REA recorded three literal IPC channels, three renderer transmissions and three main-process handlers, and paired all three renderer transmissions with a handler; no unpaired literal renderer transmissions were reported.

- **Claim id:** `f-ipc-channels-paired` · **Kind:** derived · **Type:** structure
- **Evidence:** `ev_b318dce1e595…`
- **Cited evidence reports:** authority shipped-artifact; confidence derived
- **Limitations:**
  - Electron relationships are derived from inert syntax; runtime registration, reachability, defaults, and enforcement remain unproven.
  - JavaScript and HTML were parsed as inert text; bundle bootstrap code was never executed.

### 2. The preload entrypoint exposes three members through one context bridge, and three explicit web preferences were recorded, including contextIsolation and nodeIntegration.

- **Claim id:** `f-context-bridge-surface` · **Kind:** derived · **Type:** structure
- **Evidence:** `ev_b318dce1e595…`
- **Cited evidence reports:** authority shipped-artifact; confidence derived
- **Limitations:**
  - Electron relationships are derived from inert syntax; runtime registration, reachability, defaults, and enforcement remain unproven.

### 3. REA recorded zero sender-validation observations across the inventoried IPC surface. This is an absence in static analysis and is not evidence that no validation exists at runtime.

- **Claim id:** `f-no-sender-validation-observed` · **Kind:** derived · **Type:** structure
- **Evidence:** `ev_b318dce1e595…`
- **Cited evidence reports:** authority shipped-artifact; confidence derived
- **Limitations:**
  - Electron relationships are derived from inert syntax; runtime registration, reachability, defaults, and enforcement remain unproven.

### 4. The analysis parsed eight JavaScript files, visited 959 AST nodes and produced 44 findings with zero parse failures, zero invalid UTF-8 files and zero truncated scopes.

- **Claim id:** `f-inventory-complete` · **Kind:** derived · **Type:** structure
- **Evidence:** `ev_b318dce1e595…`
- **Cited evidence reports:** authority shipped-artifact; confidence derived
- **Limitations:**
  - Static paths and relationships may remain unresolved when expressions are dynamic or obfuscated.

### 5. A semantic trace seeded on the same literal channel matched zero seed nodes and reported coverage status partial, so the semantic graph contributed no nodes for this question.

- **Claim id:** `f-semantic-seed-unresolved` · **Kind:** observed · **Type:** analysis-coverage
- **Evidence:** `ev_d8fd194032b8…`
- **Cited evidence reports:** authority analyst-inference; confidence inferred
- **Limitations:**
  - Artifact identity is unavailable for this observation.

## Relationships

### 1. Tracing the literal channel note:search with one seed match expanded to 49 nodes and 76 relations, of which 59 facts were observed and 70 were inferred candidates, with coverage complete-within-source.

- **Claim id:** `r-search-channel-trace` · **Kind:** inferred · **Type:** structure
- **Evidence:** `ev_467e4f47ae59…`, `ev_b318dce1e595…`
- **Cited evidence reports:** authority analyst-inference, shipped-artifact; confidence derived, inferred
- **Limitations:**
  - A trace reports graph relationships, not proof that code executed or that a feature is reachable in every state.
  - Artifact identity is unavailable for this observation.

### 2. Both workflow records link back to the application analysis record through evidence_links, so the trace and semantic records are derived from the same inventoried artifact rather than from separate targets.

- **Claim id:** `r-provenance-chain` · **Kind:** observed · **Type:** analysis-coverage
- **Evidence:** `ev_467e4f47ae59…`, `ev_d8fd194032b8…`
- **Cited evidence reports:** authority analyst-inference; confidence inferred
- **Limitations:**
  - Artifact identity is unavailable for this observation.

## Confidence and limitations

- **Confidence of cited evidence:** derived 1, inferred 2
- **Authority of cited evidence:** analyst-inference 2, shipped-artifact 1
- **Reading rule:** `observed` is a direct provider reading, `derived` is computed from observed data, `inferred` is a candidate that static analysis cannot confirm at runtime.

Limitations carried by the cited evidence:

- A trace reports graph relationships, not proof that code executed or that a feature is reachable in every state.
- Artifact identity is unavailable for this observation.
- Boundary extraction covers unshadowed JSON/global coercions plus parse and validation method candidates.
- Child-process extraction covers asynchronous node:child_process creation, literal argv/env/stdio options, exit/error listeners, and kill signals.
- CommonJS and ESM binding relationships were recovered from inert syntax and resolved only within the inventoried artifact container.
- Configuration extraction covers process.env, process.argv, node:fs reads, and direct logical defaults.
- Electron relationships are derived from inert syntax; runtime registration, reachability, defaults, and enforcement remain unproven.
- Event extraction covers EventEmitter-style literal registrations, removals, and dispatch candidates; dynamic names remain unknown.
- Function fingerprints are static candidates; equal digests can remain ambiguous and do not prove behavioral equivalence.
- JavaScript and HTML were parsed as inert text; bundle bootstrap code was never executed.
- Local data flow does not claim control-flow-sensitive reaching definitions or arbitrary dynamic property resolution.
- Native handoffs never open a binary or invoke a provider automatically; snapshot reuse remains provider/profile/target exact.
- Promise ownership covers explicit unshadowed Promise construction, static factories, aggregation, chaining, and await syntax only.
- Request extraction covers fetch, WebSocket, node:http/node:https construction, direct option fields, and exact local response consumers.
- Resource extraction covers built-in filesystem/network acquisition and exact local close/destroy/end handles.
- Semantic graph reachability is a static inference and does not prove runtime execution.
- Static imports, entrypoints, workers, endpoints, and storage relationships do not prove runtime execution.
- Static paths and relationships may remain unresolved when expressions are dynamic or obfuscated.
- Static, native, passive-runtime, inferred, and unknown facts retain their original authority in the returned graph.
- The semantic graph contains static syntax observations and conservative relationship candidates; it does not claim runtime execution.
- Timer extraction covers global or node:timers scheduling and exact local-handle cancellation.
- Webpack/Rspack factories were recovered from AST literals; REA did not invoke push handlers or bundle bootstrap code.

## Reproduction

### Environment

- windows-x86_64
- Node.js v24.21.0
- REA 6.0.0 (npx rea-agents@6.0.0 mcp)
- No analysis engine configured: Hopper is unsupported on this host and neither Ghidra nor IDA was set, so every record below is static JavaScript analysis.

### Tools

| Tool | Version | Evidence |
| --- | --- | --- |
| REA JavaScript application analyzer | 1 | `ev_b318dce1e595a404df70e1f22c8d16d8e1216f409f20aeeacf6ecc3bb4220779` |
| REA JavaScript application workflows | 1 | `ev_467e4f47ae59fc38f7099a3ca288d90ca770a6c28cfc36290f83701a529008c8` |

### Commands

- `analyze_javascript_application { input_path: "fixtures/clipnote" }` — Build the application graph, module inventory and Electron boundary summary
  Evidence: `ev_b318dce1e595a404df70e1f22c8d16d8e1216f409f20aeeacf6ecc3bb4220779`
- `trace_application_feature { seed: { kind: "channel", value: "note:search", match: "exact" }, direction: "both" }` — Trace the literal IPC channel in both directions from provenance
  Evidence: `ev_467e4f47ae59fc38f7099a3ca288d90ca770a6c28cfc36290f83701a529008c8`
- `trace_javascript_semantics { seed: { kind: "literal", value: "note:search" }, direction: "backward-provenance" }` — Attempt a semantic-node trace of the same literal; returned zero seed matches and coverage status partial
  Evidence: `ev_d8fd194032b8c98e1b8d15ea25e0fc4f624827da075bce02ef8197c611d263ab`
- `node bin/tracebrief.mjs render --report fixtures/report.clipnote.json --bundle fixtures/clipnote-bundle.json` — Regenerate this Markdown file from the authored claims (no evidence cited)

## Open questions

- **open** — Does the renderer actually reach the main process in this order, and does the handler run before the window is shown? No runtime or process capture was collected.
  Evidence: `ev_467e4f47ae59fc38f7099a3ca288d90ca770a6c28cfc36290f83701a529008c8`
- **open** — Are contextIsolation and nodeIntegration actually enforced by the shipped runtime, or only declared in the window options text?
  Evidence: `ev_b318dce1e595a404df70e1f22c8d16d8e1216f409f20aeeacf6ecc3bb4220779`
- **investigating** — Does the search index reuse a cached index file, and is the ranking call in the index builder well formed? The static graph does not answer either question, and the argument shape looks inconsistent on manual reading. (no evidence cited)

## Summary

### Established

- `f-ipc-channels-paired`
- `f-context-bridge-surface`
- `f-inventory-complete`
- `f-semantic-seed-unresolved`
- `r-search-channel-trace`
- `r-provenance-chain`

### Not established

- Runtime execution order of the search request.
- Enforcement of the declared context isolation settings.
- Search index caching behaviour and ranking correctness.
- Whether any IPC sender validation occurs at runtime.

## Evidence index

| Evidence | Operation | Subject | Provider | Confidence | Authority | Locations |
| --- | --- | --- | --- | --- | --- | --- |
| `ev_467e4f47ae59fc38f7099a3ca288d90ca770a6c28cfc36290f83701a529008c8` | trace_application_feature | no subject | rea-javascript-application-workflows@1 | inferred | analyst-inference | none recorded |
| `ev_b318dce1e595a404df70e1f22c8d16d8e1216f409f20aeeacf6ecc3bb4220779` | analyze_javascript_application | directory | rea-javascript-application@1 | derived | shipped-artifact | path artifact-root |
| `ev_d8fd194032b8c98e1b8d15ea25e0fc4f624827da075bce02ef8197c611d263ab` | trace_javascript_semantics | no subject | rea-javascript-application-workflows@1 | inferred | analyst-inference | none recorded |

Evidence links (provenance chain declared by REA):

- `ev_467e4f47ae59fc38f7099a3ca288d90ca770a6c28cfc36290f83701a529008c8` → `ev_b318dce1e595a404df70e1f22c8d16d8e1216f409f20aeeacf6ecc3bb4220779`
- `ev_d8fd194032b8c98e1b8d15ea25e0fc4f624827da075bce02ef8197c611d263ab` → `ev_b318dce1e595a404df70e1f22c8d16d8e1216f409f20aeeacf6ecc3bb4220779`

Bundle digest (sha256 of the exported file): `da54696514f9596de8af7a51f641b01dcb2e1968594b58916ca3fd787497dbb1`

---

TraceBrief report. Evidence bundle contains 3 record(s), 0 residual unknown(s), digest `da54696514f9596de8af7a51f641b01dcb2e1968594b58916ca3fd787497dbb1`.

Regenerate with `tracebrief render --report <report.json> --bundle <bundle.json>`. Identical inputs produce identical output.
