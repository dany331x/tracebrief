import assert from "node:assert/strict";
import { test } from "node:test";
import { validateReport } from "../src/report.mjs";
import { evidenceId, makeClaim, makeReport } from "./helpers.mjs";

const errorCodes = (report) =>
  validateReport(report)
    .filter((issue) => issue.level === "error")
    .map((issue) => issue.code);

test("accepts a well-formed report", () => {
  assert.deepEqual(errorCodes(makeReport()), []);
});

test("requires every top-level section", () => {
  const report = makeReport();
  delete report.reproduction;
  delete report.open_questions;
  const codes = errorCodes(report);
  assert.ok(codes.includes("report_key_missing"));
  assert.equal(codes.filter((code) => code === "report_key_missing").length, 2);
});

test("rejects a wrong schema tag", () => {
  assert.ok(errorCodes(makeReport({ schema: "tracebrief/report@2" })).includes("report_schema_mismatch"));
});

test("rejects unknown claim kinds and claim types", () => {
  assert.ok(errorCodes(makeReport({ findings: [makeClaim({ kind: "probably" })] })).includes("claim_kind_invalid"));
  assert.ok(
    errorCodes(makeReport({ findings: [makeClaim({ claim_type: "vibes-based" })] })).includes("claim_type_invalid"),
  );
});

test("rejects duplicate claim ids across sections", () => {
  const report = makeReport({
    findings: [makeClaim({ id: "dup" })],
    relationships: [makeClaim({ id: "dup" })],
    summary: { established: ["dup"], not_established: [] },
  });
  assert.ok(errorCodes(report).includes("claim_id_duplicated"));
});

test("requires evidence_ids to exist even when empty", () => {
  const claim = makeClaim();
  delete claim.evidence_ids;
  assert.ok(errorCodes(makeReport({ findings: [claim] })).includes("evidence_ids_missing"));
});

test("rejects a malformed citation", () => {
  assert.ok(
    errorCodes(makeReport({ findings: [makeClaim({ evidence_ids: ["ev_1234"] })] })).includes("evidence_id_malformed"),
  );
});

test("rejects a malformed target digest", () => {
  const report = makeReport();
  report.target.artifact_digest = "not-a-digest";
  assert.ok(errorCodes(report).includes("target_digest_malformed"));
});

test("rejects a summary that establishes a claim which does not exist", () => {
  const report = makeReport({ summary: { established: ["ghost"], not_established: [] } });
  assert.ok(errorCodes(report).includes("summary_claim_unknown"));
});

test("accepts null target fields as not collected", () => {
  const report = makeReport();
  report.target.version = null;
  report.target.local_path = null;
  assert.deepEqual(errorCodes(report), []);
});

test("rejects a bad open question status and unknown id", () => {
  const report = makeReport({
    open_questions: [
      { id: "q1", question: "Which entry point runs first?", status: "maybe", evidence_ids: [], unknown_id: "unk_short" },
    ],
  });
  const codes = errorCodes(report);
  assert.ok(codes.includes("open_question_status_invalid"));
  assert.ok(codes.includes("open_question_unknown_id_malformed"));
});

test("warns about unknown top-level keys instead of failing", () => {
  const report = makeReport({ extra: true });
  const warnings = validateReport(report)
    .filter((issue) => issue.level === "warning")
    .map((issue) => issue.code);
  assert.ok(warnings.includes("report_key_unknown"));
});

test("a report citing a nonexistent id still passes structural validation", () => {
  const report = makeReport({ findings: [makeClaim({ evidence_ids: [evidenceId("9")] })] });
  assert.deepEqual(errorCodes(report), []);
});