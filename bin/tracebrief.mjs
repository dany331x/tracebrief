#!/usr/bin/env node
/**
 * tracebrief CLI.
 *
 *   tracebrief validate --report <report.json> --bundle <bundle.json> [--json]
 *   tracebrief render   --report <report.json> --bundle <bundle.json> [--out <file>] [--allow-invalid]
 *   tracebrief index    --bundle <bundle.json> [--json]
 *
 * Exit codes: 0 clean (warnings allowed), 1 validation errors, 2 usage or I/O
 * failure. Rendering refuses to write a report that failed validation unless
 * --allow-invalid is passed, so an unsupported claim can never reach a file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadBundleFile, parseJsonText, validateBundle } from "../src/bundle.mjs";
import { validateReport } from "../src/report.mjs";
import { checkIntegrity, citedEvidenceIds } from "../src/rules.mjs";
import { renderMarkdown } from "../src/render-markdown.mjs";

const USAGE = `tracebrief — evidence-first reverse-engineering reports

Usage:
  tracebrief validate --report <report.json> --bundle <bundle.json> [--json]
  tracebrief render   --report <report.json> --bundle <bundle.json> [--out <file>] [--allow-invalid]
  tracebrief index    --bundle <bundle.json> [--json]

Exit codes:
  0  clean (warnings allowed)
  1  validation errors
  2  usage or I/O failure
`;

const COMMANDS = {
  validate: { flags: ["report", "bundle", "json"] },
  render: { flags: ["report", "bundle", "out", "json", "allow-invalid"] },
  index: { flags: ["bundle", "json"] },
};

/** Flags that take a value. Everything else is boolean. */
const VALUE_FLAGS = new Set(["report", "bundle", "out"]);

/**
 * Parse argv strictly: unknown flags and valueless value flags are usage
 * errors, so a typo can never be silently ignored.
 */
const parseArgs = (argv) => {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      flags.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      // A single-dash token is a typo, not a positional argument.
      if (token.startsWith("-") && token.length > 1) {
        throw new UsageError(`unknown option "${token}" (options are spelled --long)`);
      }
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (!VALUE_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new UsageError(`option --${name} requires a value`);
    }
    flags[name] = value;
    index += 1;
  }
  return { command: positionals[0], flags, positionals };
};

class UsageError extends Error {}

const fail = (message, code = 2) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

const failUsage = (message) => fail(`tracebrief: ${message}\n\n${USAGE}`);

const readBundle = (path) => {
  try {
    return loadBundleFile(path);
  } catch (cause) {
    fail(`tracebrief: cannot read bundle at ${path}: ${cause.message}`);
  }
};

const readReport = (path) => {
  try {
    return parseJsonText(readFileSync(path, "utf8"), `Report ${path}`);
  } catch (cause) {
    fail(`tracebrief: cannot read report at ${path}: ${cause.message}`);
  }
};

const evaluate = (reportPath, bundlePath) => {
  const { bundle, digest, bytes } = readBundle(bundlePath);
  const report = readReport(reportPath);
  const structural = [...validateBundle(bundle), ...validateReport(report)];
  // Integrity rules are defensive, so they always run: with --allow-invalid a
  // structurally broken report must still have its citations checked, and the
  // rendered document must be able to say so.
  const integrity = checkIntegrity(report, bundle, { bundleDigest: digest });
  const all = [...structural, ...integrity];
  return {
    report,
    bundle,
    bundleDigest: digest,
    bundleBytes: bytes,
    issues: all,
    errorCount: all.filter((entry) => entry.level === "error").length,
    warningCount: all.filter((entry) => entry.level === "warning").length,
  };
};

const printIssues = (issues) => {
  for (const entry of issues) {
    const where = entry.path ? ` (${entry.path})` : "";
    process.stderr.write(
      `${entry.level === "error" ? "error" : "warning"} ${entry.code}${where}: ${entry.message}\n`,
    );
  }
};

const main = () => {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) failUsage(error.message);
    throw error;
  }
  const { command, flags, positionals } = parsed;

  if (flags.help || command === "help" || (!command && Object.keys(flags).length === 0)) {
    process.stdout.write(USAGE);
    process.exit(command || flags.help ? 0 : 2);
  }
  if (!command) failUsage("no command given");
  if (positionals.length > 1) {
    failUsage(
      `unexpected argument "${positionals[1]}"; this tool takes only one command. Did a flag value go missing its --name?`,
    );
  }
  const spec = COMMANDS[command];
  if (!spec) failUsage(`unknown command "${command}"`);

  const unknown = Object.keys(flags).filter(
    (name) => name !== "help" && !spec.flags.includes(name),
  );
  if (unknown.length > 0) {
    failUsage(`unknown flag${unknown.length > 1 ? "s" : ""} for "${command}": ${unknown.map((n) => `--${n}`).join(", ")}`);
  }
  if (!flags.bundle) failUsage(`--bundle is required for "${command}"`);
  if (command !== "index" && !flags.report) failUsage(`--report is required for "${command}"`);

  if (command === "index") {
    const { bundle } = readBundle(flags.bundle);
    const issues = validateBundle(bundle);
    if (flags.json) {
      const records = Array.isArray(bundle?.records) ? bundle.records : [];
      process.stdout.write(`${JSON.stringify({ records, issues }, null, 2)}\n`);
    } else {
      const records = (Array.isArray(bundle?.records) ? bundle.records : [])
        .filter((record) => record && typeof record === "object")
        .sort((a, b) => (String(a.evidence_id) < String(b.evidence_id) ? -1 : 1));
      for (const record of records) {
        process.stdout.write(
          `${record.evidence_id}  ${record.operation}  ${record.confidence}/${record.authority}\n`,
        );
      }
    }
    if (issues.some((entry) => entry.level === "error")) {
      printIssues(issues.filter((entry) => entry.level === "error"));
      process.exit(1);
    }
    process.exit(0);
  }

  if (command === "validate") {
    const outcome = evaluate(flags.report, flags.bundle);
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: outcome.errorCount === 0 ? "valid" : "invalid",
            error_count: outcome.errorCount,
            warning_count: outcome.warningCount,
            bundle_digest: outcome.bundleDigest,
            cited_evidence_ids: citedEvidenceIds(outcome.report),
            issues: outcome.issues,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(
        `TraceBrief ${outcome.errorCount === 0 ? "valid" : "invalid"}: ${outcome.errorCount} error(s), ${outcome.warningCount} warning(s)\n`,
      );
      printIssues(outcome.issues);
    }
    process.exit(outcome.errorCount === 0 ? 0 : 1);
  }

  // render
  const outcome = evaluate(flags.report, flags.bundle);
  if (outcome.errorCount > 0) {
    process.stderr.write("tracebrief: refusing to render a report that failed validation.\n");
    printIssues(outcome.issues.filter((entry) => entry.level === "error"));
    if (!flags["allow-invalid"]) process.exit(1);
    process.stderr.write("tracebrief: --allow-invalid given; rendering a draft anyway.\n");
  }
  const markdown = renderMarkdown(outcome.report, outcome.bundle, {
    bundleDigest: outcome.bundleDigest,
    invalid: outcome.errorCount > 0,
    issues: outcome.issues,
  });
  if (flags.out) {
    try {
      mkdirSync(dirname(resolve(flags.out)), { recursive: true });
      writeFileSync(flags.out, markdown, "utf8");
    } catch (cause) {
      fail(`tracebrief: cannot write ${flags.out}: ${cause.message}`);
    }
    process.stderr.write(
      `tracebrief: wrote ${flags.out}${outcome.errorCount > 0 ? " (invalid draft)" : ""}\n`,
    );
  } else {
    process.stdout.write(markdown);
  }
  process.exit(outcome.errorCount === 0 ? 0 : 1);
};

main();