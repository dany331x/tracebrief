/**
 * Reading and structural validation of REA Evidence bundles.
 *
 * The bundle shape mirrors REA's own `evidenceBundleSchema`
 * (src/domain/evidenceBundle.ts in morluto/rea). TraceBrief never rewrites a
 * record; it only indexes and cross-checks them.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const EVIDENCE_ID_PATTERN = /^ev_[0-9a-f]{64}$/;
export const UNKNOWN_ID_PATTERN = /^unk_[0-9a-f]{64}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const BUNDLE_KEYS = Object.freeze([
  "artifacts",
  "providers",
  "environments",
  "scenarios",
  "captures",
  "unknowns",
  "records",
]);

export const CONFIDENCE_VALUES = Object.freeze(["observed", "derived", "inferred"]);
export const AUTHORITY_VALUES = Object.freeze([
  "shipped-artifact",
  "controlled-replay",
  "historical-reference",
  "external-service",
  "analyst-inference",
]);

/** Authorities that can witness runtime behavior rather than static structure. */
export const RUNTIME_AUTHORITIES = Object.freeze(["controlled-replay", "external-service"]);
/** Authorities that can witness the original source rather than a reconstruction. */
export const SOURCE_AUTHORITIES = Object.freeze(["historical-reference"]);

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** Load a bundle file and compute the digest used to pin a report to a bundle. */
export const loadBundleFile = (path) => {
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  return { bundle: JSON.parse(bytes.toString("utf8")), digest, bytes: bytes.length };
};

/** Structural problems that make a bundle unusable, independent of any report. */
export const validateBundle = (bundle) => {
  const issues = [];
  if (!isPlainObject(bundle)) {
    issues.push(issue("error", "bundle_not_object", "Evidence bundle is not a JSON object.", ""));
    return issues;
  }
  for (const key of BUNDLE_KEYS) {
    if (!Array.isArray(bundle[key])) {
      issues.push(
        issue("error", "bundle_missing_array", `Evidence bundle is missing the "${key}" array.`, key),
      );
    }
  }
  for (const key of Object.keys(bundle)) {
    if (!BUNDLE_KEYS.includes(key)) {
      issues.push(issue("warning", "bundle_unknown_key", `Unexpected bundle key "${key}".`, key));
    }
  }

  const seen = new Set();
  for (const [index, record] of (bundle.records ?? []).entries()) {
    const path = `records[${index}]`;
    if (!isPlainObject(record)) {
      issues.push(issue("error", "record_not_object", "Evidence record is not an object.", path));
      continue;
    }
    if (typeof record.evidence_id !== "string" || !EVIDENCE_ID_PATTERN.test(record.evidence_id)) {
      issues.push(
        issue(
          "error",
          "record_id_malformed",
          `Evidence record id ${JSON.stringify(record.evidence_id)} is not ev_<64 lowercase hex>.`,
          `${path}.evidence_id`,
        ),
      );
      continue;
    }
    if (seen.has(record.evidence_id)) {
      issues.push(
        issue("error", "record_id_duplicated", `Duplicate evidence id ${record.evidence_id}.`, path),
      );
      continue;
    }
    seen.add(record.evidence_id);
    issues.push(...validateRecord(record, path));
  }

  for (const [index, unknown] of (bundle.unknowns ?? []).entries()) {
    const path = `unknowns[${index}]`;
    if (!isPlainObject(unknown) || typeof unknown.unknown_id !== "string") {
      issues.push(issue("error", "unknown_not_object", "Residual unknown is not an object.", path));
      continue;
    }
    if (!UNKNOWN_ID_PATTERN.test(unknown.unknown_id)) {
      issues.push(
        issue(
          "error",
          "unknown_id_malformed",
          `Residual unknown id ${JSON.stringify(unknown.unknown_id)} is not unk_<64 lowercase hex>.`,
          `${path}.unknown_id`,
        ),
      );
    }
  }
  return issues;
};

const validateRecord = (record, path) => {
  const issues = [];
  if (!CONFIDENCE_VALUES.includes(record.confidence)) {
    issues.push(
      issue(
        "error",
        "record_confidence_invalid",
        `Record confidence ${JSON.stringify(record.confidence)} is outside the REA vocabulary.`,
        `${path}.confidence`,
      ),
    );
  }
  if (!AUTHORITY_VALUES.includes(record.authority)) {
    issues.push(
      issue(
        "error",
        "record_authority_invalid",
        `Record authority ${JSON.stringify(record.authority)} is outside the REA vocabulary.`,
        `${path}.authority`,
      ),
    );
  }
  if (!isPlainObject(record.provider) || typeof record.provider.id !== "string") {
    issues.push(issue("error", "record_provider_missing", "Record has no provider identity.", path));
  }
  if (!Array.isArray(record.limitations)) {
    issues.push(issue("error", "record_limitations_invalid", "Record limitations must be an array.", path));
  }
  if (!Array.isArray(record.evidence_links)) {
    issues.push(
      issue("error", "record_links_invalid", "Record evidence_links must be an array.", path),
    );
  }
  return issues;
};

/** Index a validated bundle for citation lookups. */
export const indexBundle = (bundle) => {
  const records = new Map();
  for (const record of bundle.records ?? []) {
    if (typeof record?.evidence_id === "string") records.set(record.evidence_id, record);
  }
  const unknowns = new Map();
  for (const unknown of bundle.unknowns ?? []) {
    if (typeof unknown?.unknown_id === "string") unknowns.set(unknown.unknown_id, unknown);
  }
  const artifacts = new Map();
  for (const artifact of bundle.artifacts ?? []) {
    const sha = artifact?.digest?.sha256;
    if (typeof sha === "string") artifacts.set(sha, artifact);
  }
  return { records, unknowns, artifacts };
};

/** Records whose status still leaves the question open. */
export const openUnknowns = (bundle) =>
  (bundle.unknowns ?? []).filter((unknown) => unknown?.status !== "resolved");

const issue = (level, code, message, path, detail) => ({ level, code, message, path, ...(detail ? { detail } : {}) });

export { isPlainObject, issue };