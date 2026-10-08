import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evidenceId, makeBundle, makeClaim, makeReport } from "./helpers.mjs";

const CLI = fileURLToPath(new URL("../bin/tracebrief.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "tracebrief-test-"));

const writeJson = (name, value) => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  return path;
};

const run = (args) => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
};

test("validate exits 0 and reports valid for a clean report", () => {
  const report = writeJson("ok.json", makeReport());
  const bundle = writeJson("bundle.json", makeBundle());
  const outcome = run(["validate", "--report", report, "--bundle", bundle]);
  assert.equal(outcome.code, 0);
  assert.match(outcome.stdout, /TraceBrief valid/);
});

test("validate --json reports structured issues and exits 1", () => {
  const report = writeJson("bad.json", makeReport({ findings: [makeClaim({ evidence_ids: [evidenceId("9")] })] }));
  const bundle = writeJson("bundle.json", makeBundle());
  const outcome = run(["validate", "--report", report, "--bundle", bundle, "--json"]);
  assert.equal(outcome.code, 1);
  const parsed = JSON.parse(outcome.stdout);
  assert.equal(parsed.status, "invalid");
  assert.ok(parsed.issues.some((issue) => issue.code === "evidence_not_in_bundle"));
  assert.deepEqual(parsed.cited_evidence_ids, [evidenceId("9"), evidenceId("a")]);
});

test("validate rejects a malformed bundle before reading the report", () => {
  const bundle = writeJson("broken-bundle.json", { records: [] });
  const report = writeJson("ok.json", makeReport());
  const outcome = run(["validate", "--report", report, "--bundle", bundle]);
  assert.equal(outcome.code, 1);
  assert.match(outcome.stderr, /bundle_missing_array/);
});

test("render writes a file for a valid report", () => {
  const report = writeJson("ok.json", makeReport());
  const bundle = writeJson("bundle.json", makeBundle());
  const out = join(dir, "out.md");
  const outcome = run(["render", "--report", report, "--bundle", bundle, "--out", out]);
  assert.equal(outcome.code, 0);
  const markdown = readFileSync(out, "utf8");
  assert.ok(markdown.startsWith("# TraceBrief fixture report"));
});

test("render refuses to write an invalid report unless forced", () => {
  const report = writeJson("bad.json", makeReport({ findings: [makeClaim({ evidence_ids: [] })] }));
  const bundle = writeJson("bundle.json", makeBundle());
  const out = join(dir, "refused.md");
  const refused = run(["render", "--report", report, "--bundle", bundle, "--out", out]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /refusing to render/);
  assert.throws(() => readFileSync(out, "utf8"));

  const forced = run(["render", "--report", report, "--bundle", bundle, "--out", out, "--allow-invalid"]);
  assert.equal(forced.code, 1);
  assert.match(forced.stderr, /allow-invalid/);
  assert.ok(readFileSync(out, "utf8").includes("none cited"));
});

test("index lists every record and exits 0", () => {
  const bundle = writeJson("bundle.json", makeBundle());
  const outcome = run(["index", "--bundle", bundle]);
  assert.equal(outcome.code, 0);
  assert.ok(outcome.stdout.includes(evidenceId("a")));
  assert.ok(outcome.stdout.includes("observed/shipped-artifact"));
});

test("missing flags exit 2 with usage", () => {
  assert.equal(run(["validate"]).code, 2);
  assert.equal(run([]).code, 2);
  assert.equal(run(["nonsense", "--bundle", "x"]).code, 2);
});

test("a missing report file exits 2 rather than crashing", () => {
  const bundle = writeJson("bundle.json", makeBundle());
  const outcome = run(["validate", "--report", join(dir, "nope.json"), "--bundle", bundle]);
  assert.equal(outcome.code, 2);
  assert.match(outcome.stderr, /cannot read report/);
});