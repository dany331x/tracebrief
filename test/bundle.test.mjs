import assert from "node:assert/strict";
import { test } from "node:test";
import { indexBundle, loadBundleFile, openUnknowns, validateBundle } from "../src/bundle.mjs";
import { TARGET_DIGEST, evidenceId, hex, makeBundle, makeRecord, unknownId } from "./helpers.mjs";

test("accepts a well-formed bundle", () => {
  const issues = validateBundle(makeBundle());
  assert.deepEqual(issues.filter((issue) => issue.level === "error"), []);
});

test("rejects a bundle that is missing a REA array", () => {
  const bundle = makeBundle();
  delete bundle.unknowns;
  const issues = validateBundle(bundle);
  assert.ok(issues.some((issue) => issue.code === "bundle_missing_array" && issue.path === "unknowns"));
});

test("rejects malformed and duplicated evidence ids", () => {
  const bundle = makeBundle({
    records: [makeRecord({ evidence_id: "ev_nothex" }), makeRecord({ evidence_id: evidenceId("a") }), makeRecord({ evidence_id: evidenceId("a") })],
  });
  const codes = issues => issues.filter(i => i.level === "error").map(i => i.code);
  const found = codes(validateBundle(bundle));
  assert.ok(found.includes("record_id_malformed"));
  assert.ok(found.includes("record_id_duplicated"));
});

test("rejects confidence and authority outside REA's vocabulary", () => {
  const bundle = makeBundle({
    records: [makeRecord({ confidence: "pretty-sure" }), makeRecord({ evidence_id: evidenceId("b"), authority: "vibes" })],
  });
  const codes = validateBundle(bundle).map((issue) => issue.code);
  assert.ok(codes.includes("record_confidence_invalid"));
  assert.ok(codes.includes("record_authority_invalid"));
});

test("indexes records, unknowns and artifacts", () => {
  const bundle = makeBundle({
    records: [makeRecord({ evidence_id: evidenceId("a") })],
    unknowns: [{ unknown_id: unknownId("u"), revision: 1, status: "open", question: "q?" }],
  });
  const index = indexBundle(bundle);
  assert.equal(index.records.size, 1);
  assert.equal(index.unknowns.size, 1);
  assert.ok(index.artifacts.has(TARGET_DIGEST));
  assert.equal(openUnknowns(bundle).length, 1);
});

test("openUnknowns excludes resolved questions", () => {
  const bundle = makeBundle({
    unknowns: [
      { unknown_id: unknownId("u"), status: "resolved", question: "q?" },
      { unknown_id: unknownId("v"), status: "blocked", question: "q2?" },
    ],
  });
  assert.deepEqual(
    openUnknowns(bundle).map((unknown) => unknown.unknown_id),
    [unknownId("v")],
  );
});

test("loads a file and pins its digest", () => {
  const path = new URL("../fixtures/clipnote-bundle.json", import.meta.url);
  const { bundle, digest, bytes } = loadBundleFile(path);
  assert.equal(digest.length, 64);
  assert.ok(bytes > 0);
  assert.equal(validateBundle(bundle).filter((i) => i.level === "error").length, 0);
});

test("the shipped REA fixture bundle carries only REA vocabulary", () => {
  const { bundle } = loadBundleFile(new URL("../fixtures/clipnote-bundle.json", import.meta.url));
  for (const record of bundle.records) {
    assert.match(record.evidence_id, /^ev_[0-9a-f]{64}$/);
    assert.ok(["observed", "derived", "inferred"].includes(record.confidence));
    assert.ok(
      [
        "shipped-artifact",
        "controlled-replay",
        "historical-reference",
        "external-service",
        "analyst-inference",
      ].includes(record.authority),
    );
  }
  assert.ok(hex("f").length === 64);
});