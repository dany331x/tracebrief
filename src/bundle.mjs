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

/** Strip a UTF-8 BOM, which PowerShell and many editors emit for JSON files. */
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Parse JSON text, tolerating a BOM. Throws a plain Error with a readable
 * message so the CLI can report exit 2 instead of a stack trace.
 */
export const parseJsonText = (text, label) => {
  try {
    return JSON.parse(stripBom(text));
  } catch (cause) {
    throw new Error(`${label} is not valid JSON: ${cause.message}`);
  }
};

/** Load a bundle file and compute the digest used to pin a report to a bundle. */
export const loadBundleFile = (path) => {
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    bundle: parseJsonText(bytes.toString("utf8"), `Evidence bundle ${path}`),
    digest,
    bytes: bytes.length,
  };
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
  for (const [index, record] of asArray(bundle.records).entries()) {
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

  for (const [index, unknown] of asArray(bundle.unknowns).entries()) {
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
  if (record.subject !== undefined && record.subject !== null && !isPlainObject(record.subject)) {
    issues.push(
      issue("error", "record_subject_invalid", "Record subject must be an object or null.", `${path}.subject`),
    );
  }
  if (!Array.isArray(record.locations)) {
    issues.push(
      issue("error", "record_locations_invalid", "Record locations must be an array.", `${path}.locations`),
    );
  } else {
    for (const [offset, location] of record.locations.entries()) {
      const locationPath = `${path}.locations[${offset}]`;
      if (!isPlainObject(location) || typeof location.kind !== "string") {
        issues.push(
          issue("error", "record_location_invalid", "Each location must be an object with a kind.", locationPath),
        );
        continue;
      }
      const fields = {
        address: "address",
        "address-range": ["start", "end"],
        "artifact-path": "path",
        "file-offset": "offset",
        "file-offset-range": ["start", "end"],
      }[location.kind];
      if (!fields) {
        issues.push(
          issue(
            "error",
            "record_location_kind_unknown",
            `Unknown location kind ${JSON.stringify(location.kind)}.`,
            locationPath,
          ),
        );
        continue;
      }
      for (const field of [fields].flat()) {
        if (location[field] === undefined || location[field] === null) {
          issues.push(
            issue(
              "error",
              "record_location_field_missing",
              `Location of kind ${location.kind} is missing "${field}".`,
              `${locationPath}.${field}`,
            ),
          );
        }
      }
    }
  }
  return issues;
};

/** Treat a malformed collection as empty so validation reports, never crashes. */
const asArray = (value) => (Array.isArray(value) ? value : []);

/** Index a validated bundle for citation lookups. */
export const indexBundle = (bundle) => {
  const records = new Map();
  for (const record of asArray(bundle?.records)) {
    if (typeof record?.evidence_id === "string") records.set(record.evidence_id, record);
  }
  const unknowns = new Map();
  for (const unknown of asArray(bundle?.unknowns)) {
    if (typeof unknown?.unknown_id === "string") unknowns.set(unknown.unknown_id, unknown);
  }
  const artifacts = new Map();
  for (const artifact of asArray(bundle?.artifacts)) {
    const sha = artifact?.digest?.sha256;
    if (typeof sha === "string") artifacts.set(sha, artifact);
  }
  return { records, unknowns, artifacts };
};

/** Records whose status still leaves the question open. */
export const openUnknowns = (bundle) =>
  asArray(bundle?.unknowns).filter((unknown) => unknown?.status !== "resolved");

const issue = (level, code, message, path, detail) => ({ level, code, message, path, ...(detail ? { detail } : {}) });

export { isPlainObject, issue };