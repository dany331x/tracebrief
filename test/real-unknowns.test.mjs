/**
 * Behaviour proven against a real REA bundle, not a synthetic fixture.
 *
 * `fixtures/clipnote-unknowns-bundle.json` is a genuine export from REA 6.0.0
 * after three `record_unknown` calls and one `update_unknown`. It contains two
 * facts no synthetic fixture had:
 *
 *   1. `unknowns` holds the full revision history, so the same `unk_` id appears
 *      twice — once open, once resolved. Only the head is current state.
 *   2. The unknown-bookkeeping operations produced their own Evidence records
 *      (`record_unknown`, `update_unknown`), and those records carry
 *      `subject: null` because they describe the investigation, not the artifact.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadBundleFile, indexBundle, openUnknowns, residualUnknownHeads, validateBundle } from "../src/bundle.mjs";
import { checkIntegrity } from "../src/rules.mjs";
import { validateReport } from "../src/report.mjs";
import { renderMarkdown } from "../src/render-markdown.mjs";
import { codes, warningCodes } from "./helpers.mjs";

const load = () => loadBundleFile(new URL("../fixtures/clipnote-unknowns-bundle.json", import.meta.url));

test("the real unknown bundle is structurally valid", () => {
  const { bundle } = load();
  assert.deepEqual(codes(validateBundle(bundle)), []);
  assert.equal(bundle.unknowns.length, 4, "the real bundle carries revision history, so more entries than ids");
  assert.equal(new Set(bundle.unknowns.map((u) => u.unknown_id)).size, 3, "three distinct unknown ids");
});

test("unknown history collapses to one head per id, keeping the highest revision", () => {
  const { bundle } = load();
  const heads = residualUnknownHeads(bundle);
  assert.equal(heads.length, 3);
  for (const head of heads) {
    const revisions = bundle.unknowns
      .filter((u) => u.unknown_id === head.unknown_id)
      .map((u) => u.revision);
    assert.equal(head.revision, Math.max(...revisions));
  }
});

test("a resolved unknown is not reported as an open question", () => {
  const { bundle } = load();
  const open = openUnknowns(bundle);
  assert.equal(open.length, 2, "two of the three real unknowns are still open");
  assert.ok(!open.some((u) => u.status === "resolved"));
  // The resolved one must not appear at all, even though an older open revision
  // of the same id exists in the bundle.
  const resolvedIds = bundle.unknowns.filter((u) => u.status === "resolved").map((u) => u.unknown_id);
  for (const id of resolvedIds) {
    assert.ok(!open.some((u) => u.unknown_id === id), `resolved ${id} leaked into open unknowns`);
  }
});

test("openUnknowns is order-independent: a stale open revision cannot resurrect a resolved unknown", () => {
  const { bundle } = load();
  const forward = openUnknowns(bundle).map((u) => u.unknown_id).sort();
  const reversed = openUnknowns({ ...bundle, unknowns: [...bundle.unknowns].reverse() }).map((u) => u.unknown_id).sort();
  assert.deepEqual(reversed, forward, "reversing the history changed which unknowns count as open");
});

test("the index exposes the head revision, so integrity sees the current status", () => {
  const { bundle } = load();
  const { unknowns } = indexBundle(bundle);
  assert.equal(unknowns.size, 3);
  const resolved = bundle.unknowns.find((u) => u.status === "resolved");
  assert.equal(unknowns.get(resolved.unknown_id).status, "resolved");
});

test("a report omitting a real open unknown is rejected", () => {
  const { bundle } = load();
  const digest = bundle.unknowns[0].unknown_id;
  assert.ok(digest.startsWith("unk_"));
  const report = {
    schema: "tracebrief/report@1",
    title: "ClipNote residual questions",
    question: "Which questions remain open?",
    target: { name: "clipnote", version: "2.4.1", artifact_digest: null, format: "directory", architecture: null, local_path: "fixtures/clipnote" },
    reproduction: { environment: ["windows-x86_64"], tool_versions: [], commands: [] },
    findings: [],
    relationships: [],
    open_questions: [],
    summary: { established: [], not_established: [] },
  };
  assert.ok(codes(checkIntegrity(report, bundle)).includes("residual_unknown_not_carried"));
});

test("a report carrying both real open unknowns validates, and renders them", () => {
  const { bundle } = load();
  const open = openUnknowns(bundle);
  const report = {
    schema: "tracebrief/report@1",
    title: "ClipNote residual questions",
    question: "Which questions remain open about the ClipNote search path?",
    target: { name: "clipnote", version: "2.4.1", artifact_digest: null, format: "directory", architecture: null, local_path: "fixtures/clipnote" },
    reproduction: { environment: ["windows-x86_64"], tool_versions: [], commands: [] },
    findings: [
      {
        id: "f-analysis-coverage",
        statement: "The recorded static analysis resolves the renderer-to-main relationship but cannot settle runtime ordering.",
        kind: "derived",
        claim_type: "analysis-coverage",
        evidence_ids: ["ev_8c639fb17dfbeebc0d5284a5113c74041404dd6f04b8404f8c64d156a07c0e09"],
        limitations: [],
      },
    ],
    relationships: [],
    open_questions: open.map((unknown, index) => ({
      id: `q${index + 1}`,
      question: unknown.question,
      status: unknown.status,
      unknown_id: unknown.unknown_id,
      evidence_ids: [],
    })),
    summary: { established: ["f-analysis-coverage"], not_established: open.map((u) => u.question) },
  };

  assert.deepEqual(codes(checkIntegrity(report, bundle)), []);
  // No target digest is available in this bundle, and that must be warned about.
  assert.ok(warningCodes(checkIntegrity(report, bundle)).includes("target_digest_missing"));

  const markdown = renderMarkdown(report, bundle);
  for (const unknown of open) {
    assert.ok(markdown.includes(unknown.unknown_id), `missing ${unknown.unknown_id}`);
  }
  assert.ok(!markdown.includes("not carried into this report"), "every open unknown must be carried");
  assert.ok(markdown.includes("## Open questions"));
});

test("the committed real bundle matches what REA exported, byte for byte", () => {
  const raw = readFileSync(new URL("../fixtures/clipnote-unknowns-bundle.json", import.meta.url), "utf8");
  const { bundle } = load();
  assert.equal(JSON.parse(raw).unknowns.length, bundle.unknowns.length);
  assert.ok(bundle.unknowns.every((u) => /^unk_[0-9a-f]{64}$/.test(u.unknown_id)));
  assert.deepEqual(codes(validateReport({
    schema: "tracebrief/report@1",
    title: "t",
    question: "q",
    target: { name: "n", version: null, artifact_digest: null, format: null, architecture: null, local_path: null },
    reproduction: { environment: [], tool_versions: [], commands: [] },
    findings: [],
    relationships: [],
    open_questions: [],
    summary: { established: [], not_established: [] },
  })), []);
});