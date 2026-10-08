/** Shared builders for tests. Nothing here talks to REA; all data is synthetic. */

/**
 * Build a 64-character hex digest from a single repeated character.
 *
 * The character is validated on purpose: REA's own ids are `ev_[0-9a-f]{64}` and
 * `unk_[0-9a-f]{64}`, so an earlier version of this helper happily produced
 * `unk_uuuu...` fixtures that the validator would reject in real life. Every id
 * in the suite now goes through here, so that class of fixture cannot come back.
 */
export const hex = (char) => {
  if (typeof char !== "string" || !/^[0-9a-f]$/.test(char)) {
    throw new Error(
      `hex() takes exactly one lowercase hex character, got ${JSON.stringify(char)}. Use a digit 0-9 or a letter a-f.`,
    );
  }
  return char.repeat(64);
};
export const evidenceId = (char) => `ev_${hex(char)}`;
export const unknownId = (char) => `unk_${hex(char)}`;

export const TARGET_DIGEST = hex("d");

/** Error and warning code extractors, shared by every test file. */
export const codes = (issues) =>
  issues.filter((issue) => issue.level === "error").map((issue) => issue.code);
export const warningCodes = (issues) =>
  issues.filter((issue) => issue.level === "warning").map((issue) => issue.code);
export const issuePaths = (issues, code) =>
  issues.filter((issue) => issue.code === code).map((issue) => issue.path);

export const makeRecord = (overrides = {}) => {
  const base = {
    evidence_id: evidenceId("a"),
    subject: {
      name: "target.exe",
      digest: { sha256: TARGET_DIGEST },
      format: "pe",
      architecture: "x86_64",
      local_path: "C:/artifacts/target.exe",
    },
    provider: { id: "test-provider", name: "Test Provider", version: "9.9" },
    predicate_type: "test.predicate",
    operation: "test_operation",
    parameters: {},
    raw_result: { note: "raw payload that TraceBrief must never inline into the report" },
    normalized_result: { note: "normalized" },
    confidence: "observed",
    authority: "shipped-artifact",
    environment: null,
    limitations: [],
    locations: [{ kind: "address", address: "0x401000" }],
    evidence_links: [],
  };
  return { ...base, ...overrides };
};

export const makeBundle = (overrides = {}) => {
  const base = {
    artifacts: [{ digest: { sha256: TARGET_DIGEST }, format: "pe", architecture: "x86_64" }],
    providers: [{ id: "test-provider", name: "Test Provider", version: "9.9" }],
    environments: [],
    scenarios: [],
    captures: [],
    unknowns: [],
    records: [makeRecord()],
  };
  return { ...base, ...overrides };
};

export const makeClaim = (overrides = {}) => ({
  id: "c1",
  statement: "The entry function validates the header length before reading the payload.",
  kind: "observed",
  claim_type: "structure",
  evidence_ids: [evidenceId("a")],
  limitations: [],
  ...overrides,
});

export const makeReport = (overrides = {}) => {
  const base = {
    schema: "tracebrief/report@1",
    title: "TraceBrief fixture report",
    question: "How does the target validate its input header?",
    target: {
      name: "target.exe",
      version: "1.2.3",
      artifact_digest: TARGET_DIGEST,
      format: "pe",
      architecture: "x86_64",
      local_path: "C:/artifacts/target.exe",
    },
    reproduction: {
      environment: ["windows-x86_64"],
      tool_versions: [{ name: "test-provider", version: "9.9", evidence_ids: [evidenceId("a")] }],
      commands: [{ command: "tracebrief render", purpose: "rebuild this report", evidence_ids: [] }],
    },
    findings: [makeClaim()],
    relationships: [],
    open_questions: [],
    summary: { established: ["c1"], not_established: [] },
  };
  return { ...base, ...overrides };
};