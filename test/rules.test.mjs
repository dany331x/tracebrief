import assert from "node:assert/strict";
import { test } from "node:test";
import { checkIntegrity, citedEvidenceIds } from "../src/rules.mjs";
import { TARGET_DIGEST, evidenceId, hex, makeBundle, makeClaim, makeRecord, makeReport, unknownId } from "./helpers.mjs";

const errors = (report, bundle) =>
  checkIntegrity(report, bundle)
    .filter((issue) => issue.level === "error")
    .map((issue) => issue.code);
const warnings = (report, bundle) =>
  checkIntegrity(report, bundle)
    .filter((issue) => issue.level === "warning")
    .map((issue) => issue.code);

test("a well-supported report produces no errors", () => {
  assert.deepEqual(errors(makeReport(), makeBundle()), []);
});

test("rejects a fabricated evidence id", () => {
  const report = makeReport({ findings: [makeClaim({ evidence_ids: [evidenceId("9")] })] });
  assert.ok(errors(report, makeBundle()).includes("evidence_not_in_bundle"));
});

test("rejects a claim that cites nothing", () => {
  const report = makeReport({
    findings: [makeClaim({ evidence_ids: [] })],
    summary: { established: [], not_established: [] },
  });
  assert.ok(errors(report, makeBundle()).includes("claim_without_evidence"));
});

test("rejects evidence from a different artifact than the reported target", () => {
  const bundle = makeBundle({ records: [makeRecord({ subject: { name: "other.exe", digest: { sha256: hex("b") }, format: "pe", architecture: "x86_64", local_path: "other.exe" } })] });
  assert.ok(errors(makeReport(), bundle).includes("evidence_subject_mismatch"));
});

test("rejects a runtime claim backed only by static authority", () => {
  const report = makeReport({
    findings: [makeClaim({ id: "r1", claim_type: "runtime-behavior", kind: "derived", evidence_ids: [evidenceId("a")] })],
    summary: { established: ["r1"], not_established: [] },
  });
  assert.ok(errors(report, makeBundle()).includes("runtime_claim_without_runtime_authority"));
});

test("accepts a runtime claim backed by controlled replay", () => {
  const bundle = makeBundle({
    records: [makeRecord({ evidence_id: evidenceId("c"), confidence: "observed", authority: "controlled-replay" })],
  });
  const report = makeReport({
    findings: [
      makeClaim({
        id: "r1",
        claim_type: "runtime-behavior",
        kind: "observed",
        evidence_ids: [evidenceId("c")],
      }),
    ],
    reproduction: {
      environment: ["windows-x86_64"],
      tool_versions: [{ name: "test-provider", version: "9.9", evidence_ids: [evidenceId("c")] }],
      commands: [],
    },
    summary: { established: ["r1"], not_established: [] },
  });
  assert.deepEqual(errors(report, bundle), []);
});

test("rejects a source-equivalence claim with no historical source record", () => {
  const report = makeReport({
    findings: [makeClaim({ id: "s1", claim_type: "source-equivalence", evidence_ids: [evidenceId("a")] })],
    summary: { established: ["s1"], not_established: [] },
  });
  assert.ok(errors(report, makeBundle()).includes("source_equivalence_without_historical_source"));
});

test("accepts a source-equivalence claim with a historical-reference record", () => {
  const bundle = makeBundle({
    records: [makeRecord({ evidence_id: evidenceId("e"), authority: "historical-reference", confidence: "observed" })],
  });
  const report = makeReport({
    findings: [makeClaim({ id: "s1", claim_type: "source-equivalence", evidence_ids: [evidenceId("e")] })],
    reproduction: {
      environment: ["windows-x86_64"],
      tool_versions: [{ name: "test-provider", version: "9.9", evidence_ids: [evidenceId("e")] }],
      commands: [],
    },
    summary: { established: ["s1"], not_established: [] },
  });
  assert.deepEqual(errors(report, bundle), []);
});

test("rejects a structural claim resting only on inferred records", () => {
  const bundle = makeBundle({
    records: [makeRecord({ evidence_id: evidenceId("9"), confidence: "inferred", authority: "analyst-inference", subject: null })],
  });
  const report = makeReport({
    findings: [makeClaim({ id: "i1", kind: "inferred", evidence_ids: [evidenceId("9")] })],
    summary: { established: [], not_established: [] },
  });
  assert.ok(errors(report, bundle).includes("claim_requires_observed_basis"));
});

test("warns when cited records carry no artifact subject", () => {
  const bundle = makeBundle({ records: [makeRecord({ subject: null, confidence: "derived" })] });
  assert.ok(warnings(makeReport(), bundle).includes("evidence_subject_unavailable"));
});

test("warns when the claim does not acknowledge carried limitations", () => {
  const bundle = makeBundle({ records: [makeRecord({ limitations: ["Coverage is partial."] })] });
  assert.ok(warnings(makeReport(), bundle).includes("claim_limitations_not_carried"));
});

test("acknowledging the limitation clears the warning", () => {
  const bundle = makeBundle({ records: [makeRecord({ limitations: ["Coverage is partial."] })] });
  const report = makeReport({ findings: [makeClaim({ limitations: ["Coverage is partial."] })] });
  assert.ok(!warnings(report, bundle).includes("claim_limitations_not_carried"));
});

test("warns about an evidence link that the bundle cannot resolve", () => {
  const bundle = makeBundle({ records: [makeRecord({ evidence_links: [evidenceId("8")] })] });
  assert.ok(warnings(makeReport(), bundle).includes("evidence_link_unresolved"));
});

test("rejects a residual unknown the report does not carry", () => {
  const bundle = makeBundle({
    unknowns: [
      {
        unknown_id: unknownId("u"),
        revision: 1,
        status: "open",
        question: "Which unpacker variant is used?",
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
        required_authority: "controlled-replay",
      },
    ],
  });
  assert.ok(errors(makeReport(), bundle).includes("residual_unknown_not_carried"));
});

test("carrying the residual unknown with its id clears the error", () => {
  const bundle = makeBundle({
    unknowns: [{ unknown_id: unknownId("u"), revision: 1, status: "open", question: "Which unpacker variant?" }],
  });
  const report = makeReport({
    open_questions: [
      {
        id: "q1",
        question: "Which unpacker variant is used?",
        status: "open",
        unknown_id: unknownId("u"),
        evidence_ids: [],
      },
    ],
  });
  assert.ok(!errors(report, bundle).includes("residual_unknown_not_carried"));
});

test("rejects a target digest that is not in the bundle artifacts", () => {
  const report = makeReport();
  report.target.artifact_digest = hex("c");
  assert.ok(errors(report, makeBundle()).includes("target_not_in_bundle"));
});

test("rejects a summary that establishes an unknown claim", () => {
  const report = makeReport({
    findings: [makeClaim({ id: "u1", kind: "unknown", evidence_ids: [] })],
    summary: { established: ["u1"], not_established: [] },
  });
  assert.ok(errors(report, makeBundle()).includes("summary_establishes_unknown"));
});

test("warns about unverified commands and tool versions", () => {
  const report = makeReport({
    reproduction: {
      environment: [],
      tool_versions: [{ name: "ghidra", version: "12.1.4", evidence_ids: [] }],
      commands: [{ command: "rea analyze /x", purpose: "look", evidence_ids: [] }],
    },
  });
  const found = warnings(report, makeBundle());
  assert.ok(found.includes("tool_version_unverified"));
  assert.ok(found.includes("command_unverified"));
});

test("allows an analysis-coverage claim to rest on inferred records", () => {
  const bundle = makeBundle({
    records: [makeRecord({ evidence_id: evidenceId("9"), confidence: "inferred", authority: "analyst-inference", subject: null })],
  });
  const report = makeReport({
    findings: [makeClaim({ id: "cov1", claim_type: "analysis-coverage", kind: "observed", evidence_ids: [evidenceId("9")] })],
    reproduction: { environment: [], tool_versions: [], commands: [] },
    summary: { established: ["cov1"], not_established: [] },
  });
  assert.ok(!errors(report, bundle).includes("claim_requires_observed_basis"));
});

test("collects every cited evidence id deterministically", () => {
  const report = makeReport({
    findings: [makeClaim({ evidence_ids: [evidenceId("b"), evidenceId("a")] })],
    open_questions: [{ id: "q", question: "?", status: "open", evidence_ids: [evidenceId("c")] }],
  });
  assert.deepEqual(citedEvidenceIds(report), [evidenceId("a"), evidenceId("b"), evidenceId("c")]);
});

test("subject mismatch is only raised for records that declare a subject", () => {
  const bundle = makeBundle({ records: [makeRecord({ subject: null, confidence: "derived" })] });
  const report = makeReport();
  report.target.artifact_digest = TARGET_DIGEST;
  assert.ok(!errors(report, bundle).includes("evidence_subject_mismatch"));
});