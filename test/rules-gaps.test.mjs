/**
 * Coverage for rules that previously had no test at all.
 *
 * Every mutation listed in `scripts/mutation-check.mjs` that targets this file
 * must be caught here; that is the point of this suite.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkIntegrity } from "../src/rules.mjs";
import { validateReport } from "../src/report.mjs";
import { codes, evidenceId, hex, makeBundle, makeClaim, makeRecord, makeReport, unknownId, warningCodes } from "./helpers.mjs";

const errors = (report, bundle, options) => codes(checkIntegrity(report, bundle, options));
const warnings = (report, bundle, options) => warningCodes(checkIntegrity(report, bundle, options));
const bare = {
  findings: [],
  relationships: [],
  reproduction: { environment: [], tool_versions: [], commands: [] },
  open_questions: [],
  summary: { established: [], not_established: [] },
};

// --- kind: "unknown" is the only licence to assert with no citation ---

test("a kind-unknown claim may cite nothing, and no other kind may", () => {
  const gap = makeReport({
    findings: [makeClaim({ id: "gap", kind: "unknown", claim_type: "analysis-coverage", evidence_ids: [] })],
    summary: { established: [], not_established: [] },
  });
  assert.deepEqual(errors(gap, makeBundle()), []);

  for (const kind of ["observed", "derived", "inferred"]) {
    const asserted = makeReport({
      findings: [makeClaim({ id: `k-${kind}`, kind, evidence_ids: [] })],
      summary: { established: [], not_established: [] },
    });
    assert.ok(
      errors(asserted, makeBundle()).includes("claim_without_evidence"),
      `kind ${kind} must not be allowed to cite nothing`,
    );
  }
});

// --- relationships claims are checked exactly like findings claims ---

test("integrity rules apply to relationships claims exactly as to findings claims", () => {
  const bundle = makeBundle({ records: [makeRecord({ evidence_id: evidenceId("a") })] });
  const withRelationship = (claim) => ({ ...bare, relationships: [makeClaim({ id: "rel", ...claim })] });

  assert.ok(
    errors(withRelationship({ claim_type: "runtime-behavior", kind: "derived" }), bundle).includes(
      "runtime_claim_without_runtime_authority",
    ),
  );
  assert.ok(
    errors(withRelationship({ claim_type: "source-equivalence" }), bundle).includes(
      "source_equivalence_without_historical_source",
    ),
  );
  assert.ok(
    errors(withRelationship({ evidence_ids: [evidenceId("9")] }), bundle).includes("evidence_not_in_bundle"),
  );
  assert.ok(errors(withRelationship({ evidence_ids: [] }), bundle).includes("claim_without_evidence"));
});

// --- the subject-unavailable warning must mean "no cited record has a subject" ---

test("the subject-unavailable warning fires only when EVERY cited record lacks a subject", () => {
  const mixed = makeBundle({
    records: [
      makeRecord({ evidence_id: evidenceId("1"), subject: null }),
      makeRecord({ evidence_id: evidenceId("2") }),
    ],
  });
  const claim = makeClaim({ evidence_ids: [evidenceId("1"), evidenceId("2")] });
  assert.ok(
    !warnings(makeReport({ ...bare, findings: [claim] }), mixed).includes("evidence_subject_unavailable"),
    "one subjected record is enough to tie the claim to a digest",
  );

  const none = makeBundle({
    records: [
      makeRecord({ evidence_id: evidenceId("1"), subject: null }),
      makeRecord({ evidence_id: evidenceId("2"), subject: null }),
    ],
  });
  assert.ok(
    warnings(makeReport({ ...bare, findings: [makeClaim({ evidence_ids: [evidenceId("1"), evidenceId("2")] })] }), none).includes(
      "evidence_subject_unavailable",
    ),
  );
});

// --- reported paths must survive a non-string entry earlier in the list ---

test("a non-string entry earlier in evidence_ids does not shift the reported index", () => {
  const bundle = makeBundle({
    records: [makeRecord({ evidence_id: evidenceId("a"), subject: { name: "other", digest: { sha256: hex("b") }, format: "pe", architecture: "x86_64", local_path: "other" } })],
  });
  const report = makeReport({
    findings: [makeClaim({ evidence_ids: [42, evidenceId("9"), evidenceId("a")] })],
    summary: { established: [], not_established: [] },
  });
  const issues = checkIntegrity(report, bundle);
  const missing = issues.find((issue) => issue.code === "evidence_not_in_bundle");
  const mismatch = issues.find((issue) => issue.code === "evidence_subject_mismatch");
  assert.equal(missing.path, "findings[0].evidence_ids[1]");
  assert.equal(mismatch.path, "findings[0].evidence_ids[2]");
});

// --- fabrication through the reproduction door ---

test("rejects a fabricated citation in a tool version and in a command", () => {
  const report = makeReport({
    reproduction: {
      environment: [],
      tool_versions: [{ name: "ghidra", version: "12", evidence_ids: [evidenceId("a"), evidenceId("9")] }],
      commands: [{ command: "rea analyze /x", purpose: "look", evidence_ids: [evidenceId("9")] }],
    },
  });
  const issues = checkIntegrity(report, makeBundle());
  assert.equal(issues.filter((issue) => issue.code === "evidence_not_in_bundle").length, 2);
  const paths = issues.filter((issue) => issue.code === "evidence_not_in_bundle").map((issue) => issue.path);
  assert.ok(paths.includes("reproduction.tool_versions[0].evidence_ids[1]"), paths.join(", "));
  assert.ok(paths.includes("reproduction.commands[0].evidence_ids[0]"), paths.join(", "));
});

// --- missing target digest must always warn ---

test("a missing target digest warns whether or not the bundle lists artifacts", () => {
  const report = makeReport();
  delete report.target.artifact_digest;
  assert.ok(warnings(report, makeBundle({ artifacts: [{ digest: { sha256: hex("1") }, format: "pe" }] })).includes("target_digest_missing"));
  assert.ok(warnings(report, makeBundle({ artifacts: [] })).includes("target_digest_missing"));
  // And a report that does supply one is not nagged.
  assert.ok(!warnings(makeReport(), makeBundle()).includes("target_digest_missing"));
});

// --- prefix and casing confusion ---

test("an uppercase or unk_ citation is malformed, never silently accepted", () => {
  const uppercase = makeReport({
    findings: [makeClaim({ evidence_ids: [`ev_${hex("a").toUpperCase()}`] })],
    summary: { established: [], not_established: [] },
  });
  assert.ok(codes(validateReport(uppercase)).includes("evidence_id_malformed"));

  const wrongPrefix = makeReport({
    findings: [makeClaim({ evidence_ids: [unknownId("a")] })],
    summary: { established: [], not_established: [] },
  });
  assert.ok(codes(validateReport(wrongPrefix)).includes("evidence_id_malformed"));

  // The same id shape is valid as an unknown_id on an open question.
  const asUnknown = makeReport({
    ...bare,
    open_questions: [{ id: "q1", question: "q?", status: "open", unknown_id: unknownId("a"), evidence_ids: [] }],
  });
  assert.ok(!codes(validateReport(asUnknown)).includes("open_question_unknown_id_malformed"));
});

// --- summary may name a relationships claim ---

test("summary.established may name a relationships claim", () => {
  const report = makeReport({
    ...bare,
    relationships: [makeClaim({ id: "rel1" })],
    summary: { established: ["rel1"], not_established: [] },
  });
  assert.deepEqual(errors(report, makeBundle()), []);
});

// --- duplicate statements cannot masquerade as corroboration ---

test("two claims with the same statement are flagged", () => {
  const report = makeReport({
    findings: [makeClaim({ id: "f1", evidence_ids: [evidenceId("a")] })],
    relationships: [makeClaim({ id: "r1", evidence_ids: [evidenceId("a")] })],
    summary: { established: ["f1"], not_established: [] },
  });
  assert.ok(warnings(report, makeBundle()).includes("claim_statement_duplicated"));
});

test("distinct statements are not flagged", () => {
  const report = makeReport({
    findings: [makeClaim({ id: "f1", statement: "The header length is validated first." })],
    relationships: [makeClaim({ id: "r1", statement: "The renderer forwards the query over IPC." })],
    summary: { established: ["f1"], not_established: [] },
  });
  assert.ok(!warnings(report, makeBundle()).includes("claim_statement_duplicated"));
});

// --- an open question cannot present a resolved or invented unknown as open ---

test("an open question may not present a resolved or nonexistent unknown as an open gap", () => {
  const resolved = makeBundle({
    unknowns: [{ unknown_id: unknownId("a"), status: "resolved", question: "q?" }],
  });
  const onResolved = makeReport({
    ...bare,
    open_questions: [{ id: "q1", question: "q?", status: "open", unknown_id: unknownId("a"), evidence_ids: [] }],
  });
  assert.ok(errors(onResolved, resolved).includes("open_question_unknown_resolved"));

  const onAbsent = makeReport({
    ...bare,
    open_questions: [{ id: "q1", question: "q?", status: "open", unknown_id: unknownId("b"), evidence_ids: [] }],
  });
  assert.ok(errors(onAbsent, makeBundle()).includes("open_question_unknown_not_in_bundle"));
});

test("a genuine open unknown is accepted", () => {
  const bundle = makeBundle({
    unknowns: [{ unknown_id: unknownId("a"), status: "open", question: "q?" }],
  });
  const report = makeReport({
    ...bare,
    open_questions: [{ id: "q1", question: "q?", status: "open", unknown_id: unknownId("a"), evidence_ids: [] }],
  });
  assert.deepEqual(errors(report, bundle), []);
});