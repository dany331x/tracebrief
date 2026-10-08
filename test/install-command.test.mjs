/**
 * Tests for the /tracebrief command installer.
 *
 * The installer rewrites one string in a Markdown file and copies it to a
 * directory. That is small enough to test exactly rather than approximately.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const INSTALLER = fileURLToPath(new URL("../scripts/install-command.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = join(REPO_ROOT, ".opencode", "commands", "tracebrief.md");
const dir = mkdtempSync(join(tmpdir(), "tracebrief-install-"));

const run = (args) => {
  try {
    const stdout = execFileSync(process.execPath, [INSTALLER, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
};

test("the repo command file uses the relative invocation the installer rewrites", () => {
  const source = readFileSync(SOURCE, "utf8");
  assert.ok(source.includes("node bin/tracebrief.mjs"));
  assert.ok(source.startsWith("---"));
  assert.ok(source.includes("description:"));
});

test("installing writes an absolute CLI path and survives a second run", () => {
  const target = join(dir, "install-a");
  const first = run(["--target", target]);
  assert.equal(first.code, 0, first.stderr);
  const installed = readFileSync(join(target, "tracebrief.md"), "utf8");
  assert.ok(installed.includes(`node "${resolve(REPO_ROOT, "bin", "tracebrief.mjs")}"`));
  assert.ok(!installed.includes("node bin/tracebrief.mjs"));
  // Idempotent: no double prefixing.
  const second = run(["--target", target, "--force"]);
  assert.equal(second.code, 0, second.stderr);
  const again = readFileSync(join(target, "tracebrief.md"), "utf8");
  assert.equal(again, installed);
});

test("installing twice without --force refuses", () => {
  const target = join(dir, "install-b");
  assert.equal(run(["--target", target]).code, 0);
  const blocked = run(["--target", target]);
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /--force/);
});

test("the installed command preserves frontmatter and every instruction", () => {
  const target = join(dir, "install-c");
  run(["--target", target]);
  const installed = readFileSync(join(target, "tracebrief.md"), "utf8");
  const source = readFileSync(SOURCE, "utf8");
  assert.ok(installed.startsWith("---"));
  assert.ok(installed.includes("description:"));
  assert.equal(installed.split("\n").length, source.split("\n").length);
  // Only the CLI invocation may differ.
  assert.equal(
    installed.split("node ").length,
    source.split("node ").length,
  );
});

test("uninstall removes the command and is idempotent", () => {
  const target = join(dir, "install-d");
  run(["--target", target]);
  assert.ok(existsSync(join(target, "tracebrief.md")));
  assert.equal(run(["--uninstall", "--target", target]).code, 0);
  assert.ok(!existsSync(join(target, "tracebrief.md")));
  assert.equal(run(["--uninstall", "--target", target]).code, 0);
});

test("the installed command's CLI path actually exists", () => {
  const target = join(dir, "install-e");
  run(["--target", target]);
  const installed = readFileSync(join(target, "tracebrief.md"), "utf8");
  const match = installed.match(/node "([^"]+)"/);
  assert.ok(match, "installed command must pin an absolute CLI path");
  assert.ok(existsSync(match[1]), `pinned CLI path does not exist: ${match[1]}`);
});

test("--target without a value is a usage error", () => {
  const outcome = run(["--target"]);
  assert.equal(outcome.code, 2);
  assert.match(outcome.stderr, /requires a value/);
  assert.doesNotMatch(outcome.stderr, /at Object|at Module/);
});

test("rewriteForInstall refuses content it does not recognise", async () => {
  const { rewriteForInstall } = await import("../scripts/install-command.mjs");
  assert.throws(
    () => rewriteForInstall("# unrelated command file", "C:/x/bin/tracebrief.mjs"),
    /refusing to guess/,
  );
  const once = rewriteForInstall("run node bin/tracebrief.mjs now", "C:/x/bin/tracebrief.mjs");
  const twice = rewriteForInstall(once, "C:/x/bin/tracebrief.mjs");
  assert.equal(once, twice);
  assert.ok(once.includes('node "C:/x/bin/tracebrief.mjs" now'));
});