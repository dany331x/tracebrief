/**
 * CLI behaviour that previously had no test, plus two hygiene problems the
 * audit found: stderr was swallowed on a successful run, and several tests
 * shared and rewrote the same temp filenames.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { evidenceId, makeBundle, makeClaim, makeReport } from "./helpers.mjs";

const CLI = fileURLToPath(new URL("../bin/tracebrief.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "tracebrief-cli-gaps-"));
after(() => dir);

let counter = 0;

/** A fresh filename per call: no test shares or overwrites another's input. */
const writeJson = (value) => {
  counter += 1;
  const path = join(dir, `input-${counter}.json`);
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  return path;
};

/**
 * Capture stdout and stderr on every run, success or failure. The earlier helper
 * returned `stderr: ""` whenever the child exited 0, so an assertion on stderr
 * after a successful run would have passed against the empty string.
 */
const run = (args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

test("a missing required flag is a usage error with usage text, not an I/O error", () => {
  const cases = [["validate"], ["validate", "--report", "r.json"], ["render", "--bundle", "b.json"], ["index"]];
  for (const args of cases) {
    const outcome = run(args);
    assert.equal(outcome.code, 2, `${args.join(" ")} should exit 2`);
    assert.match(outcome.stderr, /Usage:/, `${args.join(" ")} should print usage`);
    assert.match(outcome.stderr, /--(bundle|report) is required/, `${args.join(" ")}: ${outcome.stderr}`);
    assert.doesNotMatch(outcome.stderr, /undefined|cannot read/, args.join(" "));
  }
});

test("validate --json carries the digest, counts, and both severities", () => {
  const report = writeJson(makeReport({ findings: [makeClaim({ evidence_ids: [evidenceId("9")] })] }));
  const outcome = run(["validate", "--report", report, "--bundle", writeJson(makeBundle()), "--json"]);
  assert.equal(outcome.code, 1);
  const parsed = JSON.parse(outcome.stdout);
  assert.equal(parsed.bundle_digest.length, 64);
  assert.ok(parsed.error_count >= 1, "the fabricated citation must be an error");
  assert.ok(parsed.warning_count >= 1, "the fixture must also produce a warning");
  assert.ok(parsed.issues.some((issue) => issue.level === "error" && issue.code === "evidence_not_in_bundle"));
  assert.ok(parsed.issues.some((issue) => issue.level === "warning"));
});

test("render --out creates missing intermediate directories", () => {
  const out = join(dir, "does", "not", "exist", "deep", "report.md");
  const outcome = run([
    "render",
    "--report",
    writeJson(makeReport()),
    "--bundle",
    writeJson(makeBundle()),
    "--out",
    out,
  ]);
  assert.equal(outcome.code, 0, outcome.stderr);
  assert.ok(readFileSync(out, "utf8").startsWith("# TraceBrief fixture report"));
});

test("render without --out writes the document to stdout and nothing to stderr", () => {
  const outcome = run(["render", "--report", writeJson(makeReport()), "--bundle", writeJson(makeBundle())]);
  assert.equal(outcome.code, 0, outcome.stderr);
  assert.ok(outcome.stdout.startsWith("# TraceBrief fixture report"));
  assert.equal(outcome.stderr, "", "a clean render must not write to stderr");
});

test("a successful validate --json run reports no stderr noise", () => {
  const outcome = run([
    "validate",
    "--report",
    writeJson(makeReport()),
    "--bundle",
    writeJson(makeBundle()),
    "--json",
  ]);
  assert.equal(outcome.code, 0);
  assert.equal(outcome.stderr, "");
});

test("absolute paths behave identically regardless of the process cwd", () => {
  const report = writeJson(makeReport());
  const bundle = writeJson(makeBundle());
  const fromRepo = run(["validate", "--report", report, "--bundle", bundle]);
  const fromTemp = spawnSync(process.execPath, [CLI, "validate", "--report", report, "--bundle", bundle], {
    encoding: "utf8",
    cwd: tmpdir(),
  });
  assert.equal(fromRepo.code, 0);
  assert.equal(fromTemp.status, 0);
  assert.equal(fromTemp.stdout, fromRepo.stdout);
});

test("an unknown command is a usage error", () => {
  const outcome = run(["frobnicate", "--bundle", writeJson(makeBundle())]);
  assert.equal(outcome.code, 2);
  assert.match(outcome.stderr, /unknown command/);
});

test("the suite's temp inputs are all distinct files", () => {
  // Guards the hygiene fix: writeJson must never hand two tests the same path.
  const a = writeJson(makeBundle());
  const b = writeJson(makeBundle());
  assert.notEqual(a, b);
  assert.equal(readFileSync(a, "utf8"), readFileSync(b, "utf8"));
});

test("node can execute the CLI directly as documented in the README", () => {
  // The README tells users to run `node bin/tracebrief.mjs ...`, not a
  // globally installed `tracebrief`, so that exact form must work.
  const output = execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.match(output, /Usage:/);
  assert.match(output, /node --test|validate --report/);
});