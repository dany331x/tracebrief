#!/usr/bin/env node
/**
 * Install (or remove) the /tracebrief command for OpenCode.
 *
 * The command file in this repository is written for use *inside* this project,
 * where `node bin/tracebrief.mjs` resolves. TraceBrief is normally used in some
 * other project — the target being investigated — so a global install has to
 * rewrite that invocation to an absolute path. This script does exactly that
 * substitution and nothing else, so the installed copy can never drift from the
 * repo copy beyond the CLI path.
 *
 *   node scripts/install-command.mjs [--target <dir>] [--force]
 *   node scripts/install-command.mjs --uninstall [--target <dir>]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO_ROOT, ".opencode", "commands", "tracebrief.md");
const CLI = join(REPO_ROOT, "bin", "tracebrief.mjs");
const RELATIVE_INVOCATION = "node bin/tracebrief.mjs";
const COMMAND_NAME = "tracebrief.md";

export const defaultTargetDir = () => join(homedir(), ".config", "opencode", "commands");

/**
 * Rewrite the relative CLI invocation to an absolute one. Idempotent: running it
 * on an already-installed copy must not double-prefix the path.
 */
export const rewriteForInstall = (contents, cliPath) => {
  const absolute = `node "${cliPath}"`;
  if (contents.includes(absolute)) return contents;
  if (!contents.includes(RELATIVE_INVOCATION)) {
    throw new Error(
      `command file does not contain the expected invocation "${RELATIVE_INVOCATION}"; refusing to guess`,
    );
  }
  return contents.split(RELATIVE_INVOCATION).join(absolute);
};

const parseArgs = (argv) => {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    if (name === "target") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("option --target requires a value");
      flags.target = value;
      index += 1;
      continue;
    }
    flags[name] = true;
  }
  return flags;
};

const main = () => {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`tracebrief: ${error.message}\n`);
    process.exit(2);
  }
  const targetDir = resolve(flags.target ?? defaultTargetDir());
  const destination = join(targetDir, COMMAND_NAME);

  if (flags.uninstall) {
    if (!existsSync(destination)) {
      process.stdout.write(`tracebrief: nothing installed at ${destination}\n`);
      process.exit(0);
    }
    rmSync(destination);
    process.stdout.write(`tracebrief: removed ${destination}\n`);
    process.exit(0);
  }

  if (!existsSync(SOURCE)) {
    process.stderr.write(`tracebrief: missing command source at ${SOURCE}\n`);
    process.exit(2);
  }
  if (existsSync(destination) && !flags.force) {
    process.stderr.write(
      `tracebrief: ${destination} already exists. Re-run with --force to overwrite, or --uninstall first.\n`,
    );
    process.exit(2);
  }

  const contents = rewriteForInstall(readFileSync(SOURCE, "utf8"), CLI);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(destination, contents, "utf8");

  process.stdout.write(`tracebrief: installed ${destination}\n`);
  process.stdout.write(`  CLI path pinned to ${CLI}\n`);
  process.stdout.write(`  restart OpenCode, then run /tracebrief from any project directory\n`);
  process.exit(0);
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}