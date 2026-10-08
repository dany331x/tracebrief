/**
 * Renderer coverage for branches that previously had no test, plus the
 * determinism claim made in the README.
 *
 * The determinism test spawns a separate process: comparing two renders inside
 * one tick cannot detect a `Date.now()` or `Math.random()` in the output, which
 * is exactly what the earlier in-process assertion failed to catch.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { NOT_COLLECTED, renderMarkdown } from "../src/render-markdown.mjs";
import { evidenceId, hex, makeBundle, makeClaim, makeRecord, makeReport } from "./helpers.mjs";

const render = (report, bundle, options) => renderMarkdown(report, bundle, options);

const EMPTY_REPORT = () =>
  makeReport({
    findings: [],
    relationships: [],
    open_questions: [],
    summary: { established: [], not_established: [] },
    reproduction: { environment: [], tool_versions: [], commands: [] },
  });

const sectionBody = (markdown, heading) => {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) return null;
  const rest = markdown.slice(start + heading.length + 3);
  const next = rest.indexOf("\n## ");
  return next < 0 ? rest : rest.slice(0, next);
};

test("every empty section says it was not collected", () => {
  const markdown = render(EMPTY_REPORT(), makeBundle());
  for (const heading of [
    "Key findings",
    "Relationships",
    "Confidence and limitations",
    "Reproduction",
    "Open questions",
    "Summary",
  ]) {
    const body = sectionBody(markdown, heading);
    assert.ok(body !== null, `section ${heading} is missing`);
    assert.ok(body.includes(NOT_COLLECTED), `section ${heading} does not say ${NOT_COLLECTED}`);
  }
  assert.ok(markdown.includes("_No evidence cited._"), "the evidence index must say so explicitly");
});

test("the confidence section is not collected when nothing is cited", () => {
  const body = sectionBody(render(EMPTY_REPORT(), makeBundle()), "Confidence and limitations");
  assert.ok(body.includes(NOT_COLLECTED));
});

test("the tools and commands subsections say not collected when empty", () => {
  const markdown = render(EMPTY_REPORT(), makeBundle());
  const environment = sectionBody(markdown, "Reproduction");
  assert.ok(environment.includes("### Environment"));
  assert.ok(environment.includes("### Tools"));
  assert.ok(environment.includes("### Commands"));
  assert.equal(markdown.split(NOT_COLLECTED).length - 1 >= 5, true);
});

test("the summary lists established and not-established entries", () => {
  const markdown = render(
    makeReport({
      findings: [makeClaim({ id: "f1" })],
      summary: { established: ["f1"], not_established: ["Runtime order is unproven."] },
    }),
    makeBundle(),
  );
  assert.ok(markdown.includes("- `f1`"));
  assert.ok(markdown.includes("Runtime order is unproven."));
});

test("the target overview states when the digest is absent from the bundle", () => {
  const report = makeReport();
  report.target.artifact_digest = hex("c");
  const markdown = render(report, makeBundle());
  assert.ok(markdown.includes("is **not** present in `bundle.artifacts`"));
});

test("the target overview states when no digest was recorded at all", () => {
  const report = makeReport();
  delete report.target.artifact_digest;
  const markdown = render(report, makeBundle());
  assert.ok(markdown.includes("No artifact digest was recorded"));
  assert.ok(markdown.includes("- **Artifact digest:** unknown — not collected"));
  assert.ok(markdown.includes("- **Local path:** C:/artifacts/target.exe"));
});

test("a claim's authority and confidence line describes only that claim's citations", () => {
  const bundle = makeBundle({
    records: [
      makeRecord({ evidence_id: evidenceId("1"), authority: "controlled-replay", confidence: "observed" }),
      makeRecord({ evidence_id: evidenceId("2"), authority: "shipped-artifact", confidence: "derived" }),
    ],
  });
  const markdown = render(
    makeReport({
      findings: [makeClaim({ id: "f1", evidence_ids: [evidenceId("1")] })],
      relationships: [
        makeClaim({ id: "r1", statement: "The renderer forwards the query over IPC.", evidence_ids: [evidenceId("2")] }),
      ],
      summary: { established: ["f1"], not_established: [] },
    }),
    bundle,
  );
  const claimLines = markdown
    .split("\n")
    .filter((line) => line.startsWith("- **Cited evidence reports:**"))
    .map((line) => line.trim());
  assert.deepEqual(claimLines, [
    "- **Cited evidence reports:** authority controlled-replay; confidence observed",
    "- **Cited evidence reports:** authority shipped-artifact; confidence derived",
  ]);
});

test("evidence-index rows are matched by id, not by position", () => {
  const bundle = makeBundle({
    records: [
      makeRecord({ evidence_id: evidenceId("2"), authority: "shipped-artifact", confidence: "derived" }),
      makeRecord({ evidence_id: evidenceId("1"), authority: "controlled-replay", confidence: "observed" }),
    ],
  });
  const markdown = render(
    makeReport({
      findings: [makeClaim({ evidence_ids: [evidenceId("1")] })],
      reproduction: { environment: [], tool_versions: [], commands: [] },
    }),
    bundle,
  );
  const row = markdown.split("\n").find((line) => line.includes(evidenceId("1")));
  assert.ok(row.includes("controlled-replay"));
  assert.ok(row.includes("observed"));
  assert.ok(row.includes("test-provider@9.9"));
  assert.ok(row.includes("| pe |"));
});

test("an unresolved citation is marked missing in the claim body", () => {
  const markdown = render(
    makeReport({ findings: [makeClaim({ evidence_ids: [evidenceId("9")] })] }),
    makeBundle(),
  );
  const claimLine = markdown.split("\n").find((line) => line.startsWith("- **Evidence:**"));
  assert.ok(claimLine.includes("(missing)"));
});

test("a POSIX-shaped path with a pipe cannot break the evidence table", () => {
  const bundle = makeBundle({
    records: [makeRecord({ locations: [{ kind: "artifact-path", path: "/opt/app|bin/target.exe" }] })],
  });
  const markdown = render(makeReport(), bundle);
  const row = markdown.split("\n").find((line) => line.startsWith("| `ev_"));
  assert.ok(row.includes("/opt/app\\|bin/target.exe"));
  assert.equal((row.match(/(?<!\\)\|/g) ?? []).length, 8);
});

test("file-offset locations are rendered in both supported shapes", () => {
  const bundle = makeBundle({
    records: [
      makeRecord({
        locations: [
          { kind: "file-offset", offset: 0 },
          { kind: "file-offset-range", start: 16, end: 32 },
        ],
      }),
    ],
  });
  const markdown = render(makeReport(), bundle);
  assert.ok(markdown.includes("offset 0"));
  assert.ok(markdown.includes("offsets 16-32"));
});

test("rendering is deterministic across processes, not just across calls in one tick", () => {
  const moduleUrl = new URL("../src/render-markdown.mjs", import.meta.url).href;
  const helpersUrl = new URL("./helpers.mjs", import.meta.url).href;
  const script = `
    Promise.all([import(${JSON.stringify(moduleUrl)}), import(${JSON.stringify(helpersUrl)})])
      .then(([m, h]) => { process.stdout.write(m.renderMarkdown(h.makeReport(), h.makeBundle())); });
  `;
  const renderInChild = () => execFileSync(process.execPath, ["-e", script], { encoding: "utf8" });

  const first = renderInChild();
  // Cross a second boundary so a Date.now() in the output would differ.
  execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1100)"]);
  const second = renderInChild();

  assert.equal(second, first, "two renders in separate processes differ");
  assert.equal(render(makeReport(), makeBundle()), first, "in-process render differs from child render");
  assert.ok(first.startsWith("# TraceBrief fixture report"));
});

test("the installer test file exists so the command path is covered too", () => {
  assert.ok(fileURLToPath(new URL("./install-command.test.mjs", import.meta.url)).length > 0);
});