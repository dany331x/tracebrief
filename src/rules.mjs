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
  openUnknowns,
} from "./bundle.mjs";


const SECTIONS = ["findings", "relationships"];

/** Run every integrity rule. Returns issues ordered by severity then code. */
export const checkIntegrity = (report, bundle) => {
  const issues = [];
  const index = indexBundle(bundle);

  for (const section of SECTIONS) {
    for (const [position, claim] of (report[section] ?? []).entries()) {
      const path = `${section}[${position}]`;
      issues.push(...checkClaim(claim, path, index, report));
    }
  }

  issues.push(...checkResidualUnknowns(report, bundle));
  issues.push(...checkReproduction(report, index));
  issues.push(...checkSummary(report, index));
  issues.push(...checkTarget(report, index));

  return sortIssues(issues);
};

const checkClaim = (claim, path, index, report) => {
  const issues = [];
  if (typeof claim !== "object" || claim === null) return issues;

  const cited = (claim.evidence_ids ?? []).filter((id) => typeof id === "string");
  const records = [];
  for (const [offset, id] of cited.entries()) {
    const record = index.records.get(id);
    if (!record) {
      issues.push({
        level: "error",
        code: "evidence_not_in_bundle",
        message: `Citation ${id} is not present in the Evidence bundle.`,
        path: `${path}.evidence_ids[${offset}]`,
      });
      continue;
    }
    records.push(record);
  }

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
    if (claimType !== "analysis-coverage" && records.every((record) => record.confidence === "inferred")) {
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
    const witnessed = records.filter((record) => RUNTIME_AUTHORITIES.includes(record.authority));
    if (witnessed.length === 0) {
      issues.push({
        level: "error",
        code: "runtime_claim_without_runtime_authority",
        message: `Runtime behavior requires at least one cited record with authority ${RUNTIME_AUTHORITIES.join(" or ")}. Cited authorities: ${describeAuthorities(records)}. Static analysis does not witness execution.`,
        path: `${path}.claim_type`,
      });
    }
  }

  if (claimType === "source-equivalence" && records.length > 0) {
    const historical = records.filter((record) => SOURCE_AUTHORITIES.includes(record.authority));
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
    for (const [offset, record] of records.entries()) {
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

  if (records.length > 0 && records.every((record) => record.subject == null)) {
    issues.push({
      level: "warning",
      code: "evidence_subject_unavailable",
      message:
        "Cited records carry no artifact subject, so this claim cannot be tied to a digest by TraceBrief. The claim's own evidence_links chain is the only provenance.",
      path: `${path}.evidence_ids`,
    });
  }

  for (const [offset, record] of records.entries()) {
    for (const link of record.evidence_links ?? []) {
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

  const carried = recordLimitations(records);
  if (carried.length > 0 && (claim.limitations ?? []).length === 0) {
    issues.push({
      level: "warning",
      code: "claim_limitations_not_carried",
      message: `${carried.length} limitation(s) on the cited records are not acknowledged on this claim.`,
      path: `${path}.limitations`,
    });
  }

  return issues;
};

const checkResidualUnknowns = (report, bundle) => {
  const issues = [];
  const open = openUnknowns(bundle);
  if (open.length === 0) return issues;
  const carried = new Set(
    (report.open_questions ?? [])
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

const checkReproduction = (report, index) => {
  const issues = [];
  const toolVersions = report.reproduction?.tool_versions ?? [];
  for (const [position, entry] of toolVersions.entries()) {
    const path = `reproduction.tool_versions[${position}]`;
    const cited = entry?.evidence_ids ?? [];
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

  const commands = report.reproduction?.commands ?? [];
  for (const [position, entry] of commands.entries()) {
    const path = `reproduction.commands[${position}]`;
    if ((entry?.evidence_ids ?? []).length === 0) {
      issues.push({
        level: "warning",
        code: "command_unverified",
        message: `Reproduction command "${entry?.command}" has no evidence citation. Say so in the report if it was not verified.`,
        path,
      });
    } else {
      issues.push(...missingCitationIssues(entry.evidence_ids, path, index));
    }
  }
  return issues;
};

const checkSummary = (report, index) => {
  const issues = [];
  const claimIds = new Set(
    SECTIONS.flatMap((section) => (report[section] ?? []).map((claim) => claim?.id)),
  );
  for (const id of report.summary?.established ?? []) {
    if (!claimIds.has(id)) continue;
    const claim = SECTIONS.flatMap((section) => report[section] ?? []).find(
      (candidate) => candidate?.id === id,
    );
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
  const digest = report.target?.artifact_digest;
  if (typeof digest === "string" && !index.artifacts.has(digest)) {
    issues.push({
      level: "error",
      code: "target_not_in_bundle",
      message: `target.artifact_digest ${digest} does not appear in the bundle artifacts.`,
      path: "target.artifact_digest",
    });
  }
  return issues;
};

const missingCitationIssues = (cited, path, index) =>
  cited
    .filter((id) => typeof id === "string" && !index.records.has(id))
    .map((id, offset) => ({
      level: "error",
      code: "evidence_not_in_bundle",
      message: `Citation ${id} is not present in the Evidence bundle.`,
      path: `${path}.evidence_ids[${offset}]`,
    }));

const recordLimitations = (records) => {
  const seen = new Set();
  for (const record of records) {
    for (const limitation of record.limitations ?? []) {
      if (typeof limitation === "string") seen.add(limitation);
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
  for (const section of SECTIONS) {
    for (const claim of report[section] ?? []) {
      for (const id of claim?.evidence_ids ?? []) if (typeof id === "string") ids.add(id);
    }
  }
  for (const question of report.open_questions ?? []) {
    for (const id of question?.evidence_ids ?? []) if (typeof id === "string") ids.add(id);
  }
  for (const key of ["tool_versions", "commands"]) {
    for (const entry of report.reproduction?.[key] ?? []) {
      for (const id of entry?.evidence_ids ?? []) if (typeof id === "string") ids.add(id);
    }
  }
  return [...ids].sort();
};