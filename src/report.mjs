/**
 * Structural validation of the TraceBrief report document.
 *
 * The report is authored by an agent from investigation context; this module
 * only checks that the document is well formed so that later integrity rules
 * and the renderer can rely on its shape. Semantic checks live in rules.mjs.
 */
import { EVIDENCE_ID_PATTERN, UNKNOWN_ID_PATTERN, SHA256_PATTERN, isPlainObject, issue } from "./bundle.mjs";

export const REPORT_SCHEMA = "tracebrief/report@1";

export const CLAIM_KINDS = Object.freeze(["observed", "derived", "inferred", "unknown"]);

/**
 * claim_type is what the claim asserts about the target, not how it was
 * learned. It exists so integrity rules can reject unsupported assertion
 * classes instead of guessing from prose.
 *
 * `analysis-coverage` is the escape hatch for statements about the analysis
 * itself ("this trace matched no seeds", "this record has no subject"), which
 * must not be forced through the target-assertion rules: an honest report of
 * what the evidence cannot support is a first-class result, not a defect.
 */
export const CLAIM_TYPES = Object.freeze([
  "structure",
  "behavior",
  "runtime-behavior",
  "source-equivalence",
  "analysis-coverage",
]);

export const OPEN_QUESTION_STATUSES = Object.freeze([
  "open",
  "investigating",
  "blocked",
  "contradicted",
]);

export const REQUIRED_TOP_LEVEL_KEYS = Object.freeze([
  "schema",
  "title",
  "question",
  "target",
  "reproduction",
  "findings",
  "relationships",
  "open_questions",
  "summary",
]);

/**
 * Optional top-level keys TraceBrief understands. `bundle_digest` pins a report
 * to the exact bundle it was written against, so a later validation against a
 * different bundle can detect the drift instead of silently re-rendering.
 */
export const OPTIONAL_TOP_LEVEL_KEYS = Object.freeze(["bundle_digest"]);

export const validateReport = (report) => {
  const issues = [];
  if (!isPlainObject(report)) {
    issues.push(issue("error", "report_not_object", "Report is not a JSON object.", ""));
    return issues;
  }

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in report)) issues.push(issue("error", "report_key_missing", `Report is missing "${key}".`, key));
  }
  for (const key of Object.keys(report)) {
    if (!REQUIRED_TOP_LEVEL_KEYS.includes(key) && !OPTIONAL_TOP_LEVEL_KEYS.includes(key)) {
      issues.push(issue("warning", "report_key_unknown", `Unexpected report key "${key}".`, key));
    }
  }

  // An explicit null would look pinned while verifying nothing, so only omit the
  // field or supply a real digest.
  if ("bundle_digest" in report && report.bundle_digest !== undefined) {
    if (typeof report.bundle_digest !== "string" || !SHA256_PATTERN.test(report.bundle_digest)) {
      issues.push(
        issue(
          "error",
          "report_bundle_digest_malformed",
          "bundle_digest must be a sha256 hex digest. Omit the field entirely if the report is not pinned to a bundle.",
          "bundle_digest",
        ),
      );
    }
  }

  if (report.schema !== REPORT_SCHEMA) {
    issues.push(
      issue(
        "error",
        "report_schema_mismatch",
        `Report schema must be ${JSON.stringify(REPORT_SCHEMA)}.`,
        "schema",
      ),
    );
  }
  issues.push(...requireText(report.title, "title"));
  issues.push(...requireText(report.question, "question"));

  if ("target" in report) issues.push(...validateTarget(report.target));
  if ("reproduction" in report) issues.push(...validateReproduction(report.reproduction));

  const claimIds = new Map();
  for (const section of ["findings", "relationships"]) {
    if (!(section in report)) continue;
    const claims = report[section];
    if (!Array.isArray(claims)) {
      issues.push(issue("error", "report_section_invalid", `"${section}" must be an array.`, section));
      continue;
    }
    for (const [index, claim] of claims.entries()) {
      const path = `${section}[${index}]`;
      const claimIssues = validateClaim(claim, path);
      issues.push(...claimIssues);
      if (isPlainObject(claim) && typeof claim.id === "string") {
        if (claimIds.has(claim.id)) {
          issues.push(issue("error", "claim_id_duplicated", `Duplicate claim id ${claim.id}.`, path));
        } else {
          claimIds.set(claim.id, path);
        }
      }
    }
  }

  if ("open_questions" in report) issues.push(...validateOpenQuestions(report.open_questions));
  if ("summary" in report) issues.push(...validateSummary(report.summary, claimIds));
  return issues;
};

const validateTarget = (target) => {
  const issues = [];
  if (!isPlainObject(target)) {
    issues.push(issue("error", "target_invalid", "Target must be an object.", "target"));
    return issues;
  }
  issues.push(...requireText(target.name, "target.name"));
  for (const key of ["version", "format", "architecture", "local_path"]) {
    const value = target[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      issues.push(issue("error", "target_field_invalid", `target.${key} must be a string or null.`, `target.${key}`));
    }
  }
  if (typeof target.artifact_digest === "string" && !SHA256_PATTERN.test(target.artifact_digest)) {
    issues.push(
      issue(
        "error",
        "target_digest_malformed",
        "target.artifact_digest must be a sha256 hex digest.",
        "target.artifact_digest",
      ),
    );
  }
  return issues;
};

const validateReproduction = (reproduction) => {
  const issues = [];
  if (!isPlainObject(reproduction)) {
    issues.push(issue("error", "reproduction_invalid", "Reproduction must be an object.", "reproduction"));
    return issues;
  }
  for (const key of ["environment", "tool_versions", "commands"]) {
    if (!(key in reproduction)) {
      issues.push(
        issue("error", "reproduction_key_missing", `Reproduction is missing "${key}".`, `reproduction.${key}`),
      );
    }
  }
  if (Array.isArray(reproduction.environment)) {
    for (const [index, value] of reproduction.environment.entries()) {
      if (typeof value !== "string") {
        issues.push(
          issue(
            "error",
            "reproduction_environment_invalid",
            "Reproduction environment entries must be strings.",
            `reproduction.environment[${index}]`,
          ),
        );
      }
    }
  } else if (reproduction.environment !== undefined) {
    issues.push(
      issue(
        "error",
        "reproduction_environment_invalid",
        "reproduction.environment must be an array.",
        "reproduction.environment",
      ),
    );
  }
  for (const [key, labelKey] of [
    ["tool_versions", "name"],
    ["commands", "command"],
  ]) {
    const entries = reproduction[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      issues.push(issue("error", "reproduction_list_invalid", `reproduction.${key} must be an array.`, `reproduction.${key}`));
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      const path = `reproduction.${key}[${index}]`;
      if (!isPlainObject(entry)) {
        issues.push(issue("error", "reproduction_entry_invalid", "Entry must be an object.", path));
        continue;
      }
      if (typeof entry[labelKey] !== "string" || entry[labelKey].length === 0) {
        issues.push(
          issue("error", "reproduction_entry_invalid", `Entry is missing a non-empty "${labelKey}".`, `${path}.${labelKey}`),
        );
      }
      if (key === "tool_versions" && entry.version !== undefined && typeof entry.version !== "string") {
        issues.push(
          issue("error", "reproduction_entry_invalid", "Tool version must be a string.", `${path}.version`),
        );
      }
      if (key === "commands" && entry.purpose !== undefined && typeof entry.purpose !== "string") {
        issues.push(
          issue("error", "reproduction_entry_invalid", "Command purpose must be a string.", `${path}.purpose`),
        );
      }
      issues.push(...validateEvidenceIdList(entry.evidence_ids, `${path}.evidence_ids`));
    }
  }
  return issues;
};

export const validateClaim = (claim, path) => {
  const issues = [];
  if (!isPlainObject(claim)) {
    issues.push(issue("error", "claim_invalid", "Claim must be an object.", path));
    return issues;
  }
  issues.push(...requireText(claim.id, `${path}.id`));
  issues.push(...requireText(claim.statement, `${path}.statement`));
  if (!CLAIM_KINDS.includes(claim.kind)) {
    issues.push(
      issue(
        "error",
        "claim_kind_invalid",
        `Claim kind ${JSON.stringify(claim.kind)} must be one of ${CLAIM_KINDS.join(", ")}.`,
        `${path}.kind`,
      ),
    );
  }
  if (!CLAIM_TYPES.includes(claim.claim_type)) {
    issues.push(
      issue(
        "error",
        "claim_type_invalid",
        `Claim type ${JSON.stringify(claim.claim_type)} must be one of ${CLAIM_TYPES.join(", ")}.`,
        `${path}.claim_type`,
      ),
    );
  }
  issues.push(...validateEvidenceIdList(claim.evidence_ids, `${path}.evidence_ids`));
  if (claim.limitations !== undefined) {
    if (!Array.isArray(claim.limitations)) {
      issues.push(issue("error", "claim_limitations_invalid", "Claim limitations must be an array.", `${path}.limitations`));
    } else {
      for (const [index, value] of claim.limitations.entries()) {
        if (typeof value !== "string") {
          issues.push(
            issue(
              "error",
              "claim_limitations_invalid",
              "Claim limitation entries must be strings.",
              `${path}.limitations[${index}]`,
            ),
          );
          continue;
        }
        if (value.trim().length === 0) {
          // An empty string would satisfy a naive "did the author acknowledge
          // anything?" check while acknowledging nothing.
          issues.push(
            issue(
              "error",
              "claim_limitation_empty",
              "Claim limitation entries must be non-empty: quote the limitation from the cited record.",
              `${path}.limitations[${index}]`,
            ),
          );
        }
      }
    }
  }
  return issues;
};

const validateEvidenceIdList = (value, path) => {
  const issues = [];
  if (value === undefined) {
    issues.push(issue("error", "evidence_ids_missing", "Field is required; use [] when nothing was cited.", path));
    return issues;
  }
  if (!Array.isArray(value)) {
    issues.push(issue("error", "evidence_ids_invalid", "Field must be an array of evidence ids.", path));
    return issues;
  }
  for (const [index, id] of value.entries()) {
    if (typeof id !== "string" || !EVIDENCE_ID_PATTERN.test(id)) {
      issues.push(
        issue(
          "error",
          "evidence_id_malformed",
          `Citation ${JSON.stringify(id)} is not ev_<64 lowercase hex>.`,
          `${path}[${index}]`,
        ),
      );
    }
  }
  return issues;
};

const validateOpenQuestions = (questions) => {
  const issues = [];
  if (!Array.isArray(questions)) {
    issues.push(issue("error", "open_questions_invalid", "open_questions must be an array.", "open_questions"));
    return issues;
  }
  const seen = new Set();
  for (const [index, question] of questions.entries()) {
    const path = `open_questions[${index}]`;
    if (!isPlainObject(question)) {
      issues.push(issue("error", "open_question_invalid", "Open question must be an object.", path));
      continue;
    }
    issues.push(...requireText(question.id, `${path}.id`));
    if (typeof question.id === "string") {
      if (seen.has(question.id)) {
        issues.push(issue("error", "open_question_id_duplicated", `Duplicate id ${question.id}.`, path));
      }
      seen.add(question.id);
    }
    issues.push(...requireText(question.question, `${path}.question`));
    if (!OPEN_QUESTION_STATUSES.includes(question.status)) {
      issues.push(
        issue(
          "error",
          "open_question_status_invalid",
          `Status ${JSON.stringify(question.status)} must be one of ${OPEN_QUESTION_STATUSES.join(", ")}.`,
          `${path}.status`,
        ),
      );
    }
    if (question.unknown_id !== undefined && !UNKNOWN_ID_PATTERN.test(String(question.unknown_id))) {
      issues.push(
        issue(
          "error",
          "open_question_unknown_id_malformed",
          "unknown_id must be unk_<64 lowercase hex>.",
          `${path}.unknown_id`,
        ),
      );
    }
    issues.push(...validateEvidenceIdList(question.evidence_ids, `${path}.evidence_ids`));
  }
  return issues;
};

const validateSummary = (summary, claimIds) => {
  const issues = [];
  if (!isPlainObject(summary)) {
    issues.push(issue("error", "summary_invalid", "Summary must be an object.", "summary"));
    return issues;
  }
  for (const key of ["established", "not_established"]) {
    if (!Array.isArray(summary[key])) {
      issues.push(issue("error", "summary_field_invalid", `summary.${key} must be an array.`, `summary.${key}`));
    }
  }
  for (const [index, id] of (summary.established ?? []).entries()) {
    if (typeof id !== "string") {
      issues.push(
        issue("error", "summary_field_invalid", "summary.established entries must be claim ids.", `summary.established[${index}]`),
      );
      continue;
    }
    if (!claimIds.has(id)) {
      issues.push(
        issue(
          "error",
          "summary_claim_unknown",
          `summary.established references claim ${id}, which is not defined in findings or relationships.`,
          `summary.established[${index}]`,
        ),
      );
    }
  }
  for (const [index, entry] of (summary.not_established ?? []).entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      issues.push(
        issue(
          "error",
          "summary_field_invalid",
          "summary.not_established entries must be non-empty strings.",
          `summary.not_established[${index}]`,
        ),
      );
    }
  }
  return issues;
};

const requireText = (value, path) =>
  typeof value === "string" && value.trim().length > 0
    ? []
    : [issue("error", "text_missing", "Field must be a non-empty string.", path)];