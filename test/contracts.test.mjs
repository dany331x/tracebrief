/**
 * Every structural code published in the README must be reachable.
 *
 * The README documents these codes as part of the contract, so a guard that
 * never fires — or fires on the wrong input — is invisible. This table asserts
 * each one is actually produced by the input it claims to describe. A guard that
 * is deleted or made unreachable fails here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBundle } from "../src/bundle.mjs";
import { validateClaim, validateReport } from "../src/report.mjs";
import { checkIntegrity } from "../src/rules.mjs";
import { codes, evidenceId, hex, makeBundle, makeClaim, makeRecord, makeReport, unknownId, warningCodes } from "./helpers.mjs";

const bundleCodes = (bundle) => codes(validateBundle(bundle));
const reportCodes = (report) => codes(validateReport(report));

const BUNDLE_CASES = [
  ["bundle_not_object", () => bundleCodes(null)],
  ["bundle_not_object", () => bundleCodes([1, 2])],
  ["bundle_missing_array", () => bundleCodes(makeBundle({ unknowns: undefined }))],
  ["unknown_not_object", () => bundleCodes(makeBundle({ unknowns: [null] }))],
  ["unknown_id_malformed", () => bundleCodes(makeBundle({ unknowns: [{ unknown_id: "unk_short" }] }))],
  ["record_not_object", () => bundleCodes(makeBundle({ records: [null] }))],
  ["record_id_malformed", () => bundleCodes(makeBundle({ records: [makeRecord({ evidence_id: "ev_x" })] }))],
  ["record_id_duplicated", () => bundleCodes(makeBundle({ records: [makeRecord(), makeRecord()] }))],
  ["record_confidence_invalid", () => bundleCodes(makeBundle({ records: [makeRecord({ confidence: "sure-ish" })] }))],
  ["record_authority_invalid", () => bundleCodes(makeBundle({ records: [makeRecord({ authority: "vibes" })] }))],
  ["record_provider_missing", () => bundleCodes(makeBundle({ records: [makeRecord({ provider: null })] }))],
  ["record_limitations_invalid", () => bundleCodes(makeBundle({ records: [makeRecord({ limitations: "none" })] }))],
  ["record_links_invalid", () => bundleCodes(makeBundle({ records: [makeRecord({ evidence_links: {} })] }))],
  ["record_subject_invalid", () => bundleCodes(makeBundle({ records: [makeRecord({ subject: "text" })] }))],
  ["record_locations_invalid", () => bundleCodes(makeBundle({ records: [makeRecord({ locations: "addr" })] }))],
  ["record_location_invalid", () => bundleCodes(makeBundle({ records: [makeRecord({ locations: [7] })] }))],
  ["record_location_field_missing", () => bundleCodes(makeBundle({ records: [makeRecord({ locations: [{ kind: "address" }] })] }))],
  ["record_location_kind_unknown", () => bundleCodes(makeBundle({ records: [makeRecord({ locations: [{ kind: "telepathy", address: "0x1" }] })] }))],
];

const REPORT_CASES = [
  ["report_not_object", () => reportCodes(null)],
  ["report_key_missing", () => reportCodes((() => { const r = makeReport(); delete r.summary; return r; })())],
  ["report_schema_mismatch", () => reportCodes(makeReport({ schema: "tracebrief/report@2" }))],
  ["text_missing", () => reportCodes(makeReport({ title: "" }))],
  ["target_invalid", () => reportCodes(makeReport({ target: "clipnote" }))],
  ["target_field_invalid", () => reportCodes(makeReport({ target: { name: "t", version: 7 } }))],
  ["target_digest_malformed", () => reportCodes(makeReport({ target: { name: "t", artifact_digest: "nope" } }))],
  ["report_bundle_digest_malformed", () => reportCodes(makeReport({ bundle_digest: "nope" }))],
  ["report_section_invalid", () => reportCodes(makeReport({ findings: "claims" }))],
  ["claim_invalid", () => reportCodes(makeReport({ findings: [null] }))],
  ["claim_id_duplicated", () => reportCodes(makeReport({ findings: [makeClaim({ id: "d" })], relationships: [makeClaim({ id: "d" })] }))],
  ["claim_kind_invalid", () => reportCodes(makeReport({ findings: [makeClaim({ kind: "probably" })] }))],
  ["claim_type_invalid", () => reportCodes(makeReport({ findings: [makeClaim({ claim_type: "vibes" })] }))],
  ["claim_limitations_invalid", () => reportCodes(makeReport({ findings: [makeClaim({ limitations: "one" })] }))],
  ["claim_limitation_empty", () => reportCodes(makeReport({ findings: [makeClaim({ limitations: ["   "] })] }))],
  ["evidence_ids_missing", () => reportCodes(makeReport({ findings: [(({ evidence_ids, ...rest }) => rest)(makeClaim())] }))],
  ["evidence_ids_invalid", () => reportCodes(makeReport({ findings: [makeClaim({ evidence_ids: "ev_x" })] }))],
  ["evidence_id_malformed", () => reportCodes(makeReport({ findings: [makeClaim({ evidence_ids: ["ev_short"] })] }))],
  ["open_questions_invalid", () => reportCodes(makeReport({ open_questions: "q" }))],
  ["open_question_invalid", () => reportCodes(makeReport({ open_questions: [null] }))],
  ["open_question_id_duplicated", () => reportCodes(makeReport({ open_questions: [
    { id: "q", question: "?", status: "open", evidence_ids: [] },
    { id: "q", question: "?", status: "open", evidence_ids: [] },
  ] }))],
  ["open_question_status_invalid", () => reportCodes(makeReport({ open_questions: [{ id: "q", question: "?", status: "maybe", evidence_ids: [] }] }))],
  ["open_question_unknown_id_malformed", () => reportCodes(makeReport({ open_questions: [{ id: "q", question: "?", status: "open", evidence_ids: [], unknown_id: "unk_x" }] }))],
  ["summary_invalid", () => reportCodes(makeReport({ summary: "s" }))],
  ["summary_field_invalid", () => reportCodes(makeReport({ summary: { established: [1], not_established: [] } }))],
  ["summary_claim_unknown", () => reportCodes(makeReport({ summary: { established: ["ghost"], not_established: [] } }))],
  ["reproduction_invalid", () => reportCodes(makeReport({ reproduction: "r" }))],
  ["reproduction_key_missing", () => reportCodes(makeReport({ reproduction: {} }))],
  ["reproduction_environment_invalid", () => reportCodes(makeReport({ reproduction: { environment: [1], tool_versions: [], commands: [] } }))],
  ["reproduction_list_invalid", () => reportCodes(makeReport({ reproduction: { environment: [], tool_versions: "x", commands: [] } }))],
  ["reproduction_entry_invalid", () => reportCodes(makeReport({ reproduction: { environment: [], tool_versions: [{ version: "1", evidence_ids: [] }], commands: [] } }))],
  ["reproduction_entry_invalid", () => reportCodes(makeReport({ reproduction: { environment: [], tool_versions: [], commands: [{ purpose: "p", evidence_ids: [] }] } }))],
  ["reproduction_entry_invalid", () => reportCodes(makeReport({ reproduction: { environment: [], tool_versions: [{ name: "x", version: 12, evidence_ids: [] }], commands: [] } }))],
];

test("every published bundle code is reachable", () => {
  const missing = BUNDLE_CASES.filter(([code, run]) => !run().includes(code)).map(([code]) => code);
  assert.deepEqual(missing, [], `unreachable bundle codes: ${missing.join(", ")}`);
});

test("every published report code is reachable", () => {
  const missing = REPORT_CASES.filter(([code, run]) => !run().includes(code)).map(([code]) => code);
  assert.deepEqual(missing, [], `unreachable report codes: ${missing.join(", ")}`);
});

test("claim-level text validation reports both missing id and missing statement", () => {
  const found = codes(validateClaim({ kind: "observed", claim_type: "structure", evidence_ids: [] }, "findings[0]"));
  assert.equal(found.filter((code) => code === "text_missing").length, 2);
});

test("the bundle unknown-key warning is emitted for an extra key", () => {
  const found = validateBundle(makeBundle({ extra_key: 1 })).map((issue) => issue.code);
  assert.ok(found.includes("bundle_unknown_key"));
});

test("the report unknown-key warning is emitted for an extra key", () => {
  const found = validateReport(makeReport({ analyst_notes: "hi" })).map((issue) => issue.code);
  assert.ok(found.includes("report_key_unknown"));
});

test("bundle_digest_unverified warns when a report is pinned but nothing was compared", () => {
  const report = makeReport({ bundle_digest: hex("9") });
  assert.ok(warningCodes(checkIntegrity(report, makeBundle())).includes("bundle_digest_unverified"));
  // With a digest supplied and equal, no warning.
  assert.ok(
    !warningCodes(checkIntegrity(report, makeBundle(), { bundleDigest: hex("9") })).includes(
      "bundle_digest_unverified",
    ),
  );
});

test("no emitted code is missing from the published rule tables", async () => {
  // Guards the documentation contract mechanically: every code the source can
  // emit must be documented in README.md.
  const { readFileSync } = await import("node:fs");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const sources = await Promise.all(
    ["src/bundle.mjs", "src/report.mjs", "src/rules.mjs"].map((file) =>
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    ),
  );
  const emitted = new Set(
    sources
      .flatMap((text) => [...text.matchAll(/"([a-z]+_[a-z_]+)"/g)].map((match) => match[1]))
      .filter((code) => code.includes("_")),
  );
  const undocumented = [...emitted].filter((code) => !readme.includes(code));
  assert.deepEqual(undocumented, [], `codes emitted but not documented: ${undocumented.join(", ")}`);
});

test("a valid unknown id is accepted and an open question may carry it", () => {
  const bundle = makeBundle({ unknowns: [{ unknown_id: unknownId("1"), status: "open", question: "q?" }] });
  assert.deepEqual(bundleCodes(bundle), []);
  const report = makeReport({
    open_questions: [{ id: "q", question: "q?", status: "open", evidence_ids: [], unknown_id: unknownId("1") }],
  });
  assert.deepEqual(reportCodes(report), []);
  assert.ok(!codes(checkIntegrity(report, bundle)).includes("residual_unknown_not_carried"));
  assert.ok(!codes(checkIntegrity(makeReport(), bundle)).includes("residual_unknown_not_carried") === false);
});

test("evidenceId and unknownId helpers only produce structurally valid ids", () => {
  assert.match(evidenceId("a"), /^ev_[0-9a-f]{64}$/);
  assert.match(unknownId("1"), /^unk_[0-9a-f]{64}$/);
});