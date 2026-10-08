#!/usr/bin/env node
/**
 * Mutation spot-check: prove the repaired tests fail when their fixes are reverted.
 *
 * A test that passes both with and without the code it claims to verify is
 * decoration. This script copies the project, applies one semantic mutation at a
 * time, runs the suite, and reports which mutations went undetected.
 *
 *   node scripts/mutation-check.mjs            # run all mutations
 *   node scripts/mutation-check.mjs --verbose  # also list passing mutations
 *
 * Exit codes: 0 every mutation was caught, 1 at least one survived.
 * It writes only to a temp directory and never touches the working tree.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verbose = process.argv.includes("--verbose");

/**
 * Each mutation reverts one shipped fix. `expect` names the test that must fail;
 * it is documentation for a human reading a survivor, not a hard assertion.
 */
const MUTATIONS = [
  {
    id: "inline-no-cr-flattening",
    file: "src/render-markdown.mjs",
    from: '.replace(/[\\r\\n]+/g, " ")',
    to: '.replace(/\\n/g, " ")',
    expect: "no bare carriage return reaches the rendered document",
    why: "reverts the lone-CR flattening that the CR injection tests exist for",
  },
  {
    id: "inline-no-backtick-escape",
    file: "src/render-markdown.mjs",
    from: '.replace(/`/g, "\'")',
    to: "",
    expect: "a backtick in a claim id cannot escape its code span",
    why: "reverts backtick neutralisation inside code spans",
  },
  {
    id: "evidence-links-block-removed",
    file: "src/render-markdown.mjs",
    from: "  if (linked.length > 0) {",
    to: "  if (false) {",
    expect: "renders evidence links after the table",
    why: "removes the evidence-links block entirely",
  },
  {
    id: "evidence-links-moved-before-table",
    file: "src/render-markdown.mjs",
    from: '  lines.push("| Evidence | Operation | Subject | Provider | Confidence | Authority | Locations |");',
    to: '  if (linked.length > 0) {\n    lines.push("Evidence links (provenance chain declared by REA):");\n    for (const entry of linked) {\n      lines.push(`- \\`${entry.id}\\` -> ${entry.links.map((l) => `\\`${l}\\``).join(", ")}`);\n    }\n  }\n  lines.push("| Evidence | Operation | Subject | Provider | Confidence | Authority | Locations |");',
    expect: "renders evidence links after the table",
    why: "moves the evidence-links block above the table, inverting the ordering",
  },
  {
    id: "prose-no-leading-escape",
    file: "src/render-markdown.mjs",
    from: 'return flat.replace(MARKDOWN_INLINE, "\\\\$1").replace(MARKDOWN_LEADING, "\\\\$1");',
    to: 'return flat.replace(MARKDOWN_INLINE, "\\\\$1");',
    expect: "the escape helpers are total and neutralise leading markers",
    why: "reverts leading-marker escaping, which previously proved nothing",
  },
  {
    id: "subject-warning-some",
    file: "src/rules.mjs",
    from: "only.every((record) => record.subject == null)",
    to: "only.some((record) => record.subject == null)",
    expect: "the subject-unavailable warning fires only when EVERY cited record lacks a subject",
    why: "turns an all-records check into an any-record false alarm",
  },
  {
    id: "kind-unknown-exemption-dropped",
    file: "src/rules.mjs",
    from: 'if (kind !== "unknown" && records.length === 0) {',
    to: "if (records.length === 0) {",
    expect: "a kind-unknown claim may cite nothing",
    why: "removes the only licence to assert a gap without evidence",
  },
  {
    id: "relationships-section-dropped",
    file: "src/rules.mjs",
    from: 'const SECTIONS = ["findings", "relationships"];',
    to: 'const SECTIONS = ["findings"];',
    expect: "integrity rules apply to relationships claims",
    why: "stops checking relationship claims entirely",
  },
  {
    id: "unknown-history-not-collapsed",
    file: "src/bundle.mjs",
    from: "    if (!current || revision >= currentRevision) heads.set(id, unknown);",
    to: "    if (!current) heads.set(id, unknown);",
    expect: "unknown history collapses to one head per id",
    why: "keeps the first revision, so a stale open revision shadows a resolved head",
  },
  {
    id: "open-unknowns-ignores-status",
    file: "src/bundle.mjs",
    from: "  residualUnknownHeads(bundle).filter((unknown) => unknown?.status !== \"resolved\");",
    to: "  residualUnknownHeads(bundle);",
    expect: "a resolved unknown is not reported as an open question",
    why: "reports resolved unknowns as still open",
  },
  {
    id: "runtime-authority-check-removed",
    file: "src/rules.mjs",
    from: "RUNTIME_AUTHORITIES.includes(record.authority)",
    to: "true",
    expect: "rejects a runtime claim backed only by static authority",
    why: "lets a runtime claim through on static evidence",
  },
  {
    id: "citation-index-filtered-again",
    file: "src/rules.mjs",
    from: "  const rawIds = asArray(claim.evidence_ids);",
    to: "  const rawIds = asArray(claim.evidence_ids).filter((value) => typeof value === \"string\");",
    expect: "a non-string entry earlier in evidence_ids does not shift the reported index",
    why: "filters the raw citation list, which is what shifted the reported offsets",
  },
  {
    id: "limitation-single-char-allowed",
    file: "src/rules.mjs",
    from: "const MIN_QUOTE_WORDS = 4;",
    to: "const MIN_QUOTE_WORDS = 0;",
    expect: "a one-character limitation does not count as acknowledgement",
    why: "reinstates the one-character bypass of the acknowledgement rule",
  },
  {
    id: "target-digest-warning-suppressed",
    file: "src/rules.mjs",
    from: "  } else {\n    // Without a digest, cross-artifact verification is silently disabled.",
    to: "  } else if (false) {\n    // Without a digest, cross-artifact verification is silently disabled.",
    expect: "a missing target digest warns",
    why: "suppresses the warning that cross-artifact verification is disabled",
  },
  {
    id: "open-question-unknown-checks-removed",
    file: "src/rules.mjs",
    from: "issues.push(...checkOpenQuestionUnknowns(report, bundle));",
    to: "",
    expect: "an open question may not present a resolved or nonexistent unknown",
    why: "stops checking that a cited residual unknown exists and is unresolved",
  },
  {
    id: "duplicate-statement-check-removed",
    file: "src/rules.mjs",
    from: "issues.push(...checkDuplicateStatements(report));",
    to: "",
    expect: "two claims with the same statement are flagged",
    why: "lets one finding be restated as if corroborated",
  },
  {
    id: "bundle-digest-mismatch-ignored",
    file: "src/rules.mjs",
    from: "  if (declared === bundleDigest) return [];",
    to: "  if (declared === bundleDigest || true) return [];",
    expect: "a report pinned to a different bundle digest is rejected",
    why: "silently accepts a report validated against the wrong bundle",
  },
  {
    id: "integrity-not-always-run",
    file: "bin/tracebrief.mjs",
    from: "  const integrity = checkIntegrity(report, bundle, { bundleDigest: digest });",
    to: "  const integrity = structural.some((e) => e.level === \"error\") ? [] : checkIntegrity(report, bundle, { bundleDigest: digest });",
    expect: "an invalid draft is marked even with --allow-invalid",
    why: "skips integrity checks when the report is structurally broken",
  },
  {
    id: "render-ignores-invalid",
    file: "bin/tracebrief.mjs",
    from: "    if (!flags[\"allow-invalid\"]) process.exit(1);",
    to: "",
    expect: "render refuses to write an invalid report unless forced",
    why: "writes an invalid report without --allow-invalid",
  },
  {
    id: "required-flag-guards-removed",
    file: "bin/tracebrief.mjs",
    from: '  if (!flags.bundle) failUsage(`--bundle is required for "${command}"`);\n  if (command !== "index" && !flags.report) failUsage(`--report is required for "${command}"`);',
    to: "",
    expect: "a missing required flag is a usage error",
    why: "removes the usage guards so the failure degrades to an I/O error",
  },
  {
    id: "bundle-io-crash",
    file: "bin/tracebrief.mjs",
    from: "  try {\n    return loadBundleFile(path);\n  } catch (cause) {\n    fail(`tracebrief: cannot read bundle at ${path}: ${cause.message}`);\n  }",
    to: "  return loadBundleFile(path);",
    expect: "a missing bundle exits 2 with a clean message",
    why: "reintroduces the uncaught bundle read that exited 1 with a stack trace",
  },
  {
    id: "locations-not-validated",
    file: "src/bundle.mjs",
    from: '  if (!Array.isArray(record.locations)) {',
    to: '  if (false) {',
    expect: "malformed locations are rejected before rendering",
    why: "stops validating record locations",
  },
  {
    id: "subject-type-not-validated",
    file: "src/bundle.mjs",
    from: '  if (record.subject !== undefined && record.subject !== null && !isPlainObject(record.subject)) {',
    to: '  if (false) {',
    expect: "a non-object record subject is rejected",
    why: "stops validating the record subject type",
  },
  {
    id: "empty-limitation-allowed",
    file: "src/report.mjs",
    from: "        if (value.trim().length === 0) {",
    to: "        if (false) {",
    expect: "an empty-string limitation is a schema error",
    why: "reinstates empty-string limitations as valid",
  },
  {
    id: "claim-kind-enum-relaxed",
    file: "src/report.mjs",
    from: "  if (!CLAIM_KINDS.includes(claim.kind)) {",
    to: "  if (false) {",
    expect: "rejects unknown claim kinds",
    why: "accepts any claim kind",
  },
];

/**
 * Run the suite in a scratch copy.
 *
 * `node --test` with no path argument discovers test files; passing "test/" as a
 * path does not work on Windows and fails before a single test runs, which
 * would make every mutation look "caught". The baseline run below proves the
 * invocation is sound before any result is trusted.
 */
const runSuite = (dir) =>
  spawnSync(process.execPath, ["--test"], { cwd: dir, encoding: "utf8", shell: false });

const copyRepo = (dir) =>
  cpSync(REPO_ROOT, dir, {
    recursive: true,
    filter: (source) => !source.includes("node_modules") && !source.includes(".git"),
  });

const scratch = mkdtempSync(join(tmpdir(), "tracebrief-mutation-"));
let survivors = 0;

try {
  // Control: an unmutated copy must pass, or no result below means anything.
  const controlDir = join(scratch, "__control");
  copyRepo(controlDir);
  const control = runSuite(controlDir);
  if (control.status !== 0) {
    process.stderr.write(
      "mutation-check: the BASELINE suite fails in a clean copy, so no mutation result can be trusted.\n" +
        `${control.stdout ?? ""}${control.stderr ?? ""}`.slice(-2000),
    );
    process.exit(2);
  }
  process.stdout.write("baseline: clean copy passes, results below are meaningful\n\n");

  for (const mutation of MUTATIONS) {
    const dir = join(scratch, mutation.id);
    copyRepo(dir);

    const target = join(dir, mutation.file);
    const source = readFileSync(target, "utf8");
    if (!source.includes(mutation.from)) {
      process.stdout.write(
        `SKIP  ${mutation.id}: anchor not found in ${mutation.file} (the code moved; update the mutation)\n`,
      );
      survivors += 1;
      continue;
    }
    writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");

    const result = runSuite(dir);
    const failed = result.status !== 0;
    const head = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const named = failed && head.includes(mutation.expect);
    if (failed) {
      process.stdout.write(
        `caught ${mutation.id.padEnd(34)} ${named ? "by the expected test" : "by a DIFFERENT test"}\n`,
      );
      if (!named) survivors += 1;
    } else {
      survivors += 1;
      process.stdout.write(`SURVIVED ${mutation.id.padEnd(31)} no test noticed — ${mutation.why}\n`);
      if (verbose) process.stdout.write(`         expected to catch: ${mutation.expect}\n`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  `\n${MUTATIONS.length - survivors}/${MUTATIONS.length} mutations caught by the intended test` +
    (survivors === 0 ? " — every repaired test has teeth\n" : ` — ${survivors} unproven\n`),
);
process.exit(survivors === 0 ? 0 : 1);