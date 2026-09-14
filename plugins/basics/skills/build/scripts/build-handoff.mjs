#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireRecordedWorktree, resolveBuildWorktree } from "./worktree-root.mjs";

const KINDS = new Set(["plan", "seed", "candidate", "review", "repair", "integration"]);
const STATUSES = new Set(["queued", "active", "waiting", "completed", "blocked", "failed", "needs-context", "not-reproducible", "not-required"]);
const CHECK_RESULTS = new Set(["passed", "failed", "blocked", "expected-failure", "not-required"]);
const REPAIR_DISPOSITIONS = new Set(["eligible", "deferred", "needs-context", "rejected"]);
const SCOPE_DISPOSITIONS = new Set(["in-scope", "in-scope-nonblocking", "out-of-scope"]);
const REPAIR_RESULTS = new Set(["fixed", "not-reproducible", "needs-context", "blocked"]);
const AUTHORIZATION_CATEGORIES = ["filesystem", "git", "dependencies", "external-systems", "identity-access", "cost-lifecycle", "recovery"];
const AUTHORIZATION_EXECUTION_MODES = new Set(["interactive", "bounded-unattended"]);
const AUTHORIZATION_AUTHORITIES = new Set(["task", "explicit"]);
const TIME_BUDGET = { targetMinutes: 30, hardMinutes: 45 };
const REQUIRED_ARRAYS = ["decisions", "criteria", "inputs", "outputs", "checks", "findings", "blockers", "artifacts", "next"];
const STAGE = /^(?:brainstorm|seed-tests|blue|red-[1-9]\d*|fixer-[1-9]\d*|integration)$/;
const KIND_STAGE = {
  plan: /^brainstorm$/,
  seed: /^seed-tests$/,
  candidate: /^blue$/,
  review: /^red-[1-9]\d*$/,
  repair: /^fixer-[1-9]\d*$/,
  integration: /^integration$/,
};
const BUDGETS = {
  prompt: { bytes: 6 * 1024 },
  manifest: { bytes: 16 * 1024 },
  receipt: { bytes: 2 * 1024 },
  output: { bytes: 2 * 1024, lines: 20 },
};
const directExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (directExecution) {
  const [command, ...tokens] = process.argv.slice(2);
  const options = parseArgs(tokens);
  try {
    switch (command) {
      case "init": print(initialize(options)); break;
      case "validate": print(validateManifest(readJson(required(options, "file")), options.kind)); break;
      case "record": print(recordManifest(options)); break;
      case "approve": print(approve(options)); break;
      case "authorize-routine": print(authorizeRoutine(options)); break;
      case "check-approval": print(checkApproval(options)); break;
      case "validate-authorizations": print(validateAuthorizationManifest(readJson(required(options, "file")), options.run)); break;
      case "budget": print(checkBudget(options)); break;
      case "time-budget": print(checkTimeBudget(options)); break;
      case "report": print(renderReport(options)); break;
      case "--help": case "-h": case undefined: usage(command ? 0 : 1); break;
      default: throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(tokens) {
  const result = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`Expected an option, received: ${token}`);
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}

function required(options, key) {
  const value = options[key];
  if (value === undefined || value === "") throw new Error(`Missing --${key}`);
  return String(value);
}

function pathsFor(options) {
  const root = resolve(required(options, "status-dir"));
  return {
    root,
    handoffs: join(root, "handoffs"),
    ledger: join(root, "handoffs", "run-ledger.json"),
    repairs: join(root, "handoffs", "repairs"),
    logs: join(root, "logs"),
  };
}

function initialize(options) {
  const paths = pathsFor(options);
  mkdirSync(paths.repairs, { recursive: true, mode: 0o700 });
  mkdirSync(paths.logs, { recursive: true, mode: 0o700 });
  const source = {
    repo: required(options, "repo"),
    base: required(options, "base"),
    branch: required(options, "branch"),
  };
  if (existsSync(paths.ledger)) {
    const ledger = readLedger(paths.ledger);
    if (ledger.runId !== required(options, "run")) throw new Error(`Run ledger already belongs to ${ledger.runId}`);
    for (const field of ["repo", "base", "branch"]) {
      if (ledger.source[field] !== source[field]) throw new Error(`Run ledger ${field} does not match: ${ledger.source[field]}`);
    }
    requireRecordedWorktree(ledger);
    return { ledger: paths.ledger, reused: true };
  }
  const worktree = resolveBuildWorktree({ runId: required(options, "run"), environment: options.environment || process.env });
  const now = timestamp();
  writeAtomic(paths.ledger, {
    schemaVersion: 1,
    runId: required(options, "run"),
    source,
    worktree,
    createdAt: now,
    updatedAt: now,
    approval: null,
    stages: {},
    proxyWarnings: [],
    timeBudget: TIME_BUDGET,
  });
  return { ledger: paths.ledger, reused: false };
}

function validateManifest(value, expectedKind = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Manifest must be a JSON object");
  if (value.schemaVersion !== 1) throw new Error("Manifest schemaVersion must be 1");
  if (!KINDS.has(value.kind)) throw new Error(`Invalid manifest kind: ${value.kind}`);
  if (expectedKind && value.kind !== expectedKind) throw new Error(`Expected manifest kind ${expectedKind}, received ${value.kind}`);
  for (const field of ["runId", "stage", "objective"]) requireString(value, field);
  if (!STAGE.test(value.stage)) throw new Error(`Invalid manifest stage: ${value.stage}`);
  if (!KIND_STAGE[value.kind].test(value.stage)) throw new Error(`Manifest kind ${value.kind} cannot use stage ${value.stage}`);
  if (!STATUSES.has(value.status)) throw new Error(`Invalid manifest status: ${value.status}`);
  if (!value.source || typeof value.source !== "object" || Array.isArray(value.source)) throw new Error("Manifest source must be an object");
  for (const field of ["repo", "base", "commit"]) requireString(value.source, field, "source.");
  for (const field of REQUIRED_ARRAYS) if (!Array.isArray(value[field])) throw new Error(`Manifest ${field} must be an array`);
  for (const [index, check] of value.checks.entries()) {
    if (!check || typeof check !== "object" || Array.isArray(check)) throw new Error(`Manifest checks[${index}] must be an object`);
    if (typeof check.command !== "string" || !check.command.trim()) throw new Error(`Manifest checks[${index}].command must be a non-empty string`);
    if (!CHECK_RESULTS.has(check.result)) throw new Error(`Invalid checks[${index}].result: ${check.result}`);
    if (check.result === "expected-failure" && value.kind !== "seed") throw new Error("expected-failure checks are valid only in seed manifests");
    if (["passed", "failed", "expected-failure"].includes(check.result)) {
      if (!Number.isInteger(check.exitCode)) throw new Error(`Manifest checks[${index}].exitCode must be an integer`);
      if (check.result === "passed" && check.exitCode !== 0) throw new Error(`Passed checks[${index}] must have exitCode 0`);
      if ((check.result === "failed" || check.result === "expected-failure") && check.exitCode === 0) throw new Error(`${check.result} checks[${index}] must have a nonzero exitCode`);
      if (typeof check.commit !== "string" || !check.commit.trim()) throw new Error(`Manifest checks[${index}].commit must be a non-empty string`);
      if (check.commit !== value.source.commit) throw new Error(`Manifest checks[${index}].commit does not match source.commit`);
      const excerpt = typeof check.evidence === "string" ? check.evidence.trim() : "";
      const log = typeof check.log === "string" ? check.log.trim() : "";
      if (!excerpt && !log) throw new Error(`Manifest checks[${index}] requires evidence or a log path`);
      if (excerpt.length > 512) throw new Error(`Manifest checks[${index}].evidence exceeds 512 characters; use a log path`);
    }
    if (["blocked", "not-required"].includes(check.result)) {
      if (check.exitCode !== null) throw new Error(`Manifest checks[${index}].exitCode must be null for ${check.result}`);
      if (typeof check.reason !== "string" || !check.reason.trim()) throw new Error(`Manifest checks[${index}].reason is required for ${check.result} checks`);
    }
  }
  if (value.kind === "review") {
    const ids = new Set();
    for (const [index, finding] of value.findings.entries()) {
      if (!finding || typeof finding !== "object" || Array.isArray(finding)) throw new Error(`Manifest findings[${index}] must be an object`);
      requireString(finding, "id", `findings[${index}].`);
      if (ids.has(finding.id)) throw new Error(`Duplicate finding id: ${finding.id}`);
      ids.add(finding.id);
      if (!REPAIR_DISPOSITIONS.has(finding.repairDisposition)) throw new Error(`Invalid findings[${index}].repairDisposition: ${finding.repairDisposition}`);
      if (!SCOPE_DISPOSITIONS.has(finding.scopeDisposition)) throw new Error(`Invalid findings[${index}].scopeDisposition: ${finding.scopeDisposition}`);
      if (finding.repairDisposition === "eligible") {
        if (finding.scopeDisposition !== "in-scope") throw new Error(`Eligible findings[${index}] must be in-scope`);
        if (!Array.isArray(finding.criterionIds) || finding.criterionIds.length === 0 || finding.criterionIds.some((id) => typeof id !== "string" || !id.trim())) {
          throw new Error(`Eligible findings[${index}] requires criterionIds`);
        }
      }
      if (finding.repairDisposition === "deferred" && (typeof finding.deferReason !== "string" || !finding.deferReason.trim())) {
        throw new Error(`Deferred findings[${index}] requires deferReason`);
      }
    }
  }
  if (value.kind === "repair") {
    const ids = new Set();
    for (const [index, finding] of value.findings.entries()) {
      if (!finding || typeof finding !== "object" || Array.isArray(finding)) throw new Error(`Manifest findings[${index}] must be an object`);
      requireString(finding, "id", `findings[${index}].`);
      if (ids.has(finding.id)) throw new Error(`Duplicate finding id: ${finding.id}`);
      ids.add(finding.id);
      if (!REPAIR_RESULTS.has(finding.result)) throw new Error(`Invalid findings[${index}].result: ${finding.result}`);
    }
  }
  return { ok: true, kind: value.kind, runId: value.runId, stage: value.stage, status: value.status };
}

function requireString(value, field, prefix = "") {
  if (typeof value[field] !== "string" || !value[field].trim()) throw new Error(`Manifest ${prefix}${field} must be a non-empty string`);
}

function validateAuthorizationManifest(value, expectedRunId = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Authorization manifest must be a JSON object");
  if (value.schemaVersion !== 1 || value.kind !== "authorization") throw new Error("Authorization manifest must use schemaVersion 1 and kind authorization");
  requireString(value, "runId");
  if (expectedRunId && value.runId !== expectedRunId) throw new Error(`Authorization runId ${value.runId} does not match ${expectedRunId}`);
  if (value.status !== "ready") throw new Error("Authorization manifest status must be ready");
  for (const field of ["reviewedCategories", "operations", "excluded", "unresolved", "evidence"]) if (!Array.isArray(value[field])) throw new Error(`Authorization manifest ${field} must be an array`);
  const reviewed = new Set(value.reviewedCategories);
  for (const category of AUTHORIZATION_CATEGORIES) if (!reviewed.has(category)) throw new Error(`Authorization category was not reviewed: ${category}`);
  if (value.unresolved.length) throw new Error("Authorization manifest contains unresolved items");
  if (!value.evidence.length || value.evidence.some((item) => typeof item !== "string" || !item.trim())) throw new Error("Authorization manifest requires discovery evidence");
  const execution = value.execution === undefined ? { mode: "interactive" } : value.execution;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) throw new Error("Authorization execution must be an object");
  const executionMode = execution.mode || "interactive";
  if (!AUTHORIZATION_EXECUTION_MODES.has(executionMode)) throw new Error(`Invalid authorization execution mode: ${executionMode}`);
  if (executionMode === "bounded-unattended") {
    if (!Number.isInteger(execution.maxAttemptsPerOperation) || execution.maxAttemptsPerOperation < 1 || execution.maxAttemptsPerOperation > 5) {
      throw new Error("Bounded unattended authorization requires maxAttemptsPerOperation from 1 to 5");
    }
    if (!Array.isArray(execution.stopConditions) || execution.stopConditions.length === 0) {
      throw new Error("Bounded unattended authorization requires explicit stopConditions");
    }
    const stopIds = new Set();
    for (const [index, stop] of execution.stopConditions.entries()) {
      if (!stop || typeof stop !== "object" || Array.isArray(stop)) throw new Error(`Authorization execution.stopConditions[${index}] must be an object`);
      for (const field of ["id", "condition", "reason"]) requireString(stop, field, `execution.stopConditions[${index}].`);
      if (!/^STOP-[A-Z0-9-]+$/.test(stop.id) || stopIds.has(stop.id)) throw new Error(`Authorization execution.stopConditions[${index}].id must be unique and start with STOP-`);
      stopIds.add(stop.id);
    }
  }
  const ids = new Set();
  for (const [index, operation] of value.operations.entries()) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw new Error(`Authorization operations[${index}] must be an object`);
    for (const field of ["id", "category", "action", "consequence", "bounds"]) requireString(operation, field, `operations[${index}].`);
    if (!/^AUTH-[A-Z0-9-]+$/.test(operation.id) || ids.has(operation.id)) throw new Error(`Authorization operations[${index}].id must be unique and start with AUTH-`);
    ids.add(operation.id);
    if (!AUTHORIZATION_CATEGORIES.includes(operation.category)) throw new Error(`Invalid authorization category: ${operation.category}`);
    const authority = operation.authority ?? "explicit";
    if (!AUTHORIZATION_AUTHORITIES.has(authority)) throw new Error(`Invalid authorization authority: ${authority}`);
    if (!Array.isArray(operation.targets) || !operation.targets.length || operation.targets.some((target) => typeof target !== "string" || !target.trim())) throw new Error(`Authorization operations[${index}].targets must contain exact targets`);
    if (operation.trigger !== undefined && (typeof operation.trigger !== "string" || !operation.trigger.trim())) throw new Error(`Authorization operations[${index}].trigger must be a non-empty string`);
    if (operation.maxAttempts !== undefined && (!Number.isInteger(operation.maxAttempts) || operation.maxAttempts < 1 || operation.maxAttempts > (execution.maxAttemptsPerOperation || 5))) {
      throw new Error(`Authorization operations[${index}].maxAttempts exceeds the execution limit`);
    }
    if (operation.dependsOn !== undefined && (!Array.isArray(operation.dependsOn) || operation.dependsOn.length === 0 || operation.dependsOn.some((id) => typeof id !== "string" || !id.trim()))) {
      throw new Error(`Authorization operations[${index}].dependsOn must contain operation IDs`);
    }
    if (operation.derivation !== undefined) {
      if (executionMode !== "bounded-unattended") throw new Error(`Authorization operations[${index}].derivation requires bounded-unattended mode`);
      if (!operation.derivation || typeof operation.derivation !== "object" || Array.isArray(operation.derivation)) throw new Error(`Authorization operations[${index}].derivation must be an object`);
      if (!Array.isArray(operation.derivation.inputs) || operation.derivation.inputs.length === 0 || operation.derivation.inputs.some((input) => typeof input !== "string" || !input.trim())) throw new Error(`Authorization operations[${index}].derivation.inputs must contain exact materialized inputs`);
      for (const field of ["procedure", "validation"]) requireString(operation.derivation, field, `operations[${index}].derivation.`);
      if (!/\$\{[a-zA-Z][a-zA-Z0-9_.-]*\}/.test(operation.action)) throw new Error(`Authorization operations[${index}].action must name a derived-value placeholder`);
    }
  }
  for (const [index, operation] of value.operations.entries()) {
    for (const dependency of operation.dependsOn || []) {
      if (!ids.has(dependency)) throw new Error(`Authorization operations[${index}].dependsOn references unknown operation ${dependency}`);
      if (dependency === operation.id) throw new Error(`Authorization operations[${index}] cannot depend on itself`);
    }
  }
  const result = { ok: true, runId: value.runId, operations: value.operations.length, excluded: value.excluded.length };
  if (value.execution !== undefined) result.executionMode = executionMode;
  return result;
}

function recordManifest(options) {
  const paths = pathsFor(options);
  const manifestPath = resolve(required(options, "file"));
  if (!isWithin(paths.handoffs, manifestPath)) throw new Error(`Manifest must be stored under ${paths.handoffs}`);
  const manifest = readJson(manifestPath);
  validateManifest(manifest, options.kind || "");
  const ledger = readLedger(paths.ledger);
  if (manifest.runId !== ledger.runId) throw new Error(`Manifest runId ${manifest.runId} does not match ledger ${ledger.runId}`);
  if (manifest.source.repo !== ledger.source.repo) throw new Error(`Manifest repository ${manifest.source.repo} does not match ledger ${ledger.source.repo}`);
  if (manifest.source.base !== ledger.source.base) throw new Error(`Manifest base ${manifest.source.base} does not match ledger ${ledger.source.base}`);
  const now = timestamp();
  const receipt = compactReceipt(manifest, manifestPath, now);
  ledger.stages[manifest.stage] = {
    status: manifest.status,
    manifest: manifestPath,
    sha256: hashFile(manifestPath),
    commit: manifest.source.commit,
    summary: receipt.summary,
    checks: receipt.checks,
    checkTotal: receipt.checkTotal,
    passedChecks: receipt.passedChecks,
    expectedFailureChecks: receipt.expectedFailureChecks,
    justifiedNotRequiredChecks: receipt.justifiedNotRequiredChecks,
    failedChecks: receipt.failedChecks,
    findings: manifest.findings.length,
    eligibleFindings: receipt.eligibleFindings,
    unresolvedFindings: receipt.unresolvedFindings,
    deferredFindings: receipt.deferredFindings,
    needsContextFindings: receipt.needsContextFindings,
    eligibleFindingIds: receipt.eligibleFindingIds,
    fixedFindingIds: receipt.fixedFindingIds,
    unresolvedRepairs: receipt.unresolvedRepairs,
    blockers: manifest.blockers.length,
    inputCommits: receipt.inputCommits,
    reviewedCandidateCommits: receipt.reviewedCandidateCommits,
    seedCommits: receipt.seedCommits,
    reviewCommits: receipt.reviewCommits,
    artifacts: receipt.artifacts,
    updatedAt: now,
  };
  ledger.updatedAt = now;
  writeAtomic(paths.ledger, ledger);
  return receipt;
}

function compactReceipt(manifest, manifestPath, now) {
  const checkCounts = {};
  for (const check of manifest.checks) {
    const result = String(check?.result ?? check?.status ?? "unknown");
    checkCounts[result] = (checkCounts[result] || 0) + 1;
  }
  return {
    runId: manifest.runId,
    stage: manifest.stage,
    status: manifest.status,
    commit: manifest.source.commit,
    summary: manifest.objective.slice(0, 280),
    checks: checkCounts,
    checkTotal: manifest.checks.length,
    passedChecks: manifest.checks.filter(({ result }) => result === "passed").length,
    expectedFailureChecks: manifest.checks.filter(({ result }) => result === "expected-failure").length,
    justifiedNotRequiredChecks: manifest.checks.filter(({ result, reason }) => result === "not-required" && typeof reason === "string" && reason.trim()).length,
    failedChecks: manifest.checks.filter(({ result }) => result === "failed" || result === "blocked").length,
    findings: manifest.findings.length,
    eligibleFindings: manifest.findings.filter(({ repairDisposition }) => repairDisposition === "eligible").length,
    deferredFindings: manifest.findings.filter(({ repairDisposition }) => repairDisposition === "deferred").length,
    needsContextFindings: manifest.findings.filter(({ repairDisposition }) => repairDisposition === "needs-context").length,
    unresolvedFindings: manifest.findings.filter(({ repairDisposition }) => repairDisposition === "eligible" || repairDisposition === "needs-context").length,
    eligibleFindingIds: manifest.findings.filter(({ repairDisposition }) => repairDisposition === "eligible").map(({ id }) => id),
    fixedFindingIds: manifest.findings.filter(({ result }) => result === "fixed").map(({ id }) => id),
    unresolvedRepairs: manifest.kind === "repair" ? manifest.findings.filter(({ result }) => result !== "fixed").length : 0,
    blockers: manifest.blockers.length,
    inputCommits: manifest.inputs.map((input) => typeof input === "object" ? input?.commit : "").filter(Boolean),
    reviewedCandidateCommits: manifest.inputs.filter((input) => input?.kind === "reviewed-candidate" && typeof input.commit === "string" && input.commit).map(({ commit }) => commit),
    seedCommits: manifest.inputs.filter((input) => input?.kind === "seed" && typeof input.commit === "string" && input.commit).map(({ commit }) => commit),
    reviewCommits: manifest.inputs.filter((input) => input?.kind === "review" && typeof input.commit === "string" && input.commit).map(({ commit }) => commit),
    manifest: manifestPath,
    artifacts: manifest.artifacts.slice(0, 8).map((artifact) => typeof artifact === "string" ? artifact : artifact?.path).filter(Boolean),
    recordedAt: now,
  };
}

function approve(options) {
  return bindAuthorization(options, "explicit");
}

function authorizeRoutine(options) {
  return bindAuthorization(options, "task");
}

function bindAuthorization(options, authorizationType) {
  const paths = pathsFor(options);
  const plan = resolve(required(options, "plan"));
  const scope = resolve(required(options, "scope"));
  const authorizations = resolve(required(options, "authorizations"));
  const planManifest = readJson(plan);
  validateManifest(planManifest, "plan");
  const authorizationManifest = readJson(authorizations);
  const authorizationValidation = validateAuthorizationManifest(authorizationManifest, planManifest.runId);
  const explicitOperations = authorizationManifest.operations
    .filter((operation) => (operation.authority ?? "explicit") === "explicit")
    .map(({ id }) => id);
  if (authorizationType === "task" && explicitOperations.length) {
    throw new Error(`Routine task authorization cannot bind operations requiring explicit approval: ${explicitOperations.join(", ")}`);
  }
  const ledger = readLedger(paths.ledger);
  if (ledger.approval) throw new Error("This run is already bound to an authorization record");
  if (planManifest.runId !== ledger.runId) throw new Error("Plan runId does not match the run ledger");
  const brainstorm = ledger.stages.brainstorm;
  if (!brainstorm || brainstorm.status !== "completed") throw new Error("The Brainstorm stage is not recorded as completed");
  if (brainstorm.manifest !== plan || brainstorm.sha256 !== hashFile(plan)) throw new Error("Approval plan does not match the recorded Brainstorm manifest");
  const approval = {
    plan,
    planSha256: hashFile(plan),
    scope,
    scopeSha256: hashFile(scope),
    authorizations,
    authorizationsSha256: hashFile(authorizations),
    executionMode: authorizationValidation.executionMode || "interactive",
    authorizationType,
    event: required(options, "event"),
    approvedAt: timestamp(),
  };
  ledger.approval = approval;
  ledger.updatedAt = approval.approvedAt;
  writeAtomic(paths.ledger, ledger);
  return { approved: true, ...approval };
}

function checkApproval(options) {
  const paths = pathsFor(options);
  const ledger = readLedger(paths.ledger);
  if (!ledger.approval) throw new Error("No approval is recorded");
  const plan = resolve(required(options, "plan"));
  const scope = resolve(required(options, "scope"));
  const authorizations = resolve(required(options, "authorizations"));
  if (plan !== ledger.approval.plan || hashFile(plan) !== ledger.approval.planSha256) throw new Error("Approval is stale: plan changed");
  if (scope !== ledger.approval.scope || hashFile(scope) !== ledger.approval.scopeSha256) throw new Error("Approval is stale: scope changed");
  if (authorizations !== ledger.approval.authorizations || hashFile(authorizations) !== ledger.approval.authorizationsSha256) throw new Error("Approval is stale: authorizations changed");
  const manifest = readJson(authorizations);
  const requested = String(options.operations || options.operation || "").split(",").map((id) => id.trim()).filter(Boolean);
  const approvedIds = new Set(manifest.operations.map(({ id }) => id));
  for (const id of requested) if (!approvedIds.has(id)) throw new Error(`Authorization operation ${id} is not approved`);
  return { approved: true, event: ledger.approval.event, approvedAt: ledger.approval.approvedAt, executionMode: ledger.approval.executionMode || "interactive", authorizationType: ledger.approval.authorizationType || "explicit", operations: requested };
}

function checkBudget(options) {
  const kind = required(options, "kind");
  const budget = BUDGETS[kind];
  if (!budget) throw new Error(`Unknown budget kind: ${kind}`);
  const file = resolve(required(options, "file"));
  const content = readFileSync(file, "utf8");
  const bytes = statSync(file).size;
  const lines = content === "" ? 0 : content.split(/\r?\n/).length;
  const reasons = [];
  if (budget.bytes && bytes > budget.bytes) reasons.push(`${bytes} bytes exceeds ${budget.bytes}`);
  if (budget.lines && lines > budget.lines) reasons.push(`${lines} lines exceeds ${budget.lines}`);
  const result = { kind, file, bytes, lines, warning: reasons.length > 0, reasons };
  if (result.warning) {
    process.stderr.write(`Budget warning (${kind}): ${reasons.join("; ")}\n`);
    if (options["status-dir"]) recordBudgetWarning(pathsFor(options), result);
  }
  return result;
}

function recordBudgetWarning(paths, warning) {
  if (!existsSync(paths.ledger)) return;
  const ledger = readLedger(paths.ledger);
  ledger.proxyWarnings.push({ ...warning, at: timestamp() });
  ledger.updatedAt = timestamp();
  writeAtomic(paths.ledger, ledger);
}

function checkTimeBudget(options, now = Date.now()) {
  const paths = pathsFor(options);
  const ledger = readLedger(paths.ledger);
  const startedAt = Date.parse(ledger.createdAt);
  if (!Number.isFinite(startedAt)) throw new Error("Run ledger has an invalid createdAt timestamp");
  const elapsedMinutes = Math.max(0, (Number(now) - startedAt) / 60000);
  const budget = ledger.timeBudget || TIME_BUDGET;
  const state = elapsedMinutes >= budget.hardMinutes ? "hard-stop" : elapsedMinutes >= budget.targetMinutes ? "target-exceeded" : "within-target";
  return { state, elapsedMinutes: Number(elapsedMinutes.toFixed(2)), ...budget };
}

function renderReport(options) {
  const paths = pathsFor(options);
  const output = resolve(required(options, "output"));
  const ledger = readLedger(paths.ledger);
  const stages = Object.entries(ledger.stages);
  const blockers = stages.reduce((total, [, stage]) => total + Number(stage.blockers || 0), 0);
  const integration = ledger.stages.integration;
  const approvalCurrent = currentApproval(ledger.approval);
  const requiredStages = ["brainstorm", "seed-tests", "blue"];
  const redStages = stages.filter(([stage]) => stage.startsWith("red-"));
  const fixerStages = stages.filter(([stage]) => stage.startsWith("fixer-"));
  const red = ledger.stages["red-1"];
  const fixer = ledger.stages["fixer-1"];
  const eligibleIds = red?.eligibleFindingIds || [];
  const repairRequired = eligibleIds.length > 0;
  const repairsComplete = repairRequired
    ? fixer?.status === "completed" && fixer.failedChecks === 0 && fixer.passedChecks > 0 && fixer.unresolvedRepairs === 0
      && eligibleIds.every((id) => fixer.fixedFindingIds?.includes(id)) && fixer.reviewCommits?.includes(red.commit)
    : fixer?.status === "not-required";
  const reviewedCommit = repairRequired ? fixer?.commit : red?.commit;
  const reviewedCandidateMatches = Boolean(reviewedCommit && integration?.reviewedCandidateCommits?.includes(reviewedCommit));
  const blueFollowsSeed = Boolean(ledger.stages.blue?.seedCommits?.includes(ledger.stages["seed-tests"]?.commit));
  const reviewChainConnected = Boolean(red?.commit && red.commit === ledger.stages.blue?.commit);
  const greenValidation = [ledger.stages.blue, integration].every((stage) => stage?.passedChecks > 0 && stage.failedChecks === 0);
  const seed = ledger.stages["seed-tests"];
  const testFirstEvidence = Boolean(seed && seed.failedChecks === 0 && (seed.expectedFailureChecks > 0 || seed.justifiedNotRequiredChecks > 0));
  const fixedStagesComplete = requiredStages.every((stage) => ledger.stages[stage]?.status === "completed")
    && red?.status === "completed" && Number(red.needsContextFindings || 0) === 0 && repairsComplete
    && redStages.length === 1 && fixerStages.length === 1;
  const allStagesTerminal = stages.every(([, stage]) => ["completed", "not-required"].includes(stage.status));
  const manifestsCurrent = stages.every(([, stage]) => existsSync(stage.manifest) && hashFile(stage.manifest) === stage.sha256);
  const approvedPlanRecorded = Boolean(ledger.approval && ledger.stages.brainstorm?.manifest === ledger.approval.plan && ledger.stages.brainstorm?.sha256 === ledger.approval.planSha256);
  const ready = Boolean(approvalCurrent && approvedPlanRecorded && fixedStagesComplete && testFirstEvidence && greenValidation && blueFollowsSeed && reviewChainConnected && reviewedCandidateMatches && manifestsCurrent && integration?.status === "completed" && blockers === 0 && allStagesTerminal);
  const lines = [
    "# Build Delivery Report", "", "## Executive Summary", "",
    ready ? "The reviewed integration candidate satisfies the recorded readiness gates." : "The run is not ready under the recorded gates.", "",
    "## Run and Source", "", `- Run: \`${escapeInline(ledger.runId)}\``,
    `- Repository: \`${escapeInline(ledger.source.repo)}\``, `- Base: \`${escapeInline(ledger.source.base)}\``,
    `- Integration branch: \`${escapeInline(ledger.source.branch)}\``, "",
    "## Approval", "", approvalCurrent
      ? `Approved plan \`${escapeInline(ledger.approval.planSha256)}\`, scope \`${escapeInline(ledger.approval.scopeSha256)}\`, and authorizations \`${escapeInline(ledger.approval.authorizationsSha256)}\` in \`${escapeInline(ledger.approval.executionMode || "interactive")}\` mode (event \`${escapeInline(ledger.approval.event)}\`).`
      : "No current approval is recorded, or the approved plan/scope has changed.", "",
    "## Stage Receipts", "", "| Stage | Status | Commit | Checks | Findings | Deferred | Blockers | Manifest |", "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...stages.map(([name, stage]) => `| ${cell(name)} | ${cell(stage.status)} | ${cell(stage.commit)} | ${cell(formatChecks(stage.checks))} | ${stage.findings || 0} | ${stage.deferredFindings || 0} | ${stage.blockers || 0} | ${cell(stage.manifest)} |`),
    "", "## Deferred Review Items", "", Number(red?.deferredFindings || 0) > 0
      ? `${red.deferredFindings} report-only finding(s) are retained in ${red.manifest}; they were outside the approved Build repair boundary.`
      : "None.",
    "", "## Proxy Budget Warnings", "", ledger.proxyWarnings.length
      ? ledger.proxyWarnings.map((warning) => `- ${warning.kind}: ${warning.reasons.join("; ")} (${warning.file})`).join("\n")
      : "None.", "", "## Readiness", "", ready ? "Ready for explicit merge approval" : "Not ready for merge approval", "",
  ];
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, lines.join("\n"));
  return { report: output, ready };
}

function formatChecks(checks = {}) {
  return Object.entries(checks).map(([result, count]) => `${result}:${count}`).join(", ") || "none";
}

function stageNumber(stage) { return Number(String(stage).match(/-(\d+)$/)?.[1] || 0); }

function currentApproval(approval) {
  if (!approval || !existsSync(approval.plan) || !existsSync(approval.scope) || !existsSync(approval.authorizations)) return false;
  return hashFile(approval.plan) === approval.planSha256 && hashFile(approval.scope) === approval.scopeSha256 && hashFile(approval.authorizations) === approval.authorizationsSha256;
}

function isWithin(parent, child) {
  const path = relative(resolve(parent), child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function cell(value) { return String(value || "—").replaceAll("|", "\\|").replaceAll("\n", " "); }
function escapeInline(value) { return String(value || "").replaceAll("`", "\\`"); }
function timestamp() { return new Date().toISOString(); }
function hashFile(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function readJson(path) { return JSON.parse(readFileSync(resolve(path), "utf8")); }
function readLedger(path) {
  if (!existsSync(path)) throw new Error(`No run ledger at ${path}; run init first`);
  const ledger = readJson(path);
  if (ledger.schemaVersion !== 1 || !ledger.runId || !ledger.stages) throw new Error(`Invalid run ledger: ${path}`);
  return ledger;
}
function writeAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
function print(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function usage(code) {
  process.stdout.write("Usage: build-handoff.mjs <init|validate|validate-authorizations|record|approve|authorize-routine|check-approval|budget|time-budget|report> [options]\n");
  process.exitCode = code;
}

export { AUTHORIZATION_AUTHORITIES, AUTHORIZATION_CATEGORIES, AUTHORIZATION_EXECUTION_MODES, BUDGETS, TIME_BUDGET, approve, authorizeRoutine, checkApproval, checkBudget, checkTimeBudget, compactReceipt, initialize, recordManifest, renderReport, validateAuthorizationManifest, validateManifest };
