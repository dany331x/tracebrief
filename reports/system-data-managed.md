# System.Data.dll is a mixed-mode CLR assembly, not a pure managed one

## Investigation question

Is C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Data.dll a managed .NET assembly, and what does its PE and metadata actually declare?

## Target overview

- **Name:** System.Data.dll
- **Version:** 4.0.0.0
- **Format:** pe
- **Architecture:** x86\_64
- **Artifact digest:** `44ef042fa9fbca676466cf9ddd7541ec00c8887c10672880702cc5a4a8182606`
- **Local path:** C:/Windows/Microsoft.NET/Framework64/v4.0.30319/System.Data.dll

## Key findings

### 1. REA classified the image as managed with runtime family mixed-clr-native: the CLI header and metadata root are present, but COMIMAGE\_FLAGS\_ILONLY is clear, so managed and native analysis must stay composed rather than treating it as pure IL.

- **Claim id:** `f-managed-but-mixed-mode`
- **Kind:** observed · **Type:** structure
- **Evidence:** `ev_c9006a695599…`
- **Cited evidence reports:** authority shipped-artifact; confidence observed
- **Limitations:**
  - Static inspection did not load the assembly, resolve dependencies through a CLR, decompile C#, or execute target code.

### 2. The metadata stream set is complete and carries 14,072 method definitions, 1,140 type definitions, 9,096 fields and 17,650 parameters.

- **Claim id:** `f-metadata-complete`
- **Kind:** observed · **Type:** structure
- **Evidence:** `ev_c9006a695599…`
- **Cited evidence reports:** authority shipped-artifact; confidence observed
- **Limitations:**
  - Static inspection did not load the assembly, resolve dependencies through a CLR, decompile C#, or execute target code.

### 3. The assembly declares public key token b77a5c561934e089, the strong-name token, and references nine assemblies including mscorlib, System and System.Xml.

- **Claim id:** `f-strong-name`
- **Kind:** observed · **Type:** structure
- **Evidence:** `ev_c9006a695599…`
- **Cited evidence reports:** authority shipped-artifact; confidence observed
- **Limitations:**
  - Static inspection did not load the assembly, resolve dependencies through a CLR, decompile C#, or execute target code.

### 4. REA reported coverage state complete with no issues for this inspection, which bounds the static inventory rather than any runtime behaviour.

- **Claim id:** `f-coverage-complete`
- **Kind:** observed · **Type:** analysis-coverage
- **Evidence:** `ev_c9006a695599…`
- **Cited evidence reports:** authority shipped-artifact; confidence observed
- **Limitations:**
  - Static inspection did not load the assembly, resolve dependencies through a CLR, decompile C#, or execute target code.

## Relationships

### 1. The three reported source locations tie this record to the file rather than to memory addresses: a 72-byte file-offset range for the CLI header plus single offsets for the module and assembly rows.

- **Claim id:** `r-metadata-located-by-file-offset`
- **Kind:** derived · **Type:** structure
- **Evidence:** `ev_c9006a695599…`
- **Cited evidence reports:** authority shipped-artifact; confidence observed
- **Limitations:**
  - Static inspection did not load the assembly, resolve dependencies through a CLR, decompile C#, or execute target code.

## Confidence and limitations

- **Confidence of cited evidence:** observed 1
- **Authority of cited evidence:** shipped-artifact 1
- **Reading rule:** `observed` is a direct provider reading, `derived` is computed from observed data, `inferred` is a candidate that static analysis cannot confirm at runtime.

Limitations carried by the cited evidence:

- Static inspection did not load the assembly, resolve dependencies through a CLR, decompile C#, or execute target code.

## Reproduction

### Environment

- windows-x86\_64
- REA 6.0.0
- Static inspection only: REA did not load the assembly, resolve dependencies through a CLR, decompile C#, or execute target code.

### Tools

| Tool | Version | Evidence |
| --- | --- | --- |
| REA managed static analysis provider | 1 | `ev_c9006a69559941e1170f17d928ec24a647bea5b875dafc8cb5629d7da656e583` |

### Commands

- `inspect_managed_artifact { path: "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/System.Data.dll" }` — Classify the image and read its managed metadata statically
  Evidence: `ev_c9006a69559941e1170f17d928ec24a647bea5b875dafc8cb5629d7da656e583`

## Open questions

- **open** (unk_2fece72eef45972af3918adc9a78f9dbf6f7ad8b26143ad184a68e5c9c811f30) — Does the ClipNote renderer reach the main process in this order at runtime, and does the search handler run before the window is shown? (no evidence cited)
- **open** (unk_f9b1ddb7fd9340265a8cfcb053e386d712ae7fada843f553b46aba5c636e9263) — Are contextIsolation and nodeIntegration enforced by the shipped runtime, or only declared in the window options text? (no evidence cited)

## Summary

### Established

- `f-managed-but-mixed-mode`
- `f-metadata-complete`
- `f-strong-name`
- `f-coverage-complete`
- `r-metadata-located-by-file-offset`

### Not established

- Any runtime behaviour of the assembly: nothing was loaded or executed.
- The two residual unknowns carried from the ClipNote investigation, which belong to a different target and remain open.

## Evidence index

| Evidence | Operation | Subject | Provider | Confidence | Authority | Locations |
| --- | --- | --- | --- | --- | --- | --- |
| `ev_c9006a69559941e1170f17d928ec24a647bea5b875dafc8cb5629d7da656e583` | inspect_managed_artifact | pe | rea-dotnet-static@1 | observed | shipped-artifact | offsets 1513912-1513984; offset 1893668; offset 2585272 |

Bundle digest (sha256 of the exported file): `9a019c448ebf96ccf3c946f4454a5a78dc8d93e87596e784d40cb7afd498b70c`

---

TraceBrief report. Evidence bundle contains 5 record(s), 4 residual unknown(s), digest `9a019c448ebf96ccf3c946f4454a5a78dc8d93e87596e784d40cb7afd498b70c`.

Regenerate with `node bin/tracebrief.mjs render --report <report.json> --bundle <bundle.json>`. Identical inputs produce identical output.
