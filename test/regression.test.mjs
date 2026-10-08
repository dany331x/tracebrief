/**
 * Regression tests for defects found in adversarial review.
 *
 * Every test here corresponds to a real crash, bypass or silent-failure
 * reproduced against this code before the fix. They are grouped by the review
 * finding they close.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadBundleFile, parseJsonText, validateBundle } from "../src/bundle.mjs";
import { validateReport } from "../src/report.mjs";
import { checkIntegrity } from "../src/rules.mjs";
import { renderMarkdown } from "../src/render-markdown.mjs";
import { TARGET_DIGEST, evidenceId, hex, makeBundle, makeClaim, makeRecord, makeReport } from "./helpers.mjs";

const CLI = fileURLToPath(new URL("../bin/tracebrief.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "tracebrief-regression-"));

const writeJson = (name, value) => {
  const path = join(dir, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2), "utf8");
  return path;
};

const run = (args) => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
};

const errorCodes = (issues) => issues.filter((i) => i.level === "error").map((i) => i.code);
const warnCodes = (issues) => issues.filter((i) => i.level === "warning").map((i) => i.code);

// --- bundle layer: malformed collections must report, never crash ---

test("regression: a non-array records field is reported, not thrown on", () => {
  for (const bad of [{}, "x", 5, null, true]) {
    const issues = validateBundle(makeBundle({ records: bad }));
    assert.ok(errorCodes(issues).includes("bundle_missing_array"), `records=${JSON.stringify(bad)}`);
  }
});

test("regression: a non-array unknowns field is reported, not thrown on", () => {
  for (const bad of [{}, "x", 7]) {
    const issues = validateBundle(makeBundle({ unknowns: bad }));
    assert.ok(errorCodes(issues).includes("bundle_missing_array"));
  }
});

test("regression: malformed locations are rejected before rendering", () => {
  for (const bad of [{}, "addr", 5]) {
    const issues = validateBundle(makeBundle({ records: [makeRecord({ locations: bad })] }));
    assert.ok(errorCodes(issues).includes("record_locations_invalid"), `locations=${JSON.stringify(bad)}`);
  }
});

test("regression: a location missing its required field is rejected", () => {
  const issues = validateBundle(
    makeBundle({ records: [makeRecord({ locations: [{ kind: "address" }] })] }),
  );
  assert.ok(errorCodes(issues).includes("record_location_field_missing"));
});

test("regression: an unknown location kind is rejected", () => {
  const issues = validateBundle(
    makeBundle({ records: [makeRecord({ locations: [{ kind: "telepathy", address: "0x1" }] })] }),
  );
  assert.ok(errorCodes(issues).includes("record_location_kind_unknown"));
});

test("regression: a non-object record subject is rejected", () => {
  const issues = validateBundle(makeBundle({ records: [makeRecord({ subject: "garbage" })] }));
  assert.ok(errorCodes(issues).includes("record_subject_invalid"));
});

test("regression: rendering malformed locations does not crash", () => {
  const markdown = renderMarkdown(makeReport(), makeBundle({ records: [makeRecord({ locations: {} })] }));
  assert.ok(markdown.includes("none recorded"));
});

// --- CLI: bundle I/O failures are exit 2, not stack traces ---

test("regression: a missing bundle exits 2 with a clean message", () => {
  for (const command of ["validate", "index"]) {
    const args =
      command === "validate"
        ? ["validate", "--report", writeJson("r.json", makeReport()), "--bundle", join(dir, "nope.json")]
        : ["index", "--bundle", join(dir, "nope.json")];
    const outcome = run(args);
    assert.equal(outcome.code, 2, `${command} should exit 2`);
    assert.match(outcome.stderr, /cannot read bundle/);
    assert.doesNotMatch(outcome.stderr, /at Object|at Module|\.mjs:\d+/);
  }
});

test("regression: an unparseable bundle exits 2, not 1", () => {
  const outcome = run(["index", "--bundle", writeJson("bad.json", "{oops")]);
  assert.equal(outcome.code, 2);
  assert.match(outcome.stderr, /cannot read bundle/);
  assert.doesNotMatch(outcome.stderr, /SyntaxError/);
});

test("regression: a UTF-8 BOM on either input file is tolerated", () => {
  const report = writeJson("bom-report.json", `\uFEFF${JSON.stringify(makeReport())}`);
  const bundle = writeJson("bom-bundle.json", `\uFEFF${JSON.stringify(makeBundle())}`);
  const outcome = run(["validate", "--report", report, "--bundle", bundle]);
  assert.equal(outcome.code, 0);
  assert.match(outcome.stdout, /TraceBrief valid/);
  assert.ok(parseJsonText(`\uFEFF{"a":1}`, "x").a === 1);
});

test("regression: --help and -h print usage and exit 0", () => {
  for (const flag of ["--help", "-h"]) {
    const outcome = run([flag]);
    assert.equal(outcome.code, 0, flag);
    assert.match(outcome.stdout, /Usage:/);
  }
  assert.equal(run(["help"]).code, 0);
});

test("regression: a value flag with no value exits 2, not a TypeError", () => {
  const outcome = run(["validate", "--bundle", "--json"]);
  assert.equal(outcome.code, 2);
  assert.match(outcome.stderr, /option --bundle requires a value/);
});

test("regression: unknown flags and misplaced flags are rejected", () => {
  assert.equal(run(["validate", "--report", writeJson("r.json", makeReport()), "--bundle", writeJson("b.json", makeBundle()), "--verbose"]).code, 2);
  assert.equal(run(["validate", "--report", writeJson("r.json", makeReport()), "--bundle", writeJson("b.json", makeBundle()), "--out", "x.md"]).code, 2);
  assert.equal(run(["index", "--report", "x.json", "--bundle", writeJson("b.json", makeBundle())]).code, 2);
});

test("regression: index on a bundle with a null record reports, never throws", () => {
  const outcome = run(["index", "--bundle", writeJson("nullrec.json", makeBundle({ records: [null] }))]);
  assert.equal(outcome.code, 1);
  assert.match(outcome.stderr, /record_not_object/);
});

// --- rules: silent-failure and bypass fixes ---

test("regression: omitting the target digest warns that verification is off", () => {
  const report = makeReport();
  delete report.target.artifact_digest;
  assert.ok(warnCodes(checkIntegrity(report, makeBundle())).includes("target_digest_missing"));
});

test("regression: issue paths point at the citation index the author wrote", () => {
  const other = hex("b");
  const bundle = makeBundle({
    records: [
      makeRecord({ evidence_id: evidenceId("a") }),
      makeRecord({
        evidence_id: evidenceId("b"),
        subject: { name: "other.exe", digest: { sha256: other }, format: "pe", architecture: "x86_64", local_path: "other.exe" },
        evidence_links: [evidenceId("8")],
      }),
    ],
  });
  const report = makeReport({
    findings: [makeClaim({ evidence_ids: [evidenceId("9"), evidenceId("a"), evidenceId("b")] })],
    summary: { established: [], not_established: [] },
  });
  const issues = checkIntegrity(report, bundle);
  const mismatch = issues.find((i) => i.code === "evidence_subject_mismatch");
  const link = issues.find((i) => i.code === "evidence_link_unresolved");
  // ev_999… is index 0, ev_bbb… is index 2.
  assert.match(mismatch.path, /evidence_ids\[2\]$/);
  assert.match(link.path, /evidence_ids\[2\]$/);
});

test("regression: unrelated limitation text does not count as acknowledgement", () => {
  const bundle = makeBundle({ records: [makeRecord({ limitations: ["Coverage is partial."] })] });
  const unrelated = makeReport({ findings: [makeClaim({ limitations: ["totally unrelated text"] })] });
  assert.ok(warnCodes(checkIntegrity(unrelated, bundle)).includes("claim_limitations_not_carried"));
  const blank = makeReport({ findings: [makeClaim({ limitations: [""] })] });
  assert.ok(warnCodes(checkIntegrity(blank, bundle)).includes("claim_limitations_not_carried"));
});

test("regression: an empty-string limitation is a schema error", () => {
  const report = makeReport({ findings: [makeClaim({ limitations: ["  "] })] });
  assert.ok(errorCodes(validateReport(report)).includes("claim_limitation_empty"));
});

test("regression: quoting a carried limitation clears the warning", () => {
  const bundle = makeBundle({ records: [makeRecord({ limitations: ["Coverage is partial."] })] });
  const good = makeReport({
    findings: [makeClaim({ limitations: ["Coverage  is partial."] })],
  });
  assert.ok(!warnCodes(checkIntegrity(good, bundle)).includes("claim_limitations_not_carried"));
});

// --- renderer: authored text cannot inject document structure ---

/** Every heading line the renderer itself emits, at any given report shape. */
const RENDERER_HEADINGS = [
  "## Investigation question",
  "## Target overview",
  "## Key findings",
  "## Relationships",
  "## Confidence and limitations",
  "## Reproduction",
  "### Environment",
  "### Tools",
  "### Commands",
  "## Open questions",
  "## Summary",
  "### Established",
  "### Not established",
  "## Evidence index",
];

const headingLines = (markdown) =>
  markdown.split("\n").filter((line) => /^#{1,6} /.test(line));

test("regression: a claim statement cannot inject a heading", () => {
  const report = makeReport({
    findings: [
      makeClaim({ statement: "Claim statement\n## Injected Findings Heading\n- injected" }),
    ],
  });
  const markdown = renderMarkdown(report, makeBundle());
  const lines = markdown.split("\n");
  // The renderer owns the document outline: every heading is either a known
  // renderer heading, the title, or a numbered claim heading.
  for (const line of headingLines(markdown)) {
    assert.ok(
      RENDERER_HEADINGS.includes(line) || line.startsWith("# ") || /^### \d+\. /.test(line),
      `unexpected heading line: ${line}`,
    );
  }
  assert.equal(headingLines(markdown).length, RENDERER_HEADINGS.length + 1 + 1);
  // The injected text survives as flattened, escaped content inside the
  // renderer's own claim heading, and never as a heading or list item.
  // Authored text is flattened to one line; mid-line "#" and "-" are inert and
  // deliberately not backslash-escaped, so the text stays readable.
  assert.ok(markdown.includes("Claim statement ## Injected Findings Heading - injected"));
  assert.ok(!lines.some((line) => line === "## Injected Findings Heading"));
  assert.ok(!lines.some((line) => /^-\s+injected/.test(line)));
});

test("regression: title, question and prose cannot inject structure", () => {
  const report = makeReport({
    title: "Title\n# Injected top-level heading",
    question: "Question?\n\n## Injected section\n- bullet",
    open_questions: [{ id: "q", question: "Q?\n## Injected", status: "open", evidence_ids: [] }],
    summary: { established: ["c1"], not_established: ["nope: A\n| a | b |"] },
  });
  const markdown = renderMarkdown(report, makeBundle());
  const lines = markdown.split("\n");
  // Exactly the renderer's outline plus the title and the one fixture claim:
  // no extra heading can appear from title, question or any prose field.
  assert.equal(headingLines(markdown).length, RENDERER_HEADINGS.length + 2);
  assert.equal(lines.filter((line) => line.startsWith("# ")).length, 1);
  assert.equal(lines.filter((line) => line === "| a | b |").length, 0);
  assert.ok(markdown.includes("\\| a \\| b \\|"));
});

test("regression: a backtick in a command cannot break the code span", () => {
  const report = makeReport({
    reproduction: {
      environment: [],
      tool_versions: [],
      commands: [{ command: "rea analyze `/x`", purpose: "look", evidence_ids: [] }],
    },
  });
  const markdown = renderMarkdown(report, makeBundle());
  const line = markdown.split("\n").find((l) => l.includes("rea analyze"));
  assert.ok(line.includes("rea analyze '/x'"));
});

test("regression: kind unknown is always rendered", () => {
  const report = makeReport({
    findings: [makeClaim({ id: "u1", kind: "unknown", claim_type: "structure", evidence_ids: [] })],
    summary: { established: [], not_established: [] },
  });
  const markdown = renderMarkdown(report, makeBundle());
  assert.ok(markdown.includes("**Kind:** unknown"));
  assert.ok(markdown.includes("**Type:** structure"));
});

test("regression: null claim and question entries degrade instead of crashing", () => {
  const report = makeReport({
    findings: [null],
    relationships: [null],
    open_questions: [null],
    reproduction: { environment: [null], tool_versions: [null], commands: [null] },
  });
  const markdown = renderMarkdown(report, makeBundle());
  assert.ok(markdown.includes("Claim statement missing."));
});

test("regression: rendering a null bundle does not crash", () => {
  const markdown = renderMarkdown(makeReport(), null);
  assert.ok(markdown.includes("TraceBrief report") || markdown.includes("#"));
});

test("regression: an unchecked citation in the tools table is marked missing", () => {
  const report = makeReport({
    reproduction: {
      environment: [],
      tool_versions: [{ name: "ghidra", version: "12.1.4", evidence_ids: [evidenceId("9")] }],
      commands: [],
    },
  });
  const markdown = renderMarkdown(report, makeBundle());
  assert.ok(markdown.includes("**(missing)**"));
});

test("regression: an invalid draft carries a visible banner", () => {
  const markdown = renderMarkdown(makeReport(), makeBundle(), {
    invalid: true,
    issues: [{ level: "error", code: "evidence_not_in_bundle", message: "Citation ev_9 is missing." }],
  });
  assert.ok(markdown.includes("did not pass validation"));
  assert.ok(markdown.includes("evidence_not_in_bundle"));
});

test("regression: an invalid draft is marked even with --allow-invalid", () => {
  const bundle = makeBundle({ captures: undefined });
  const reportPath = writeJson("draft.json", makeReport());
  const bundlePath = writeJson("draftbundle.json", bundle);
  const out = join(dir, "draft.md");
  const outcome = run(["render", "--report", reportPath, "--bundle", bundlePath, "--out", out, "--allow-invalid"]);
  assert.equal(outcome.code, 1);
  const markdown = readFileSync(out, "utf8");
  assert.ok(markdown.includes("did not pass validation"));
  // Integrity still ran: the fabricated id is reported, not silently rendered.
  assert.match(outcome.stderr, /bundle_missing_array/);
});

test("regression: a pipes-laden authority cannot break the evidence table", () => {
  const bundle = makeBundle({
    records: [makeRecord({ authority: "shipped-artifact|with|pipes", subject: "garbage-string" })],
  });
  const markdown = renderMarkdown(makeReport(), bundle);
  const row = markdown.split("\n").find((line) => line.startsWith("| `ev_"));
  assert.ok(row.includes("shipped-artifact\\|with\\|pipes"));
  assert.ok(!row.includes("undefined"));
  assert.ok(row.includes("no subject"));
});

test("regression: schema rejects a non-string tool version and purpose", () => {
  const report = makeReport({
    reproduction: {
      environment: [],
      tool_versions: [{ name: "x", version: 12, evidence_ids: [] }],
      commands: [{ command: "c", purpose: 5, evidence_ids: [] }],
    },
  });
  assert.equal(errorCodes(validateReport(report)).filter((c) => c === "reproduction_entry_invalid").length, 2);
});

test("regression: schema rejects non-string not_established entries", () => {
  const report = makeReport({ summary: { established: [], not_established: [42] } });
  assert.ok(errorCodes(validateReport(report)).includes("summary_field_invalid"));
});

test("regression: a report pinned to a different bundle digest is rejected", () => {
  const report = makeReport({ bundle_digest: hex("9") });
  const issues = checkIntegrity(report, makeBundle(), { bundleDigest: hex("1") });
  assert.ok(errorCodes(issues).includes("bundle_digest_mismatch"));
  // Same bundle: no complaint.
  const same = checkIntegrity(report, makeBundle(), { bundleDigest: hex("9") });
  assert.ok(!errorCodes(same).includes("bundle_digest_mismatch"));
});

test("regression: bundle_digest is an accepted optional key and must be well formed", () => {
  assert.deepEqual(
    errorCodes(validateReport(makeReport({ bundle_digest: hex("9") }))),
    [],
  );
  assert.ok(
    errorCodes(validateReport(makeReport({ bundle_digest: "nope" }))).includes(
      "report_bundle_digest_malformed",
    ),
  );
  // It must not be reported as an unknown key any more.
  const warnings = validateReport(makeReport({ bundle_digest: hex("9") }))
    .filter((i) => i.level === "warning")
    .map((i) => i.code);
  assert.ok(!warnings.includes("report_key_unknown"));
});

test("regression: a digest mismatch is caught through the CLI, not just the API", () => {
  const report = writeJson("pinned.json", makeReport({ bundle_digest: hex("9") }));
  const bundle = writeJson("pinnedbundle.json", makeBundle());
  const outcome = run(["validate", "--report", report, "--bundle", bundle]);
  assert.equal(outcome.code, 1);
  assert.match(outcome.stderr, /bundle_digest_mismatch/);
});

test("regression: the real REA sample bundle still validates after the hardening", () => {
  const { bundle } = loadBundleFile(new URL("../fixtures/clipnote-bundle.json", import.meta.url));
  assert.deepEqual(errorCodes(validateBundle(bundle)), []);
  const report = JSON.parse(
    readFileSync(new URL("../fixtures/report.clipnote.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(errorCodes(checkIntegrity(report, bundle)), []);
  assert.equal(renderMarkdown(report, bundle).includes(TARGET_DIGEST), false);
});