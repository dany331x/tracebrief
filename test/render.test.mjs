import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../src/render-markdown.mjs";
import { evidenceId, makeBundle, makeClaim, makeRecord, makeReport, unknownId } from "./helpers.mjs";

const render = (report, bundle, options) => renderMarkdown(report, bundle, options);

test("renders every required section heading", () => {
  const markdown = render(makeReport(), makeBundle());
  for (const heading of [
    "## Investigation question",
    "## Target overview",
    "## Key findings",
    "## Relationships",
    "## Confidence and limitations",
    "## Reproduction",
    "## Open questions",
    "## Summary",
    "## Evidence index",
  ]) {
    assert.ok(markdown.includes(heading), `missing heading ${heading}`);
  }
});

test("is deterministic for identical inputs", () => {
  const report = makeReport();
  const bundle = makeBundle();
  assert.equal(render(report, bundle), render(report, bundle));
});

test("marks unavailable sections as not collected instead of omitting them", () => {
  const report = makeReport({ findings: [], relationships: [], open_questions: [], summary: { established: [], not_established: [] } });
  const markdown = render(report, makeBundle());
  assert.ok(markdown.includes("_Not collected._"));
  assert.ok(markdown.includes("**Version:** 1.2.3"));
});

test("renders null target fields as unknown", () => {
  const report = makeReport();
  report.target.version = null;
  const markdown = render(report, makeBundle());
  assert.ok(markdown.includes("**Version:** unknown — not collected"));
});

test("prints short refs in prose and the full id in the index", () => {
  const markdown = render(makeReport(), makeBundle());
  assert.ok(markdown.includes("`ev_aaaaaaaaaaaa…`"));
  assert.ok(markdown.includes(`\`${evidenceId("a")}\``));
});

test("marks missing evidence loudly rather than dropping it", () => {
  const report = makeReport({ findings: [makeClaim({ evidence_ids: [evidenceId("9")] })] });
  const markdown = render(report, makeBundle());
  assert.ok(markdown.includes("missing from bundle"));
});

test("escapes pipes so table cells cannot break", () => {
  const bundle = makeBundle({
    records: [
      makeRecord({
        locations: [{ kind: "artifact-path", path: "C:\\a|b\\target.exe" }],
      }),
    ],
  });
  const markdown = render(makeReport(), bundle);
  const row = markdown.split("\n").find((line) => line.startsWith("| `ev_"));
  assert.ok(row.includes("C:\\\\a\\|b\\\\target.exe"));
  // 7 columns => 8 unescaped pipes (leading, 6 separators, trailing); the
// escaped pipe inside the path must not be counted as a cell break.
assert.equal((row.match(/(?<!\\)\|/g) ?? []).length, 8);
});

test("never inlines raw_result into the report", () => {
  const markdown = render(makeReport(), makeBundle());
  assert.ok(!markdown.includes("raw payload"));
});

test("lists carried limitations once, sorted", () => {
  const bundle = makeBundle({
    records: [makeRecord({ limitations: ["Zeta limit.", "Alpha limit."] })],
  });
  const report = makeReport({ findings: [makeClaim({ limitations: ["Alpha limit.", "Zeta limit."] })] });
  const markdown = render(report, bundle);
  const first = markdown.indexOf("- Alpha limit.");
  const second = markdown.indexOf("- Zeta limit.");
  assert.ok(first > 0 && second > first);
  assert.equal(markdown.split("Alpha limit.").length - 1, 2);
});

test("surfaces bundle residual unknowns the report did not carry", () => {
  const bundle = makeBundle({
    unknowns: [{ unknown_id: unknownId("u"), status: "blocked", question: "Which variant?" }],
  });
  const markdown = render(makeReport(), bundle);
  assert.ok(markdown.includes("not carried into this report"));
  assert.ok(markdown.includes("Which variant?"));
});

test("counts real confidence and authority values, never a placeholder", () => {
  const markdown = render(makeReport(), makeBundle());
  assert.ok(markdown.includes("**Confidence of cited evidence:** observed 1"));
  assert.ok(markdown.includes("**Authority of cited evidence:** shipped-artifact 1"));
  assert.ok(!markdown.includes("**Confidence of cited evidence:** unknown"));
});

test("keeps every table row on one line", () => {
  const markdown = render(makeReport(), makeBundle());
  const tableRows = markdown.split("\n").filter((line) => line.startsWith("| "));
  for (const row of tableRows) {
    assert.ok(row.includes("|"), "table row lost its closing cell");
  }
  const toolRows = markdown
    .split("\n")
    .filter((line) => line.startsWith("| test-provider"));
  assert.equal(toolRows.length, 1);
  assert.ok(toolRows[0].includes(evidenceId("a")));
});

test("reports missing evidence inline instead of leaving an empty cell", () => {
  const markdown = render(
    makeReport({
      reproduction: { environment: [], tool_versions: [{ name: "ghidra", version: null, evidence_ids: [] }], commands: [] },
    }),
    makeBundle(),
  );
  assert.ok(markdown.includes("| ghidra | unknown | none cited |"));
});

test("renders evidence links after the table, never inside a row", () => {
  const bundle = makeBundle({ records: [makeRecord({ evidence_links: [evidenceId("b")] })] });
  const markdown = render(makeReport(), bundle);
  const linkLine = markdown.split("\n").find((line) => line.includes("Evidence links"));
  assert.ok(linkLine.startsWith("Evidence links"));
  const indexStart = markdown.indexOf("## Evidence index");
  const tableEnd = markdown.indexOf("Bundle digest");
  assert.ok(markdown.indexOf("Evidence links") > tableEnd);
  void indexStart;
});

test("marks uncited reproduction commands explicitly", () => {
  const markdown = render(makeReport(), makeBundle());
  assert.ok(markdown.includes("(no evidence cited)"));
});

test("records the bundle digest when supplied", () => {
  const markdown = render(makeReport(), makeBundle(), { bundleDigest: "a".repeat(64) });
  assert.ok(markdown.includes("Bundle digest (sha256 of the exported file)"));
});