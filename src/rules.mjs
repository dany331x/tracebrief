/**
 * Evidence integrity rules.
 *
 * These checks are the point of the project. They run against an authored
 * report and the REA Evidence bundle it claims to come from, and they refuse
 * assertion classes that the cited evidence cannot support:
 *
 * - a citation that is not in the bundle (fabricated or hallucinated id)
 * - a claim with no evidence at all
 * - runtime behavior asserted from static-only authority
 * - "this is the original source" asserted without a historical source record
 * - a structural or behavioral claim resting only on inferred records
 * - a residual unknown the investigation knows about but the report omits
 *
 * They deliberately do not judge prose. A validator can prove that a citation
 * exists; it cannot prove that a sentence reads the cited bytes correctly.
 */
import {
  RUNTIME_AUTHORITIES,
  SOURCE_AUTHORITIES,
  indexBundle,
  isPlainObject,
  openUnknowns,
} from "./bundle.mjs";


const SECTIONS = ["findings", "relationships"];

/** Run every integrity rule. Returns issues ordered by severity then code. */
export const checkIntegrity = (report, bundle, { bundleDigest = null } = {}) => {
  const issues = [];
  // Integrity rules assume a report document. When there is none, the schema
  // pass has already reported it; emitting a cascade of "missing field" issues
  // on top would bury the real diagnostic.
  if (!isPlainObject(report)) return issues;
  const index = indexBundle(bundle);

  issues.push(...checkBundleDigest(report, bundleDigest));

  for (const section of SECTIONS) {
    for (const [position, claim] of asArray(report?.[section]).entries()) {
      const path = `${section}[${position}]`;
      issues.push(...checkClaim(claim, path, index, report));
    }
  }

  issues.push(...checkResidualUnknowns(report, bundle));
  issues.push(...checkOpenQuestionUnknowns(report, bundle));
  issues.push(...checkReproduction(report, index));
  issues.push(...checkSummary(report, index));
  issues.push(...checkTarget(report, index));
  issues.push(...checkDuplicateStatements(report));

  return sortIssues(issues);
};

const checkClaim = (claim, path, index, report) => {
  const issues = [];
  if (typeof claim !== "object" || claim === null) return issues;

  // Iterate the author's raw list so the reported offset is the index they wrote,
  // even when a non-string entry was filtered out above.
  const rawIds = asArray(claim.evidence_ids);
  const records = [];
  for (const [offset, value] of rawIds.entries()) {
    if (typeof value !== "string") continue;
    const record = index.records.get(value);
    if (!record) {
      issues.push({
        level: "error",
        code: "evidence_not_in_bundle",
        message: `Citation ${value} is not present in the Evidence bundle.`,
        path: `${path}.evidence_ids[${offset}]`,
      });
      continue;
    }
    // Keep the citation index so a reported path points at the id the author
    // actually wrote, not at a filtered position.
    records.push({ offset, id: value, record });
  }
  const only = records.map((entry) => entry.record);

  const kind = claim.kind;
  const claimType = claim.claim_type;

  if (kind !== "unknown" && records.length === 0) {
    issues.push({
      level: "error",
      code: "claim_without_evidence",
      message: `Claim of kind "${kind}" cites no Evidence. Cite an ev_ id or mark it unknown.`,
      path: `${path}.evidence_ids`,
    });
  }

  if (records.length > 0 && claimType !== "runtime-behavior" && claimType !== "source-equivalence") {
    if (claimType !== "analysis-coverage" && only.every((record) => record.confidence === "inferred")) {
      issues.push({
        level: "error",
        code: "claim_requires_observed_basis",
        message:
          'A structure or behavior claim may not rest only on records whose confidence is "inferred". Report it as an analysis-coverage claim or cite an observed or derived record.',
        path: `${path}.evidence_ids`,
      });
    }
  }

  if (claimType === "runtime-behavior" && records.length > 0) {
    const witnessed = only.filter((record) => RUNTIME_AUTHORITIES.includes(record.authority));
    if (witnessed.length === 0) {
      issues.push({
        level: "error",
        code: "runtime_claim_without_runtime_authority",
        message: `Runtime behavior requires at least one cited record with authority ${RUNTIME_AUTHORITIES.join(" or ")}. Cited authorities: ${describeAuthorities(only)}. Static analysis does not witness execution.`,
        path: `${path}.claim_type`,
      });
    }
  }

  if (claimType === "source-equivalence" && records.length > 0) {
    const historical = only.filter((record) => SOURCE_AUTHORITIES.includes(record.authority));
    if (historical.length === 0) {
      issues.push({
        level: "error",
        code: "source_equivalence_without_historical_source",
        message:
          "A source-equivalence claim requires a cited historical-reference record. Decompiled or reconstructed output is not the original source.",
        path: `${path}.claim_type`,
      });
    }
  }

  const targetDigest = report?.target?.artifact_digest;
  if (typeof targetDigest === "string") {
    for (const { offset, record } of records) {
      const subjectDigest = record.subject?.digest?.sha256;
      if (subjectDigest && subjectDigest !== targetDigest) {
        issues.push({
          level: "error",
          code: "evidence_subject_mismatch",
          message: `Cited evidence describes artifact ${subjectDigest}, not the reported target ${targetDigest}.`,
          path: `${path}.evidence_ids[${offset}]`,
        });
      }
    }
  }

  if (records.length > 0 && only.every((record) => record.subject == null)) {
    issues.push({
      level: "warning",
      code: "evidence_subject_unavailable",
      message:
        "Cited records carry no artifact subject, so this claim cannot be tied to a digest by TraceBrief. The claim's own evidence_links chain is the only provenance.",
      path: `${path}.evidence_ids`,
    });
  }

  for (const { offset, record } of records) {
    for (const link of asArray(record.evidence_links)) {
      if (!index.records.has(link)) {
        issues.push({
          level: "warning",
          code: "evidence_link_unresolved",
          message: `Cited record ${record.evidence_id} links to ${link}, which is not in this bundle.`,
          path: `${path}.evidence_ids[${offset}]`,
        });
      }
    }
  }

  // Acknowledging a limitation means naming it, not merely supplying some text.
  // The bar is "quotes at least one carried limitation", not "quotes all of
  // them": a record may carry a dozen, and an unmeetable rule teaches authors to
  // ignore warnings. The rendered report always prints every carried limitation
  // in its own section, so nothing is hidden from the reader either way.
  const carried = recordLimitations(only);
  const acknowledged = asArray(claim.limitations).filter(
    (entry) => typeof entry === "string" && entry.trim().length > 0,
  );
  const carriedOntoClaim = carried.filter((limitation) => acknowledgesAny(acknowledged, limitation));
  if (carried.length > 0 && carriedOntoClaim.length === 0) {
    issues.push({
      level: "warning",
      code: "claim_limitations_not_carried",
      message: `None of the ${carried.length} limitation(s) on the cited records is acknowledged on this claim: ${truncate(carried.join(" | "), 200)}`,
      path: `${path}.limitations`,
    });
  }

  return issues;
};

/**
 * A report that pins a bundle digest must be validated against that exact
 * bundle. Without this, a stale report re-renders cleanly against a different
 * bundle and the reader has no way to notice except by comparing two hex
 * strings by eye.
 */
const checkBundleDigest = (report, bundleDigest) => {
  const declared = report?.bundle_digest;
  if (typeof declared !== "string") return [];
  if (!bundleDigest) {
    return [
      {
        level: "warning",
        code: "bundle_digest_unverified",
        message:
          "Report pins a bundle_digest but no bundle file digest was available to compare it against.",
        path: "bundle_digest",
      },
    ];
  }
  if (declared === bundleDigest) return [];
  return [
    {
      level: "error",
      code: "bundle_digest_mismatch",
      message: `Report was written against bundle ${declared}, but the supplied bundle is ${bundleDigest}. The evidence may have changed.`,
      path: "bundle_digest",
    },
  ];
};

/**
 * A limitation counts as carried when the claim quotes it, ignoring case and
 * spacing. Quoting must be substantive: a full quote, or a contiguous run of at
 * least MIN_QUOTE_WORDS words from it (or the whole limitation when it is
 * shorter). A single character that happens to occur in the limitation is not an
 * acknowledgement, and neither is a phrase lifted from somewhere else.
 */
const MIN_QUOTE_WORDS = 4;

const acknowledgesAny = (acknowledged, limitation) => {
  const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const target = normalize(limitation);
  if (target.length === 0) return false;
  const targetWords = target.split(" ");
  const runLength = Math.min(MIN_QUOTE_WORDS, targetWords.length);
  return acknowledged.some((entry) => {
    if (typeof entry !== "string") return false;
    const candidate = normalize(entry);
    if (candidate.length === 0) return false;
    if (candidate.includes(target)) return true;
    for (let start = 0; start + runLength <= targetWords.length; start += 1) {
      const run = targetWords.slice(start, start + runLength).join(" ");
      if (candidate.includes(run)) return true;
    }
    return false;
  });
};

const truncate = (text, limit) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** Treat a malformed collection as empty so rules report, never crash. */
const asArray = (value) => (Array.isArray(value) ? value : []);

const checkResidualUnknowns = (report, bundle) => {
  const issues = [];
  const open = openUnknowns(bundle);
  if (open.length === 0) return issues;
  const carried = new Set(
    asArray(report?.open_questions)
      .map((question) => question?.unknown_id)
      .filter((id) => typeof id === "string"),
  );
  for (const [offset, unknown] of open.entries()) {
    if (!carried.has(unknown.unknown_id)) {
      issues.push({
        level: "error",
        code: "residual_unknown_not_carried",
        message: `Residual unknown ${unknown.unknown_id} (${unknown.status}) is absent from open_questions. Carry it with its unknown_id or resolve it in the session first.`,
        path: `open_questions`,
        detail: { unknown_index: offset },
      });
    }
  }
  return issues;
};

/**
 * An open question must not present a residual unknown as still open unless that
 * unknown exists in the bundle and is genuinely unresolved. Otherwise a report
 * can show a live-looking gap backed by a resolved unknown, or by an invented
 * `unk_` id that never existed.
 */
const checkOpenQuestionUnknowns = (report, bundle) => {
  const issues = [];
  const index = indexBundle(bundle);
  for (const [position, question] of asArray(report?.open_questions).entries()) {
    const declared = question?.unknown_id;
    if (typeof declared !== "string") continue;
    const unknown = index.unknowns.get(declared);
    const path = `open_questions[${position}].unknown_id`;
    if (!unknown) {
      issues.push({
        level: "error",
        code: "open_question_unknown_not_in_bundle",
        message: `Open question cites residual unknown ${declared}, which is not in this bundle.`,
        path,
      });
      continue;
    }
    if (unknown.status === "resolved") {
      issues.push({
        level: "error",
        code: "open_question_unknown_resolved",
        message: `Open question cites residual unknown ${declared}, which the bundle records as resolved. Present it in the summary instead of as an open question.`,
        path,
      });
    }
  }
  return issues;
};

/**
 * Two claims with the same statement are almost always one finding restated,
 * which inflates the appearance of corroboration. Flagged rather than rejected:
 * deliberate repetition is possible, and a false rejection would be worse than
 * a reviewable warning.
 */
const checkDuplicateStatements = (report) => {
  const issues = [];
  const seen = new Map();
  for (const section of SECTIONS) {
    for (const [position, claim] of asArray(report?.[section]).entries()) {
      const statement = typeof claim?.statement === "string" ? claim.statement : null;
      if (statement === null || statement.trim().length === 0) continue;
      const normalized = statement.toLowerCase().replace(/\s+/g, " ").trim();
      const first = seen.get(normalized);
      if (first) {
        issues.push({
          level: "warning",
          code: "claim_statement_duplicated",
          message: `Claim statement is identical to ${first.id} in ${first.section}. One finding restated does not corroborate it.`,
          path: `${section}[${position}].statement`,
        });
      } else {
        seen.set(normalized, { id: claim?.id ?? "an earlier claim", section });
      }
    }
  }
  return issues;
};

const checkReproduction = (report, index) => {
  const issues = [];
  const toolVersions = asArray(report?.reproduction?.tool_versions);
  for (const [position, entry] of toolVersions.entries()) {
    const path = `reproduction.tool_versions[${position}]`;
    const cited = asArray(entry?.evidence_ids);
    if (cited.length === 0) {
      issues.push({
        level: "warning",
        code: "tool_version_unverified",
        message: `Tool version for "${entry?.name}" is asserted without evidence. Cite the record that reported it.`,
        path,
      });
      continue;
    }
    issues.push(...missingCitationIssues(cited, path, index));
  }

  const commands = asArray(report?.reproduction?.commands);
  for (const [position, entry] of commands.entries()) {
    const path = `reproduction.commands[${position}]`;
    if (asArray(entry?.evidence_ids).length === 0) {
      issues.push({
        level: "warning",
        code: "command_unverified",
        message: `Reproduction command "${entry?.command}" has no evidence citation. Say so in the report if it was not verified.`,
        path,
      });
    } else {
      issues.push(...missingCitationIssues(asArray(entry.evidence_ids), path, index));
    }
  }
  return issues;
};

const checkSummary = (report, index) => {
  const issues = [];
  const allClaims = SECTIONS.flatMap((section) => asArray(report?.[section]));
  const claimIds = new Set(allClaims.map((claim) => claim?.id));
  for (const id of asArray(report?.summary?.established)) {
    if (!claimIds.has(id)) continue;
    const claim = allClaims.find((candidate) => candidate?.id === id);
    if (claim?.kind === "unknown") {
      issues.push({
        level: "error",
        code: "summary_establishes_unknown",
        message: `summary.established lists ${id}, which is marked unknown.`,
        path: "summary.established",
      });
    }
  }
  void index;
  return issues;
};

const checkTarget = (report, index) => {
  const issues = [];
  const digest = report?.target?.artifact_digest;
  if (typeof digest === "string") {
    if (!index.artifacts.has(digest)) {
      issues.push({
        level: "error",
        code: "target_not_in_bundle",
        message: `target.artifact_digest ${digest} does not appear in the bundle artifacts.`,
        path: "target.artifact_digest",
      });
    }
  } else {
    // Without a digest, cross-artifact verification is silently disabled. That
    // must never pass unnoticed: the report could cite any artifact's evidence.
    issues.push({
      level: "warning",
      code: "target_digest_missing",
      message:
        "target.artifact_digest is not set, so TraceBrief cannot verify that cited evidence describes the reported artifact. Cross-artifact verification is disabled.",
      path: "target.artifact_digest",
    });
  }
  return issues;
};

const missingCitationIssues = (cited, path, index) =>
  cited
    .map((id, offset) => ({ id, offset }))
    .filter(({ id }) => typeof id === "string" && !index.records.has(id))
    .map(({ id, offset }) => ({
      level: "error",
      code: "evidence_not_in_bundle",
      message: `Citation ${id} is not present in the Evidence bundle.`,
      path: `${path}.evidence_ids[${offset}]`,
    }));

const recordLimitations = (records) => {
  const seen = new Set();
  for (const record of records) {
    for (const limitation of asArray(record?.limitations)) {
      if (typeof limitation === "string" && limitation.trim().length > 0) seen.add(limitation);
    }
  }
  return [...seen];
};

const describeAuthorities = (records) =>
  [...new Set(records.map((record) => record.authority))].sort().join(", ");

export { CLAIM_TYPES } from "./report.mjs";

const sortIssues = (issues) =>
  [...issues].sort((a, b) => {
    if (a.level !== b.level) return a.level === "error" ? -1 : 1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return (a.path ?? "") < (b.path ?? "") ? -1 : 1;
  });

/** Every evidence id the report cites, de-duplicated and sorted. */
export const citedEvidenceIds = (report) => {
  const ids = new Set();
  const add = (list) => {
    for (const id of asArray(list)) if (typeof id === "string") ids.add(id);
  };
  for (const section of SECTIONS) {
    for (const claim of asArray(report[section])) add(claim?.evidence_ids);
  }
  for (const question of asArray(report?.open_questions)) add(question?.evidence_ids);
  for (const key of ["tool_versions", "commands"]) {
    for (const entry of asArray(report?.reproduction?.[key])) add(entry?.evidence_ids);
  }
  return [...ids].sort();
};