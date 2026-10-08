#!/usr/bin/env node
/**
 * tracebrief CLI.
 *
 *   tracebrief validate --report <report.json> --bundle <bundle.json> [--json]
 *   tracebrief render   --report <report.json> --bundle <bundle.json> [--out <file>]
 *   tracebrief index    --bundle <bundle.json> [--json]
 *
 * Exit codes: 0 clean (warnings allowed), 1 validation errors, 2 usage or I/O
 * failure. Rendering refuses to write a report that failed validation unless
 * --allow-invalid is passed, so an unsupported claim can never reach a file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadBundleFile, validateBundle } from "../src/bundle.mjs";
import { validateReport } from "../src/report.mjs";
import { checkIntegrity, citedEvidenceIds } from "../src/rules.mjs";
import { renderMarkdown } from "../src/render-markdown.mjs";

const USAGE = `tracebrief — evidence-first reverse-engineering reports

Usage:
  tracebrief validate --report <report.json> --bundle <bundle.json> [--json]
  tracebrief render   --report <report.json> --bundle <bundle.json> [--out <file>] [--allow-invalid]
  tracebrief index    --bundle <bundle.json> [--json]
`;

const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[name] = true;
      continue;
    }
    flags[name] = next;
    index += 1;
  }
  return { command, flags };
};

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const readJson = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    fail(`tracebrief: cannot read ${label} at ${path}: ${cause.message}`);
  }
};

const evaluate = (reportPath, bundlePath) => {
  const { bundle, digest, bytes } = loadBundleFile(bundlePath);
  const report = readJson(reportPath, "report");
  const issues = [...validateBundle(bundle), ...validateReport(report)];
  const structurallyValid = !issues.some((entry) => entry.level === "error");
  const integrity = structurallyValid ? checkIntegrity(report, bundle) : [];
  const all = [...issues, ...integrity];
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
    process.stderr.write(`${entry.level === "error" ? "error" : "warning"} ${entry.code}${where}: ${entry.message}\n`);
  }
};

const main = () => {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || flags.help || command === "help") {
    process.stdout.write(USAGE);
    process.exit(command ? 0 : 2);
  }
  if (!flags.bundle) fail(`tracebrief: --bundle is required\n\n${USAGE}`);
  if (command !== "index" && !flags.report) {
    fail(`tracebrief: --report is required for "${command}"\n\n${USAGE}`);
  }

  if (command === "index") {
    const { bundle } = loadBundleFile(flags.bundle);
    const issues = validateBundle(bundle);
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify({ records: bundle.records ?? [], issues }, null, 2)}\n`,
      );
    } else {
      for (const record of [...(bundle.records ?? [])].sort((a, b) =>
        a.evidence_id < b.evidence_id ? -1 : 1,
      )) {
        process.stdout.write(
          `${record.evidence_id}  ${record.operation}  ${record.confidence}/${record.authority}\n`,
        );
      }
    }
    process.exit(issues.some((entry) => entry.level === "error") ? 1 : 0);
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

  if (command === "render") {
    const outcome = evaluate(flags.report, flags.bundle);
    if (outcome.errorCount > 0) {
      process.stderr.write("tracebrief: refusing to render a report that failed validation.\n");
      printIssues(outcome.issues.filter((entry) => entry.level === "error"));
      if (!flags["allow-invalid"]) process.exit(1);
      process.stderr.write("tracebrief: --allow-invalid given; rendering anyway.\n");
    }
    const markdown = renderMarkdown(outcome.report, outcome.bundle, {
      bundleDigest: outcome.bundleDigest,
    });
    if (flags.out) {
      try {
        mkdirSync(dirname(resolve(flags.out)), { recursive: true });
        writeFileSync(flags.out, markdown, "utf8");
      } catch (cause) {
        fail(`tracebrief: cannot write ${flags.out}: ${cause.message}`);
      }
      process.stderr.write(
        `tracebrief: wrote ${flags.out}${outcome.errorCount > 0 ? " (invalid)" : ""}\n`,
      );
    } else {
      process.stdout.write(markdown);
    }
    process.exit(outcome.errorCount === 0 ? 0 : 1);
  }

  fail(`tracebrief: unknown command "${command}"\n\n${USAGE}`);
};

main();