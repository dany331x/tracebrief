/**
 * Deterministic Markdown rendering.
 *
 * Rendering is a pure function of (report, bundle). No timestamps, no locale
 * formatting, no randomness: the same inputs produce byte-identical output, so
 * a regenerated report shows only real content changes in a diff.
 *
 * Every piece of authored text goes through `prose()` or `code()`. Report text
 * is LLM-authored, and a document that interpolates it raw would let a claim
 * inject headings, tables or code fences into a report whose citations were
 * validated. Flattening whitespace and escaping Markdown metacharacters keeps
 * the document structure the renderer's alone.
 */
import { openUnknowns } from "./bundle.mjs";
import { citedEvidenceIds } from "./rules.mjs";

const NOT_COLLECTED = "_Not collected._";
const UNKNOWN_VALUE = "unknown";
const shortRef = (id) => (typeof id === "string" ? `${id.slice(0, 15)}…` : String(id));

/** Characters that would change document structure if left unescaped. */
const MARKDOWN_INLINE = /([\\`*_[\]<>|])/g;
const MARKDOWN_LEADING = /^([-#>+])/;

/**
 * Flatten authored text to a single line and escape Markdown syntax, so a claim
 * can never introduce a heading, list item, table row or link.
 */
const prose = (value) => {
  if (!isRenderable(value)) return "";
  const flat = String(value).replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";
  return flat.replace(MARKDOWN_INLINE, "\\$1").replace(MARKDOWN_LEADING, "\\$1");
};

/**
 * Flatten for a table cell or code span: no line endings of any kind (a lone CR
 * is a line ending in CommonMark), no cell breaks, no backticks.
 */
const inline = (value) => {
  if (!isRenderable(value)) return "";
  return String(value)
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "'")
    .trim();
};

/** Inline code span. Backticks are replaced because the span is single-backtick. */
const code = (value) => {
  if (!isRenderable(value)) return "";
  return String(value).replace(/\s+/g, " ").replace(/`/g, "'").trim();
};

/** Only strings and finite numbers are rendered; anything else is treated as absent. */
const isRenderable = (value) =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export const renderMarkdown = (report, bundle, { bundleDigest = null, invalid = false, issues = [] } = {}) => {
  const safeReport = isObject(report) ? report : {};
  const safeBundle = isObject(bundle) ? bundle : {};
  const cited = citedEvidenceIds(safeReport);
  const records = Array.isArray(safeBundle.records) ? safeBundle.records : [];
  const citedRecords = cited
    .map((id) => records.find((record) => isObject(record) && record.evidence_id === id))
    .filter(Boolean);

  const lines = [];
  lines.push(`# ${prose(safeReport.title) || "TraceBrief report"}`);
  lines.push("");
  if (invalid) lines.push(...renderInvalidBanner(issues));
  lines.push("## Investigation question");
  lines.push("");
  lines.push(prose(safeReport.question) || NOT_COLLECTED);
  lines.push("");

  lines.push(...renderTarget(safeReport, safeBundle));
  lines.push(...renderClaims("Key findings", safeReport.findings, citedRecords));
  lines.push(...renderClaims("Relationships", safeReport.relationships, citedRecords));
  lines.push(...renderConfidence(citedRecords));
  lines.push(...renderReproduction(safeReport, records));
  lines.push(...renderOpenQuestions(safeReport, safeBundle));
  lines.push(...renderSummary(safeReport));
  lines.push(...renderEvidenceIndex(cited, records, bundleDigest));
  lines.push(...renderProvenance(records, safeBundle, bundleDigest));

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
};

const renderInvalidBanner = (issues) => {
  const errors = issues.filter((entry) => entry.level === "error");
  const lines = [
    "> **This report did not pass validation.** It was written with `--allow-invalid`,",
    `> so at least one claim may be unsupported by evidence (${errors.length} error(s)). Treat it as a draft.`,
    "",
  ];
  for (const entry of errors.slice(0, 10)) {
    // Codes go in a code span; messages are flattened but not escaped, since
    // escaping them would print stray backslashes into a quoted diagnostic.
    lines.push(`> - \`${inline(entry.code)}\` ${inline(entry.message)}`);
  }
  if (errors.length > 10) lines.push(`> - …and ${errors.length - 10} more`);
  lines.push("");
  return lines;
};

const renderTarget = (report, bundle) => {
  const target = isObject(report.target) ? report.target : {};
  const lines = ["## Target overview", ""];
  const rows = [
    ["Name", target.name],
    ["Version", target.version],
    ["Format", target.format],
    ["Architecture", target.architecture],
    ["Artifact digest", target.artifact_digest ? `\`${inline(target.artifact_digest)}\`` : null],
    ["Local path", target.local_path],
  ];
  for (const [label, value] of rows) {
    const shown = label === "Artifact digest" ? value : value ? prose(value) : "";
    lines.push(`- **${label}:** ${shown || `${UNKNOWN_VALUE} — not collected`}`);
  }
  const artifacts = Array.isArray(bundle.artifacts) ? bundle.artifacts : [];
  const inBundle = artifacts.some((artifact) => artifact?.digest?.sha256 === target.artifact_digest);
  if (target.artifact_digest && !inBundle) {
    lines.push("");
    lines.push(
      "> The reported artifact digest is **not** present in `bundle.artifacts`; validation reports this as an error.",
    );
  }
  if (!target.artifact_digest) {
    lines.push("");
    lines.push(
      "> No artifact digest was recorded, so TraceBrief could not verify that the cited evidence describes this target.",
    );
  }
  lines.push("");
  return lines;
};

const renderClaims = (heading, claims, citedRecords) => {
  const lines = [`## ${heading}`, ""];
  if (!Array.isArray(claims) || claims.length === 0) {
    lines.push(NOT_COLLECTED);
    lines.push("");
    return lines;
  }
  const list = claims.map((claim) => (isObject(claim) ? claim : {}));
  list.forEach((claim, index) => {
    const anchors = claimIdsFor(claim);
    lines.push(`### ${index + 1}. ${prose(claim.statement) || "Claim statement missing."}`);
    lines.push("");
    lines.push(`- **Claim id:** \`${inline(claim.id ?? UNKNOWN_VALUE)}\``);
    // Kind and type are always shown: `unknown` is the one label that separates
    // an honest gap from a confident claim, so it must never be dropped.
    lines.push(
      `- **Kind:** ${prose(claim.kind) || UNKNOWN_VALUE} · **Type:** ${prose(claim.claim_type) || UNKNOWN_VALUE}`,
    );
    if (anchors.length > 0) {
      // Mark citations the bundle cannot resolve here too, not only in the
      // index and the tools table.
      const known = new Set(citedRecords.map((record) => record.evidence_id));
      lines.push(
        `- **Evidence:** ${anchors
          .map((id) => `\`${shortRef(id)}\`${known.has(id) ? "" : " **(missing)**"}`)
          .join(", ")}`,
      );
      const observed = citedRecords.filter((record) => anchors.includes(record.evidence_id));
      if (observed.length > 0) {
        const authorities = [...new Set(observed.map((record) => record.authority))].sort();
        const confidences = [...new Set(observed.map((record) => record.confidence))].sort();
        lines.push(
          `- **Cited evidence reports:** authority ${authorities.join(", ")}; confidence ${confidences.join(", ")}`,
        );
      }
    } else {
      lines.push("- **Evidence:** none cited");
    }
    const limitations = Array.isArray(claim.limitations) ? claim.limitations : [];
    if (limitations.length > 0) {
      lines.push("- **Limitations:**");
      for (const limitation of limitations) lines.push(`  - ${prose(limitation) || "limitation text missing"}`);
    }
    lines.push("");
  });
  return lines;
};

const renderConfidence = (citedRecords) => {
  const lines = ["## Confidence and limitations", ""];
  if (citedRecords.length === 0) {
    lines.push(NOT_COLLECTED);
    lines.push("");
    return lines;
  }
  const byConfidence = countBy(citedRecords, (record) => record.confidence);
  const byAuthority = countBy(citedRecords, (record) => record.authority);
  lines.push(
    `- **Confidence of cited evidence:** ${byConfidence.map(([key, count]) => `${key} ${count}`).join(", ")}`,
  );
  lines.push(
    `- **Authority of cited evidence:** ${byAuthority.map(([key, count]) => `${key} ${count}`).join(", ")}`,
  );
  lines.push(
    "- **Reading rule:** `observed` is a direct provider reading, `derived` is computed from observed data, `inferred` is a candidate that static analysis cannot confirm at runtime.",
  );
  lines.push("");
  const limitations = [
    ...new Set(
      citedRecords.flatMap((record) => (Array.isArray(record.limitations) ? record.limitations : [])).filter((l) => typeof l === "string"),
    ),
  ].sort();
  lines.push("Limitations carried by the cited evidence:");
  lines.push("");
  if (limitations.length === 0) {
    lines.push(NOT_COLLECTED);
  } else {
    for (const limitation of limitations) lines.push(`- ${prose(limitation)}`);
  }
  lines.push("");
  return lines;
};

const renderReproduction = (report, records) => {
  const reproduction = isObject(report.reproduction) ? report.reproduction : {};
  const lines = ["## Reproduction", ""];

  lines.push("### Environment");
  lines.push("");
  const environment = Array.isArray(reproduction.environment) ? reproduction.environment : [];
  if (environment.length === 0) lines.push(NOT_COLLECTED);
  else for (const entry of environment) lines.push(`- ${prose(entry) || "environment entry missing"}`);
  lines.push("");

  lines.push("### Tools");
  lines.push("");
  const tools = Array.isArray(reproduction.tool_versions) ? reproduction.tool_versions : [];
  if (tools.length === 0) {
    lines.push(NOT_COLLECTED);
  } else {
    lines.push("| Tool | Version | Evidence |");
    lines.push("| --- | --- | --- |");
    for (const raw of tools) {
      const entry = isObject(raw) ? raw : {};
      lines.push(
        `| ${inline(entry.name) || UNKNOWN_VALUE} | ${inline(entry.version) || UNKNOWN_VALUE} | ${cellRefs(entry.evidence_ids, records)} |`,
      );
    }
  }
  lines.push("");

  lines.push("### Commands");
  lines.push("");
  const commands = Array.isArray(reproduction.commands) ? reproduction.commands : [];
  if (commands.length === 0) {
    lines.push(NOT_COLLECTED);
  } else {
    for (const raw of commands) {
      const entry = isObject(raw) ? raw : {};
      lines.push(`- \`${code(entry.command) || "command missing"}\` — ${prose(entry.purpose) || "purpose not recorded"}${suffixRefs(entry.evidence_ids)}`);
    }
  }
  lines.push("");
  return lines;
};

const renderOpenQuestions = (report, bundle) => {
  const lines = ["## Open questions", ""];
  const declared = Array.isArray(report.open_questions) ? report.open_questions : [];
  if (declared.length === 0 && openUnknowns(bundle).length === 0) {
    lines.push(NOT_COLLECTED);
    lines.push("");
    return lines;
  }
  for (const raw of declared) {
    const question = isObject(raw) ? raw : {};
    const unknownId = question.unknown_id ? ` (${inline(question.unknown_id)})` : "";
    lines.push(
      `- **${prose(question.status) || UNKNOWN_VALUE}**${unknownId} — ${prose(question.question) || "question text missing"}${suffixRefs(question.evidence_ids)}`,
    );
  }
  const carried = new Set(declared.map((question) => question?.unknown_id).filter(Boolean));
  const uncarried = openUnknowns(bundle).filter((unknown) => !carried.has(unknown?.unknown_id));
  if (uncarried.length > 0) {
    lines.push("");
    lines.push("Residual unknowns present in the bundle but not carried into this report:");
    lines.push("");
    for (const unknown of uncarried) {
      lines.push(
        `- \`${inline(unknown?.unknown_id)}\` (${prose(unknown?.status) || UNKNOWN_VALUE}) — ${prose(unknown?.question) || "question not recorded"}`,
      );
    }
  }
  lines.push("");
  return lines;
};

const renderSummary = (report) => {
  const summary = isObject(report.summary) ? report.summary : {};
  const lines = ["## Summary", "", "### Established", ""];
  const established = Array.isArray(summary.established) ? summary.established : [];
  if (established.length === 0) lines.push(NOT_COLLECTED);
  else for (const id of established) lines.push(`- \`${inline(id)}\``);
  lines.push("");
  lines.push("### Not established", "");
  const notEstablished = Array.isArray(summary.not_established) ? summary.not_established : [];
  if (notEstablished.length === 0) lines.push(NOT_COLLECTED);
  else for (const entry of notEstablished) lines.push(`- ${prose(entry) || "not established"}`);
  lines.push("");
  return lines;
};

const renderEvidenceIndex = (cited, records, bundleDigest) => {
  const lines = ["## Evidence index", ""];
  if (cited.length === 0) {
    lines.push("_No evidence cited._");
    lines.push("");
    return lines;
  }
  lines.push("| Evidence | Operation | Subject | Provider | Confidence | Authority | Locations |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  const linked = [];
  for (const id of cited) {
    const record = records.find((candidate) => isObject(candidate) && candidate.evidence_id === id);
    if (!record) {
      lines.push(`| \`${inline(id)}\` | **missing from bundle** | — | — | — | — | — |`);
      continue;
    }
    const subject = isObject(record.subject) ? record.subject : null;
    const provider = isObject(record.provider) ? record.provider : null;
    lines.push(
      [
        "",
        `\`${inline(record.evidence_id)}\``,
        inline(record.operation) || UNKNOWN_VALUE,
        subject ? inline(subject.format ?? subject.name) || UNKNOWN_VALUE : "no subject",
        provider ? inline(`${provider.id ?? UNKNOWN_VALUE}@${provider.version ?? "?"}`) : UNKNOWN_VALUE,
        inline(record.confidence) || UNKNOWN_VALUE,
        inline(record.authority) || UNKNOWN_VALUE,
        inline(formatLocations(record.locations)),
        "",
      ].join(" | ").trim(),
    );
    if (Array.isArray(record.evidence_links) && record.evidence_links.length > 0) {
      linked.push({ id: record.evidence_id, links: record.evidence_links });
    }
  }
  if (linked.length > 0) {
    lines.push("");
    lines.push("Evidence links (provenance chain declared by REA):");
    lines.push("");
    for (const entry of linked) {
      lines.push(`- \`${inline(entry.id)}\` → ${entry.links.map((link) => `\`${inline(link)}\``).join(", ")}`);
    }
  }
  if (bundleDigest) {
    lines.push("");
    lines.push(`Bundle digest (sha256 of the exported file): \`${inline(bundleDigest)}\``);
  }
  lines.push("");
  return lines;
};

const renderProvenance = (records, bundle, bundleDigest) => {
  const unknowns = Array.isArray(bundle.unknowns) ? bundle.unknowns.length : 0;
  const lines = ["---", ""];
  lines.push(
    `TraceBrief report. Evidence bundle contains ${records.length} record(s), ${unknowns} residual unknown(s)${bundleDigest ? `, digest \`${inline(bundleDigest)}\`` : ""}.`,
  );
  lines.push("");
  lines.push(
    "Regenerate with `node bin/tracebrief.mjs render --report <report.json> --bundle <bundle.json>`. Identical inputs produce identical output.",
  );
  return lines;
};

const claimIdsFor = (claim) =>
  (Array.isArray(claim?.evidence_ids) ? claim.evidence_ids : []).filter((id) => typeof id === "string");

/** Inline evidence list for a table cell: never contains a newline, marks gaps. */
const cellRefs = (ids, records) => {
  const list = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string");
  if (list.length === 0) return "none cited";
  return list
    .map((id) => {
      const known = records.some((record) => isObject(record) && record.evidence_id === id);
      return known ? `\`${id}\`` : `\`${id}\` **(missing)**`;
    })
    .join(", ");
};

/** Evidence list appended to a list item on its own indented line. */
const suffixRefs = (ids) => {
  const list = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string");
  if (list.length === 0) return " (no evidence cited)";
  return `\n  Evidence: ${list.map((id) => `\`${id}\``).join(", ")}`;
};

const countBy = (records, select) => {
  const counts = new Map();
  for (const record of records) {
    const value = String(select(record) ?? UNKNOWN_VALUE);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};

/**
 * Format locations for one table cell. Values are returned raw on purpose: the
 * caller escapes the assembled cell once, and escaping here as well would
 * double every backslash.
 */
const formatLocations = (locations) => {
  const list = Array.isArray(locations) ? locations : [];
  if (list.length === 0) return "none recorded";
  return list
    .map((location) => {
      if (!isObject(location)) return UNKNOWN_VALUE;
      switch (location.kind) {
        case "address":
          return `address ${location.address ?? UNKNOWN_VALUE}`;
        case "address-range":
          return `range ${location.start ?? UNKNOWN_VALUE}-${location.end ?? UNKNOWN_VALUE}`;
        case "artifact-path":
          return `path ${location.path ?? UNKNOWN_VALUE}`;
        case "file-offset":
          return `offset ${location.offset ?? UNKNOWN_VALUE}`;
        case "file-offset-range":
          return `offsets ${location.start ?? UNKNOWN_VALUE}-${location.end ?? UNKNOWN_VALUE}`;
        default:
          return location.kind || UNKNOWN_VALUE;
      }
    })
    .join("; ");
};

export { NOT_COLLECTED, inline, prose, code, shortRef };