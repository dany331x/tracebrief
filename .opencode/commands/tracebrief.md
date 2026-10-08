---
description: Create an evidence-first reverse-engineering report from the current REA investigation
---

Create a TraceBrief report for the current investigation and write it to
`reports/$ARGUMENTS.md` (default filename: `reports/tracebrief.md`).

TraceBrief separates authoring from rendering: **you** write the claims, a
deterministic script checks every citation and renders the Markdown. Never write
the report Markdown yourself.

## Steps

1. **Get the Evidence bundle.** If the session already investigated a target,
   call the REA tool `export_evidence_bundle` with an absolute path such as
   `reports/evidence-bundle.json` (`overwrite: true` when you are replacing a
   file you created earlier). If no investigation exists yet, stop and ask which
   target to inspect — do not pick an example target on the user's behalf.

2. **Read the bundle, not your memory.** Inspect the exported file and use only
   what is in it. The `records` array is the only source of citations. For every
   record note its `evidence_id`, `operation`, `confidence`, `authority`,
   `subject`, `locations` and `limitations`. Also carry every entry of
   `unknowns` forward.

3. **Author `reports/<name>.report.json`.** Follow the schema in
   `README.md` ("Report schema") and `fixtures/report.clipnote.json` as a
   worked example. Rules that are not negotiable:
   - Cite `ev_<64 hex>` ids that exist in the bundle. Never invent, guess or
     reconstruct an id; copy it from the bundle.
   - Every claim except `kind: "unknown"` needs at least one citation.
   - `claim_type` must be honest:
     - `structure` / `behavior` — statements about the artifact.
     - `runtime-behavior` — only if you cite a record whose authority is
       `controlled-replay` or `external-service`. Static analysis never proves
       execution.
     - `source-equivalence` — only with a `historical-reference` record.
       Decompiled output is not the original source.
     - `analysis-coverage` — statements about what the analysis did or could
       not establish (this is exempt from the rules above).
   - Copy limitations from the cited records onto the claims they affect.
   - Put every non-resolved bundle unknown in `open_questions` with its
     `unknown_id`.
   - Leave a field `null` or an array empty when you do not know. The renderer
     prints "unknown — not collected"; do not improvise a value.

4. **Validate and render.**

   ```
   node bin/tracebrief.mjs validate --report reports/<name>.report.json --bundle reports/evidence-bundle.json
   node bin/tracebrief.mjs render --report reports/<name>.report.json --bundle reports/evidence-bundle.json --out reports/$ARGUMENTS.md
   ```

   Fix every error and re-run. Address warnings by either fixing the claim or
   stating the gap in the report; never silence one by deleting the citation.
   Do not use `--allow-invalid` unless the user explicitly asks for a draft.

5. **Report back.** Tell the user the output path, the validation summary
   (error and warning counts), and which claims remain unverified.

## What not to do

- Do not claim runtime behavior from static evidence.
- Do not describe decompiled or reconstructed code as original source.
- Do not invent addresses, offsets, function names, test results or commands.
- Do not overwrite an existing report without asking.