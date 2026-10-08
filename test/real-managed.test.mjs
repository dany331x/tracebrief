/**
 * Behaviour proven against a real managed-assembly bundle.
 *
 * `fixtures/system-data-bundle.json` is a genuine REA 6.0.0 export of
 * `inspect_managed_artifact` against C:\Windows\Microsoft.NET\Framework64\v4.0.30319\
 * System.Data.dll, exported in the same session as the residual-unknown records.
 * That makes it a genuinely mixed bundle, which is the case that distinguishes
 * an "all cited records" rule from an "any cited record" one.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBundleFile, indexBundle, openUnknowns, validateBundle } from "../src/bundle.mjs";
import { checkIntegrity } from "../src/rules.mjs";
import { validateReport } from "../src/report.mjs";
import { renderMarkdown } from "../src/render-markdown.mjs";
import { codes, warningCodes } from "./helpers.mjs";

const load = () => loadBundleFile(new URL("../fixtures/system-data-bundle.json", import.meta.url));
const MANAGED_RECORD = "ev_c9006a69559941e1170f17d928ec24a647bea5b875dafc8cb5629d7da656e583";
const SUBJECTLESS_RECORD = "ev_8c639fb17dfbeebc0d5284a5113c74041404dd6f04b8404f8c64d156a07c0e09";

const baseReport = (overrides = {}) => ({
  schema: "tracebrief/report@1",
  title: "System.Data managed inspection",
  question: "Is System.Data.dll managed, and what does its metadata declare?",
  target: {
    name: "System.Data.dll",
    version: "4.0.0.0",
    artifact_digest: "44ef042fa9fbca676466cf9ddd7541ec00c8887c10672880702cc5a4a8182606",
    format: "pe",
    architecture: "x86_64",
    local_path: "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/System.Data.dll",
  },
  reproduction: { environment: ["windows-x86_64"], tool_versions: [], commands: [] },
  findings: [],
  relationships: [],
  open_questions: [
    { id: "q1", question: "Does the ClipNote renderer reach the main process at runtime?", status: "open", unknown_id: "unk_2fece72eef45972af3918adc9a78f9dbf6f7ad8b26143ad184a68e5c9c811f30", evidence_ids: [] },
    { id: "q2", question: "Are contextIsolation and nodeIntegration enforced at runtime?", status: "open", unknown_id: "unk_f9b1ddb7fd9340265a8cfcb053e386d712ae7fada843f553b46aba5c636e9263", evidence_ids: [] },
  ],
  summary: { established: [], not_established: [] },
  ...overrides,
});

test("the real managed bundle is structurally valid and mixed", () => {
  const { bundle } = load();
  assert.deepEqual(codes(validateBundle(bundle)), []);
  const { records } = indexBundle(bundle);
  const withSubject = [...records.values()].filter((r) => r.subject != null);
  const without = [...records.values()].filter((r) => r.subject == null);
  assert.equal(withSubject.length, 1, "the managed PE record is the only one with a subject");
  assert.ok(without.length >= 4, "the registry records carry no subject");
});

test("the managed record declares mixed location kinds, all file-based", () => {
  const { bundle } = load();
  const record = bundle.records.find((r) => r.operation === "inspect_managed_artifact");
  const kinds = record.locations.map((l) => l.kind).sort();
  assert.deepEqual(kinds, ["file-offset", "file-offset", "file-offset-range"]);
  assert.ok(record.locations.every((l) => !("address" in l)), "no memory-address locations on this target");
});

test("a claim citing only the managed record produces no subject warning", () => {
  const { bundle } = load();
  const report = baseReport({
    findings: [
      { id: "f1", statement: "The image is managed with a mixed native/CLR runtime family.", kind: "observed", claim_type: "structure", evidence_ids: [MANAGED_RECORD], limitations: [] },
    ],
    summary: { established: ["f1"], not_established: [] },
  });
  const found = warningCodes(checkIntegrity(report, bundle));
  assert.ok(!found.includes("evidence_subject_unavailable"));
  assert.deepEqual(codes(checkIntegrity(report, bundle)), []);
});

test("a claim citing both a subject-bearing and a subject-less record does not warn", () => {
  // This is the case that separates "every cited record" from "any cited record":
  // one record ties the claim to an artifact digest, so the claim can be tied.
  const { bundle } = load();
  const report = baseReport({
    findings: [
      { id: "f1", statement: "The managed inspection was recorded alongside the investigation's registry bookkeeping.", kind: "observed", claim_type: "structure", evidence_ids: [SUBJECTLESS_RECORD, MANAGED_RECORD], limitations: [] },
    ],
    summary: { established: ["f1"], not_established: [] },
  });
  assert.ok(
    !warningCodes(checkIntegrity(report, bundle)).includes("evidence_subject_unavailable"),
    "a single subject-bearing record is enough",
  );
});

test("a claim citing only subject-less records does warn", () => {
  const { bundle } = load();
  const report = baseReport({
    findings: [
      { id: "f1", statement: "Three questions were registered in the residual-unknown registry.", kind: "observed", claim_type: "structure", evidence_ids: [SUBJECTLESS_RECORD], limitations: [] },
    ],
    summary: { established: ["f1"], not_established: [] },
  });
  assert.ok(warningCodes(checkIntegrity(report, bundle)).includes("evidence_subject_unavailable"));
});

test("mixed location kinds render as one readable cell", () => {
  const { bundle } = load();
  const report = baseReport({
    findings: [
      { id: "f1", statement: "The image is managed with a mixed native/CLR runtime family.", kind: "observed", claim_type: "structure", evidence_ids: [MANAGED_RECORD], limitations: [] },
    ],
    summary: { established: ["f1"], not_established: [] },
  });
  const markdown = renderMarkdown(report, bundle);
  const row = markdown.split("\n").find((line) => line.startsWith("| `ev_c9006"));
  assert.ok(row.includes("offsets 1513912-1513984"));
  assert.ok(row.includes("offset 1893668"));
  assert.ok(row.includes("offset 2585272"));
  assert.equal((row.match(/(?<!\\)\|/g) ?? []).length, 8, "seven columns plus leading and trailing pipes");
});

test("the resolved unknown from the earlier investigation is still not demanded", () => {
  const { bundle } = load();
  const resolved = bundle.unknowns.find((u) => u.status === "resolved");
  assert.ok(resolved, "the mixed bundle still carries the resolved revision");
  assert.equal(openUnknowns(bundle).length, 2);
  // The report carries the two open ones and omits the resolved one.
  assert.deepEqual(codes(checkIntegrity(baseReport(), bundle)), []);
});

test("the committed managed report validates and renders", async () => {
  const { readFileSync } = await import("node:fs");
  const report = JSON.parse(
    readFileSync(new URL("../fixtures/report.system-data.json", import.meta.url), "utf8"),
  );
  const { bundle } = load();
  assert.deepEqual(codes(validateReport(report)), []);
  assert.deepEqual(codes(checkIntegrity(report, bundle, { bundleDigest: report.bundle_digest })), []);
  const markdown = renderMarkdown(report, bundle, { bundleDigest: report.bundle_digest });
  assert.ok(markdown.includes("## Evidence index"));
  assert.ok(markdown.includes("mixed-clr-native") || markdown.includes("mixed native/CLR"));
});