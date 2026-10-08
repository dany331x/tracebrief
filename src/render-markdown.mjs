/**
 * Deterministic Markdown rendering.
 *
 * Rendering is a pure function of (report, bundle). No timestamps, no locale
 * formatting, no randomness: the same inputs produce byte-identical output, so
 * a regenerated report shows only real content changes in a diff.
 */
import { openUnknowns } from "./bundle.mjs";
import { citedEvidenceIds } from "./rules.mjs";

const NOT_COLLECTED = "_Not collected._";
const shortRef = (id) => (typeof id === "string" ? `${id.slice(0, 15)}…` : String(id));

export const renderMarkdown = (report, bundle, { bundleDigest = null } = {}) => {
  const lines = [];
  const cited = citedEvidenceIds(report);
  const records = bundle.records ?? [];
  const citedRecords = cited
    .map((id) => records.find((record) => record.evidence_id === id))
    .filter(Boolean);

  lines.push(`# ${report.title}`);
  lines.push("");
  lines.push("## Investigation question");
  lines.push("");
  lines.push(report.question);
  lines.push("");

  lines.push(...renderTarget(report, bundle));
  lines.push(...renderClaims("Key findings", report.findings, citedRecords));
  lines.push(...renderClaims("Relationships", report.relationships, citedRecords));
  lines.push(...renderConfidence(citedRecords));
  lines.push(...renderReproduction(report));
  lines.push(...renderOpenQuestions(report, bundle));
  lines.push(...renderSummary(report));
  lines.push(...renderEvidenceIndex(cited, bundle, bundleDigest));
  lines.push(...renderProvenance(report, bundle, bundleDigest));

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
};

const renderTarget = (report, bundle) => {
  const target = report.target ?? {};
  const lines = ["## Target overview", ""];
  const rows = [
    ["Name", target.name],
    ["Version", target.version],
    ["Format", target.format],
    ["Architecture", target.architecture],
    ["Artifact digest", target.artifact_digest ? `\`${target.artifact_digest}\`` : null],
    ["Local path", target.local_path],
  ];
  for (const [label, value] of rows) {
    lines.push(`- **${label}:** ${value ? inline(String(value)) : "unknown — not collected"}`);
  }
  const artifactInBundle = (bundle.artifacts ?? []).some(
    (artifact) => artifact?.digest?.sha256 === target.artifact_digest,
  );
  if (target.artifact_digest && !artifactInBundle) {
    lines.push("");
    lines.push(
      "> The reported artifact digest is **not** present in `bundle.artifacts`; validation reports this as an error.",
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
  claims.forEach((claim, index) => {
    const anchors = claimIdsFor(claim);
    lines.push(`### ${index + 1}. ${claim.statement}`);
    lines.push("");
    lines.push(
      `- **Claim id:** \`${claim.id ?? "unknown"}\`` +
        (anchors.length > 0 ? ` · **Kind:** ${claim.kind} · **Type:** ${claim.claim_type}` : ""),
    );
    if (anchors.length > 0) {
      lines.push(`- **Evidence:** ${anchors.map((id) => `\`${shortRef(id)}\``).join(", ")}`);
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
    const limitations = claim.limitations ?? [];
    if (limitations.length > 0) {
      lines.push("- **Limitations:**");
      for (const limitation of limitations) lines.push(`  - ${limitation}`);
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
    `- **Confidence of cited evidence:** ${byConfidence
      .map(([key, count]) => `${key} ${count}`)
      .join(", ")}`,
  );
  lines.push(
    `- **Authority of cited evidence:** ${byAuthority
      .map(([key, count]) => `${key} ${count}`)
      .join(", ")}`,
  );
  lines.push(
    "- **Reading rule:** `observed` is a direct provider reading, `derived` is computed from observed data, `inferred` is a candidate that static analysis cannot confirm at runtime.",
  );
  lines.push("");
  const limitations = [
    ...new Set(citedRecords.flatMap((record) => record.limitations ?? []).filter((l) => typeof l === "string")),
  ].sort();
  lines.push("Limitations carried by the cited evidence:");
  lines.push("");
  if (limitations.length === 0) {
    lines.push(NOT_COLLECTED);
  } else {
    for (const limitation of limitations) lines.push(`- ${limitation}`);
  }
  lines.push("");
  return lines;
};

const renderReproduction = (report) => {
  const reproduction = report.reproduction ?? {};
  const lines = ["## Reproduction", ""];
  const environment = reproduction.environment ?? [];
  lines.push("### Environment");
  lines.push("");
  if (environment.length === 0) lines.push(NOT_COLLECTED);
  else for (const entry of environment) lines.push(`- ${entry}`);
  lines.push("");

  lines.push("### Tools");
  lines.push("");
  const tools = reproduction.tool_versions ?? [];
  if (tools.length === 0) {
    lines.push(NOT_COLLECTED);
  } else {
    lines.push("| Tool | Version | Evidence |");
    lines.push("| --- | --- | --- |");
    for (const entry of tools) {
      lines.push(
        `| ${inline(String(entry.name ?? ""))} | ${inline(String(entry.version ?? "unknown"))} | ${cellRefs(entry.evidence_ids)} |`,
      );
    }
  }
  lines.push("");

  lines.push("### Commands");
  lines.push("");
  const commands = reproduction.commands ?? [];
  if (commands.length === 0) {
    lines.push(NOT_COLLECTED);
  } else {
    for (const entry of commands) {
      lines.push(
        `- \`${entry.command ?? ""}\` — ${entry.purpose ?? "purpose not recorded"}${suffixRefs(entry.evidence_ids)}`,
      );
    }
  }
  lines.push("");
  return lines;
};

const renderOpenQuestions = (report, bundle) => {
  const lines = ["## Open questions", ""];
  const declared = report.open_questions ?? [];
  if (declared.length === 0 && openUnknowns(bundle).length === 0) {
    lines.push(NOT_COLLECTED);
    lines.push("");
    return lines;
  }
  for (const question of declared) {
    const unknownId = question.unknown_id ? ` (${question.unknown_id})` : "";
    lines.push(
      `- **${question.status ?? "unknown"}**${unknownId} — ${question.question ?? ""}${suffixRefs(question.evidence_ids)}`,
    );
  }
  const uncarried = openUnknowns(bundle).filter(
    (unknown) => !declared.some((question) => question.unknown_id === unknown.unknown_id),
  );
  if (uncarried.length > 0) {
    lines.push("");
    lines.push("Residual unknowns present in the bundle but not carried into this report:");
    lines.push("");
    for (const unknown of uncarried) {
      lines.push(`- \`${unknown.unknown_id}\` (${unknown.status}) — ${unknown.question ?? "question not recorded"}`);
    }
  }
  lines.push("");
  return lines;
};

const renderSummary = (report) => {
  const summary = report.summary ?? {};
  const lines = ["## Summary", "", "### Established", ""];
  const established = summary.established ?? [];
  if (established.length === 0) lines.push(NOT_COLLECTED);
  else for (const id of established) lines.push(`- \`${id}\``);
  lines.push("");
  lines.push("### Not established", "");
  const notEstablished = summary.not_established ?? [];
  if (notEstablished.length === 0) lines.push(NOT_COLLECTED);
  else for (const entry of notEstablished) lines.push(`- ${entry}`);
  lines.push("");
  return lines;
};

const renderEvidenceIndex = (cited, bundle, bundleDigest) => {
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
    const record = (bundle.records ?? []).find((candidate) => candidate.evidence_id === id);
    if (!record) {
      lines.push(`| \`${id}\` | **missing from bundle** | — | — | — | — | — |`);
      continue;
    }
    lines.push(
      [
        "",
        `\`${record.evidence_id}\``,
        inline(String(record.operation ?? "unknown")),
        inline(record.subject ? record.subject.format ?? record.subject.name : "no subject"),
        inline(`${record.provider?.id ?? "unknown"}@${record.provider?.version ?? "?"}`),
        record.confidence ?? "unknown",
        record.authority ?? "unknown",
        inline(formatLocations(record.locations)),
        "",
      ].join(" | ").trim(),
    );
    if ((record.evidence_links ?? []).length > 0) {
      linked.push({ id: record.evidence_id, links: record.evidence_links });
    }
  }
  if (linked.length > 0) {
    lines.push("");
    lines.push("Evidence links (provenance chain declared by REA):");
    lines.push("");
    for (const entry of linked) {
      lines.push(`- \`${entry.id}\` → ${entry.links.map((link) => `\`${link}\``).join(", ")}`);
    }
  }
  if (bundleDigest) {
    lines.push("");
    lines.push(`Bundle digest (sha256 of the exported file): \`${bundleDigest}\``);
  }
  lines.push("");
  return lines;
};

const renderProvenance = (report, bundle, bundleDigest) => {
  const lines = ["---", ""];
  lines.push(
    `TraceBrief report. Evidence bundle contains ${(bundle.records ?? []).length} record(s), ${(bundle.unknowns ?? []).length} residual unknown(s)${bundleDigest ? `, digest \`${bundleDigest}\`` : ""}.`,
  );
  lines.push("");
  lines.push(
    "Regenerate with `tracebrief render --report <report.json> --bundle <bundle.json>`. Identical inputs produce identical output.",
  );
  void report;
  return lines;
};

const claimIdsFor = (claim) => (claim?.evidence_ids ?? []).filter((id) => typeof id === "string");

/** Inline evidence list for a table cell: never contains a newline. */
const cellRefs = (ids) => {
  const list = (ids ?? []).filter((id) => typeof id === "string");
  if (list.length === 0) return "none cited";
  return list.map((id) => `\`${id}\``).join(", ");
};

/** Evidence list appended to a list item on its own indented line. */
const suffixRefs = (ids) => {
  const list = (ids ?? []).filter((id) => typeof id === "string");
  if (list.length === 0) return " (no evidence cited)";
  return `\n  Evidence: ${list.map((id) => `\`${id}\``).join(", ")}`;
};

const countBy = (records, select) => {
  const counts = new Map();
  for (const record of records) {
    const value = String(select(record) ?? "unknown");
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};

const formatLocations = (locations) => {
  const list = locations ?? [];
  if (list.length === 0) return "none recorded";
  return list
    .map((location) => {
      switch (location?.kind) {
        case "address":
          return `address ${location.address}`;
        case "address-range":
          return `range ${location.start}-${location.end}`;
        case "artifact-path":
          return `path ${location.path}`;
        case "file-offset":
          return `offset ${location.offset}`;
        case "file-offset-range":
          return `offsets ${location.start}-${location.end}`;
        default:
          return String(location?.kind ?? "unknown");
      }
    })
    .join("; ");
};

/** Escape the characters that would break a Markdown table cell. */
const inline = (value) =>
  String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

export { NOT_COLLECTED, inline, shortRef };