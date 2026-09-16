#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const TEAM_STATES = new Set(["queued", "active", "waiting", "completed", "blocked", "failed", "not-required"]);
const TASK_STATES = new Set(["queued", "active", "waiting", "passed", "failed", "blocked", "not-required"]);
const TASK_KINDS = new Set(["task", "finding"]);
const RUN_STATES = new Set(["active", "awaiting-approval", "blocked", "completed", "failed"]);
const PIPELINE = [
  { id: "brainstorm", label: "Planning", weight: 15 },
  { id: "seed-tests", label: "Seed tests", weight: 10 },
  { id: "blue", label: "Blue Team", weight: 35 },
  { id: "red", label: "Red Team review", weight: 15 },
  { id: "fixer", label: "Fixers and judges", weight: 15 },
  { id: "integration", label: "Integration", weight: 10 },
];
const COMPLETED_STATES = new Set(["completed", "passed", "not-required"]);
const PIPELINE_IDS = new Set(PIPELINE.map(({ id }) => id));
const DASHBOARD_PROTOCOL_VERSION = 1;
const RUN_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const directExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const [command, ...tokens] = directExecution ? process.argv.slice(2) : [];
const options = parseArgs(tokens);

if (directExecution) {
  if (!command || command === "--help" || command === "-h" || options.help) {
    printUsage();
    process.exitCode = command ? 0 : 1;
  } else {
    await main();
  }
}

async function main() {
  switch (command) {
    case "init":
      initialize();
      break;
    case "run":
      updateRun();
      break;
    case "team":
      updateTeam();
      break;
    case "agent":
      updateAgent();
      break;
    case "task":
      updateTask();
      break;
    case "event":
      addEvent();
      break;
    case "context":
      updateHookContext();
      break;
    case "hook":
      lifecycleHook();
      break;
    case "read":
      await printState();
      break;
    case "serve":
      await serveDashboard();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) throw new Error(`Expected an option, received: ${token}`);
    const key = token.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function required(key) {
  const value = options[key];
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function stateDir() {
  return resolve(required("state-dir"));
}

function files(root = stateDir()) {
  root = resolve(root);
  return { root, state: join(root, "status.json"), events: join(root, "events.ndjson"), lock: join(root, ".status.lock") };
}

function timestamp() {
  return new Date().toISOString();
}

function asProgress(value) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error("--progress must be a number from 0 to 100");
  return number;
}

function valid(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

function initialState() {
  const now = timestamp();
  const runId = required("run");
  return {
    schemaVersion: 3,
    run: {
      id: runId,
      slug: options.slug ? validRunSlug(options.slug) : slugFor(runId),
      repo: required("repo"),
      base: required("base"),
      branch: required("branch"),
      workspace: resolve(options.workspace || process.cwd()),
      status: "active",
      startedAt: now,
      updatedAt: now,
      progress: 0,
      lastEventSeq: 1,
      milestones: PIPELINE.map(({ id, label, weight }) => ({ id, label, weight, status: "queued", completed: false })),
    },
    teams: {},
    agents: {},
    tasks: {},
    summary: emptySummary(),
    events: [],
  };
}

function emptySummary() {
  return { activeAgents: 0, queuedOrWaitingAgents: 0, openBlockers: 0, openFindings: 0, unknownTeams: [] };
}

function validRunSlug(value) {
  const slug = String(value || "");
  if (!RUN_SLUG.test(slug)) throw new Error(`Invalid run slug: ${value}`);
  return slug;
}

function slugFor(value) {
  const source = String(value || "run");
  if (RUN_SLUG.test(source)) return source;
  const base = source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 110).replace(/-$/g, "") || "run";
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

function readEventLog(eventsPath) {
  if (!existsSync(eventsPath)) return [];
  const content = readFileSync(eventsPath, "utf8");
  const terminated = content.endsWith("\n");
  const lines = content.split("\n");
  if (terminated) lines.pop();
  const events = [];
  let recoveredCorruptTail = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      const isUnterminatedTail = !terminated && index === lines.length - 1;
      if (!isUnterminatedTail) throw new Error(`Invalid event JSON at line ${index + 1}: ${error.message}`);
      preserveCorruptEventTail(eventsPath, line);
      const validContent = lines.slice(0, index).filter(Boolean).join("\n");
      const temporary = `${eventsPath}.${process.pid}.tmp`;
      writeFileSync(temporary, validContent ? `${validContent}\n` : "");
      renameSync(temporary, eventsPath);
      recoveredCorruptTail = true;
    }
  }
  if (!terminated && content && !recoveredCorruptTail) {
    const temporary = `${eventsPath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${content}\n`);
    renameSync(temporary, eventsPath);
  }
  return events;
}

function preserveCorruptEventTail(eventsPath, tail) {
  const digest = createHash("sha256").update(tail).digest("hex").slice(0, 12);
  const sidecar = `${eventsPath}.corrupt-tail-${digest}`;
  if (!existsSync(sidecar)) writeFileSync(sidecar, tail, { flag: "wx" });
}

function reconcileEventLog(paths, state) {
  const events = readEventLog(paths.events);
  const known = new Set(events.map(({ id }) => id));
  const missing = (state.events || []).filter(({ id }) => id && !known.has(id));
  if (missing.length === 0) return events;
  const merged = [...events, ...missing];
  if (merged.every(({ seq }) => Number.isFinite(Number(seq)))) {
    merged.sort((first, second) => Number(first.seq) - Number(second.seq) || String(first.id).localeCompare(String(second.id)));
  }
  const temporary = `${paths.events}.${process.pid}.tmp`;
  writeFileSync(temporary, merged.map((event) => JSON.stringify(event)).join("\n") + "\n");
  renameSync(temporary, paths.events);
  return merged;
}

function assignEventSequences(state, records, eventLog) {
  let last = Math.max(Number(state.run.lastEventSeq) || 0, eventLog.length);
  for (const event of eventLog) last = Math.max(last, Number(event.seq) || 0);
  for (const event of records) event.seq = ++last;
  state.run.lastEventSeq = last;
}

function acquireLock(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return openSync(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 30_000) unlinkSync(lockPath);
      } catch (lockError) {
        if (lockError.code !== "ENOENT") throw lockError;
      }
      Atomics.wait(wait, 0, 0, 15);
    }
  }
  throw new Error(`Timed out waiting for status lock: ${lockPath}`);
}

function withState(mutator, root) {
  const paths = files(root);
  const lockHandle = acquireLock(paths.lock);
  try {
    if (!existsSync(paths.state)) throw new Error(`No status store at ${paths.state}; run init first`);
    const state = JSON.parse(readFileSync(paths.state, "utf8"));
    const eventLog = reconcileEventLog(paths, state);
    const records = [];
    mutator(state, records);
    assignEventSequences(state, records, eventLog);
    state.run.updatedAt = timestamp();
    normalizeState(state);
    state.events = [...state.events, ...records].slice(-200);
    const temporary = `${paths.state}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temporary, paths.state);
    for (const record of records) appendFileSync(paths.events, `${JSON.stringify(record)}\n`);
    return state;
  } finally {
    closeSync(lockHandle);
    try {
      unlinkSync(paths.lock);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function readNormalizedState(path) {
  const state = JSON.parse(readFileSync(path, "utf8"));
  normalizeState(state);
  return state;
}

function record(records, kind, details = {}) {
  records.push({ id: `${Date.now()}-${process.pid}-${records.length}`, at: timestamp(), kind, ...details });
}

function initialize() {
  const paths = files();
  mkdirSync(paths.root, { recursive: true });
  if (existsSync(paths.state)) throw new Error(`Status store already exists: ${paths.state}`);
  const state = initialState();
  const first = { id: `${Date.now()}-${process.pid}-0`, seq: 1, at: timestamp(), kind: "run", status: "active", message: "Build run initialized" };
  state.events.push(first);
  writeFileSync(paths.state, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
  appendFileSync(paths.events, `${JSON.stringify(first)}\n`);
  print({ state: paths.state, run: state.run });
}

function updateRun() {
  const status = valid(required("status"), RUN_STATES, "run status");
  const state = withState((current, records) => {
    current.run.status = status;
    if (options.message) current.run.message = options.message;
    record(records, "run", { status, message: options.message || "" });
  });
  print({ run: state.run });
}

function updateTeam() {
  const id = pipelineTeam(required("id"));
  const status = valid(required("status"), TEAM_STATES, "team status");
  const progress = asProgress(options.progress);
  const state = withState((current, records) => {
    const previous = current.teams[id] || { id, createdAt: timestamp() };
    current.teams[id] = {
      ...previous,
      status,
      progress: progress ?? previous.progress ?? 0,
      message: options.message ?? previous.message ?? "",
      evidence: options.evidence ?? previous.evidence ?? "",
      updatedAt: timestamp(),
    };
    record(records, "team", { team: id, status, progress: current.teams[id].progress, message: current.teams[id].message, evidence: current.teams[id].evidence });
  });
  print({ team: state.teams[id] });
}

function reconcileTeamReceipt(statusDir, receipt) {
  const team = pipelineTeam(receipt.team);
  const status = valid(receipt.status, TEAM_STATES, "team status");
  if (!COMPLETED_STATES.has(status)) throw new Error(`Receipt status is not terminal: ${status}`);
  const receiptId = String(receipt.id || "");
  if (!receiptId) throw new Error("Telemetry receipt requires an id");
  let emitted = false;
  const state = withState((current, records) => {
    const alreadyRecorded = (current.events || []).some((event) => event.receiptId === receiptId);
    const previous = current.teams[team] || { id: team, createdAt: timestamp() };
    current.teams[team] = {
      ...previous, status, progress: 100,
      message: receipt.message || `${receipt.stage} handoff accepted`,
      evidence: receipt.manifest || previous.evidence || "",
      receiptId, updatedAt: timestamp(),
    };
    if (!alreadyRecorded) {
      emitted = true;
      record(records, "team", {
        team, status, progress: 100, message: current.teams[team].message,
        evidence: current.teams[team].evidence, receiptId,
      });
    }
  }, statusDir);
  return { team: state.teams[team], emitted };
}

function updateHookContext() {
  const state = withState((current, records) => {
    if (options.clear === "true") {
      delete current.hookContext;
      record(records, "hook-context", { message: "Build lifecycle context cleared" });
      return;
    }
    const team = pipelineTeam(required("team"));
    const task = required("task");
    if (!Object.hasOwn(current.tasks, task)) throw new Error(`Unknown task: ${task}; register it with the task command first`);
    if (current.tasks[task].team !== team) throw new Error(`Task ${task} belongs to ${current.tasks[task].team}, not ${team}`);
    const agent = options.agent || "";
    if (agent && !Object.hasOwn(current.agents, agent)) throw new Error(`Unknown agent: ${agent}; register it with the agent command first`);
    current.hookContext = {
      team,
      task,
      agent,
      workspace: resolve(options.workspace || current.run.workspace || process.cwd()),
      sessionId: options.session || current.hookContext?.sessionId || "",
      updatedAt: timestamp(),
    };
    record(records, "hook-context", { team, agent, task, message: "Build lifecycle context selected" });
  });
  print({ context: state.hookContext || null });
}

function lifecycleHook() {
  const input = readHookInput();
  const runsRoot = resolve(options["runs-dir"] || process.env.BASICS_RUNS_DIR || join(homedir(), ".codex", "build-runs"));
  const entry = resolveHookRun(runsRoot, input);
  if (entry) applyHookEvent(entry.statusDir, input);
  print({});
}

function readHookInput() {
  const raw = readFileSync(0, "utf8").trim();
  if (!raw) throw new Error("Hook command expected a JSON object on stdin");
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Hook input must be a JSON object");
  if (!input.hook_event_name) throw new Error("Hook input is missing hook_event_name");
  return input;
}

function resolveHookRun(runsRoot, input) {
  const cwd = resolve(input.cwd || process.cwd());
  const candidates = discoverRuns(runsRoot).filter(({ error, state }) => {
    if (error || !state.hookContext || !["active", "awaiting-approval"].includes(state.run.status)) return false;
    if (input.session_id && state.hookContext.sessionId === input.session_id) return true;
    const workspace = state.hookContext.workspace || state.run.workspace;
    return workspace ? pathContains(workspace, cwd) : isAbsolute(state.run.repo) && pathContains(state.run.repo, cwd);
  });
  return candidates[0] || null;
}

function pathContains(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function applyHookEvent(statusDir, input) {
  const eventName = input.hook_event_name;
  withState((current, records) => {
    const context = current.hookContext;
    if (!context) return;
    if (input.session_id && !context.sessionId) context.sessionId = input.session_id;
    context.updatedAt = timestamp();
    if (eventName === "PreToolUse") markToolActive(current, records, context, input);
    else if (eventName === "PostToolUse") recordToolOutcome(current, records, context, input);
    else if (eventName === "SubagentStart") markSubagentStarted(current, records, context, input);
    else if (eventName === "SubagentStop") markSubagentStopped(current, records, input);
    else if (eventName === "Stop") reconcileStoppedTurn(current, records);
  }, statusDir);
}

function markToolActive(current, records, context, input) {
  const task = current.tasks[context.task];
  if (!task || !["queued", "waiting", "active"].includes(task.status)) return;
  task.status = "active";
  task.message = `${input.tool_name || "tool"} started`;
  task.evidence = hookCommand(input).slice(0, 512);
  task.updatedAt = timestamp();
  record(records, "task", { task: task.id, team: task.team, taskKind: task.kind, status: "active", progress: task.progress, message: task.message, evidence: task.evidence });
}

function recordToolOutcome(current, records, context, input) {
  const outcome = hookToolOutcome(input.tool_response);
  const command = hookCommand(input);
  record(records, "tool", {
    team: context.team,
    agent: context.agent,
    task: context.task,
    status: outcome,
    message: `${input.tool_name || "tool"} ${outcome}`,
    evidence: command.slice(0, 512),
  });
  const task = current.tasks[context.task];
  if (!task || !task.verificationCommand || !sameCommand(task.verificationCommand, command)) return;
  task.message = outcome === "passed" ? "Declared verification passed" : "Declared verification failed; task remains active";
  task.evidence = command.slice(0, 512);
  task.updatedAt = timestamp();
  if (outcome === "passed") {
    task.status = "passed";
    task.progress = 100;
  } else if (["queued", "waiting"].includes(task.status)) {
    task.status = "active";
  }
  record(records, "task", { task: task.id, team: task.team, taskKind: task.kind, status: task.status, progress: task.progress, message: task.message, evidence: task.evidence });
}

function hookCommand(input) {
  const command = input.tool_input?.command;
  return typeof command === "string" ? command : JSON.stringify(input.tool_input || {});
}

function sameCommand(first, second) {
  return String(first || "").trim().replace(/\s+/g, " ") === String(second || "").trim().replace(/\s+/g, " ");
}

function hookToolOutcome(response) {
  const details = responseOutcomeDetails(response);
  if (details.isError) return "failed";
  if (details.exitCode !== null) return details.exitCode === 0 ? "passed" : "failed";
  const text = typeof response === "string" ? response : JSON.stringify(response || "");
  const exit = text.match(/(?:exit(?:ed)?(?: with)?(?: code| status)?|exit_code)[\s":=]+(-?\d+)/i);
  if (exit) return Number(exit[1]) === 0 ? "passed" : "failed";
  return /(?:^|\n)\s*(?:error|failed|failure)\s*:/i.test(text) ? "failed" : "passed";
}

function responseOutcomeDetails(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return { exitCode: null, isError: false };
  if (value.isError === true || value.error) return { exitCode: null, isError: true };
  for (const key of ["exit_code", "exitCode"]) {
    if (Number.isFinite(Number(value[key]))) return { exitCode: Number(value[key]), isError: false };
  }
  for (const nested of Object.values(value)) {
    const details = responseOutcomeDetails(nested, depth + 1);
    if (details.isError || details.exitCode !== null) return details;
  }
  return { exitCode: null, isError: false };
}

function markSubagentStarted(current, records, context, input) {
  let agent = Object.values(current.agents).find(({ externalAgentId }) => externalAgentId === input.agent_id);
  if (!agent && context.agent && current.agents[context.agent]?.status === "queued") agent = current.agents[context.agent];
  if (!agent) agent = Object.values(current.agents).find(({ team, status }) => team === context.team && status === "queued");
  if (!agent) {
    const id = `${context.team}-${input.agent_id || randomUUID()}`;
    agent = { id, team: context.team, role: input.agent_type || "worker", effort: "unknown", createdAt: timestamp() };
    current.agents[id] = agent;
  }
  agent.externalAgentId = input.agent_id || agent.externalAgentId || "";
  agent.model = input.model || agent.model || "unknown";
  agent.status = "active";
  agent.message = "Subagent host confirmed start";
  agent.updatedAt = timestamp();
  record(records, "agent", { agent: agent.id, team: agent.team, status: agent.status, role: agent.role, model: agent.model, effort: agent.effort || "unknown", message: agent.message });
}

function markSubagentStopped(current, records, input) {
  const agent = Object.values(current.agents).find(({ externalAgentId }) => externalAgentId === input.agent_id);
  if (!agent) return;
  agent.status = subagentFinalStatus(input.last_assistant_message);
  agent.message = String(input.last_assistant_message || "Subagent stopped").slice(0, 512);
  agent.updatedAt = timestamp();
  record(records, "agent", { agent: agent.id, team: agent.team, status: agent.status, role: agent.role, model: agent.model, effort: agent.effort || "unknown", message: agent.message });
}

function subagentFinalStatus(message) {
  const text = String(message || "").trim();
  if (/^(?:status|outcome)\s*:\s*failed\b|^failed\b/i.test(text)) return "failed";
  if (/^(?:status|outcome)\s*:\s*blocked\b|^blocked\b/i.test(text)) return "blocked";
  return "completed";
}

function reconcileStoppedTurn(current, records) {
  let reconciled = 0;
  for (const task of Object.values(current.tasks)) {
    if (task.status !== "active") continue;
    task.status = "waiting";
    task.message = "Turn stopped before declared verification completed";
    task.updatedAt = timestamp();
    reconciled += 1;
    record(records, "task", { task: task.id, team: task.team, taskKind: task.kind, status: task.status, progress: task.progress, message: task.message, evidence: task.evidence || "" });
  }
  record(records, "hook-consistency", {
    team: current.hookContext?.team || "",
    task: current.hookContext?.task || "",
    message: `Stop reconciliation moved ${reconciled} active task(s) to waiting; approval and merge state unchanged`,
  });
}

function updateAgent() {
  const id = required("id");
  const team = pipelineTeam(required("team"));
  const status = valid(required("status"), TEAM_STATES, "agent status");
  const state = withState((current, records) => {
    const previous = Object.hasOwn(current.agents, id) ? current.agents[id] : { id, createdAt: timestamp() };
    const agent = {
      ...previous,
      team,
      role: options.role ?? previous.role ?? "worker",
      model: options.model ?? previous.model ?? "unknown",
      effort: options.effort ?? previous.effort ?? "unknown",
      status,
      message: options.message ?? previous.message ?? "",
      updatedAt: timestamp(),
    };
    Object.defineProperty(current.agents, id, { value: agent, writable: true, enumerable: true, configurable: true });
    record(records, "agent", { agent: id, team, status, role: agent.role, model: agent.model, effort: agent.effort, message: agent.message });
  });
  print({ agent: state.agents[id] });
}

function updateTask() {
  const id = required("id");
  const team = pipelineTeam(required("team"));
  const status = valid(required("status"), TASK_STATES, "task status");
  const requestedKind = options.kind === undefined ? undefined : valid(options.kind, TASK_KINDS, "task kind");
  const progress = asProgress(options.progress);
  const state = withState((current, records) => {
    const previous = current.tasks[id] || { id, createdAt: timestamp() };
    current.tasks[id] = {
      ...previous,
      team,
      kind: requestedKind ?? (TASK_KINDS.has(previous.kind) ? previous.kind : "task"),
      title: options.title ?? previous.title ?? id,
      status,
      progress: progress ?? previous.progress ?? 0,
      message: options.message ?? previous.message ?? "",
      evidence: options.evidence ?? previous.evidence ?? "",
      verificationCommand: options["verification-command"] ?? previous.verificationCommand ?? "",
      updatedAt: timestamp(),
    };
    record(records, "task", { task: id, team, taskKind: current.tasks[id].kind, status, progress: current.tasks[id].progress, message: current.tasks[id].message, evidence: current.tasks[id].evidence });
  });
  print({ task: state.tasks[id] });
}

function addEvent() {
  const kind = required("kind");
  const agent = options.agent || "";
  const team = options.team ? pipelineTeam(options.team) : "";
  const state = withState((current, records) => {
    if (agent && !Object.hasOwn(current.agents, agent)) {
      throw new Error(`Unknown agent: ${agent}; register it with the agent command before publishing an event`);
    }
    record(records, kind, {
      team,
      agent,
      task: options.task || "",
      finding: options.finding || "",
      message: options.message || "",
      evidence: options.evidence || "",
    });
  });
  print({ event: state.events.at(-1) });
}

function normalizeTeamId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return raw;
  const compact = raw.replace(/[_\s]+/g, "-");
  if (/^brainstorm(?:-\d+)?(?:-|$)/.test(compact)) return "brainstorm";
  if (/^(?:seed-?tests?|tests?-seed)(?:-\d+)?(?:-|$)/.test(compact)) return "seed-tests";
  if (/^(?:blue|blue-team)(?:-\d+)?(?:-|$)/.test(compact)) return "blue";
  if (/^(?:red|red-team)(?:-\d+)?(?:-|$)/.test(compact)) return "red";
  if (/^(?:fixer|fixers?|fixer-team)(?:-\d+)?(?:-|$)/.test(compact)) return "fixer";
  if (/^(?:integration|integrate)(?:-\d+)?(?:-|$)/.test(compact)) return "integration";
  return compact;
}

function pipelineTeam(value) {
  const normalized = normalizeTeamId(value);
  if (!PIPELINE_IDS.has(normalized)) throw new Error(`Unknown pipeline team: ${value}`);
  return normalized;
}

function normalizeState(state) {
  state.schemaVersion = 3;
  state.run.slug = state.run.slug || slugFor(state.run.id);
  state.teams = normalizeCollection(state.teams, (entry) => {
    const recordedProgress = Number(entry.progress);
    return {
      ...entry,
      id: normalizeTeamId(entry.id),
      progress: COMPLETED_STATES.has(entry.status)
        ? 100
        : Number.isFinite(recordedProgress) ? Math.max(0, Math.min(100, recordedProgress)) : 0,
    };
  });
  state.agents = normalizeCollection(state.agents, (entry) => ({ ...entry, team: normalizeTeamId(entry.team), effort: entry.effort || "unknown" }));
  state.tasks = normalizeCollection(state.tasks, (entry) => ({ ...entry, team: normalizeTeamId(entry.team), kind: TASK_KINDS.has(entry.kind) ? entry.kind : "task" }));
  for (const event of state.events) {
    if (event.team) event.team = normalizeTeamId(event.team);
  }
  const previousProgress = Number(state.run.progress) || 0;
  const milestones = PIPELINE.map(({ id, label, weight }) => {
    const team = state.teams[id];
    const completed = Boolean(team && COMPLETED_STATES.has(team.status));
    return { id, label, weight, status: team?.status || "queued", completed };
  });
  const measuredProgress = milestones.reduce((total, milestone) => total + (milestone.completed ? milestone.weight : 0), 0);
  const progress = Math.max(previousProgress, measuredProgress);
  state.run.progress = progress;
  state.run.milestones = milestones;
  if (COMPLETED_STATES.has(state.run.status) && !state.run.completedAt) state.run.completedAt = timestamp();
  state.summary = summarizeState(state);
}

function summarizeState(state) {
  const agents = Object.values(state.agents || {});
  const tasks = Object.values(state.tasks || {});
  const teamIds = new Set([
    ...Object.keys(state.teams || {}),
    ...agents.map(({ team }) => team),
    ...tasks.map(({ team }) => team),
  ].filter(Boolean));
  return {
    activeAgents: agents.filter(({ status }) => status === "active").length,
    queuedOrWaitingAgents: agents.filter(({ status }) => status === "queued" || status === "waiting").length,
    openBlockers: tasks.filter(({ status }) => status === "blocked" || status === "failed").length,
    openFindings: tasks.filter(({ kind, status }) => kind === "finding" && !COMPLETED_STATES.has(status)).length,
    unknownTeams: [...teamIds].filter((id) => !PIPELINE_IDS.has(id)).sort(),
  };
}

function normalizeCollection(collection, normalize) {
  const normalized = Object.create(null);
  for (const entry of Object.values(collection || {})) {
    const next = normalize(entry);
    const key = next.id;
    const previous = normalized[key];
    normalized[key] = !previous || String(next.updatedAt || "").localeCompare(String(previous.updatedAt || "")) >= 0 ? next : previous;
  }
  return normalized;
}

async function printState() {
  const paths = files();
  if (!existsSync(paths.state)) throw new Error(`No status store at ${paths.state}`);
  await reconcilePendingHandoffs(paths.root);
  process.stdout.write(`${JSON.stringify(readNormalizedState(paths.state), null, 2)}\n`);
}

function reconcilePendingHandoffs(root) {
  const ledger = join(resolve(root), "handoffs", "run-ledger.json");
  if (!existsSync(ledger)) return;
  // Dynamic import avoids coupling hook startup to the handoff command's CLI.
  return import("./build-handoff.mjs").then(({ reconcile }) => reconcile({ "status-dir": root }));
}

async function serveDashboard() {
  const paths = files();
  if (!existsSync(paths.state)) throw new Error(`No status store at ${paths.state}; run init first`);
  await reconcilePendingHandoffs(paths.root);
  const currentState = readNormalizedState(paths.state);
  const currentSlug = currentState.run.slug || slugFor(currentState.run.id);
  const runsRoot = resolve(options["runs-dir"] || dirname(paths.root));
  mkdirSync(runsRoot, { recursive: true, mode: 0o700 });
  const host = options.host || "127.0.0.1";
  const port = Number(options.port || 4173);
  const apiPort = Number(options["api-port"] || port + 1);
  if (![port, apiPort].every((value) => Number.isInteger(value) && value > 0 && value <= 65535)) {
    throw new Error("--port and --api-port must be integers from 1 to 65535");
  }
  const lease = dashboardLeaseFiles(runsRoot);
  const startupLock = acquireLock(lease.lock);
  let startupLockHeld = true;
  const releaseStartupLock = () => {
    if (!startupLockHeld) return;
    startupLockHeld = false;
    releaseLock(startupLock, lease.lock);
  };
  let apiServer;
  let dashboardServer;
  let instanceId;
  let registeredServer;
  try {
    const existing = readOptionalJson(lease.state);
    if (existing) {
      const health = await probeDashboard(existing);
      if (isReusableDashboard(existing, health, archiveId(runsRoot), host)) {
        releaseStartupLock();
        const dashboardUrl = `${existing.dashboardUrl}/runs/${encodeURIComponent(currentSlug)}`;
        process.stdout.write(`Reusing Build dashboard: ${dashboardUrl}\nStatus API: ${existing.apiUrl}/api/runs/${encodeURIComponent(currentSlug)}/status\n`);
        if (options.open === "true") await reportBrowserLaunch(dashboardUrl);
        return;
      }
      if (processExists(existing.pid)) {
        throw new Error("A registered Build dashboard process is still running but is unhealthy or incompatible; stop it before starting another dashboard");
      }
      unlinkSync(lease.state);
    }

    instanceId = randomUUID();
    const archive = archiveId(runsRoot);
    apiServer = createServer(createApiHandler({ paths, runsRoot, currentSlug, instanceId, archive, bindHost: host }));
    const resolvedApiPort = await listenOnAvailablePort(apiServer, host, apiPort, options["strict-port"] === "true");

    const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/dashboard/dist");
    if (!existsSync(join(dashboardRoot, "index.html"))) {
      apiServer.close();
      throw new Error(`Prebuilt dashboard assets are missing at ${dashboardRoot}`);
    }
    const clientHost = browserHost(host);
    const clientUrlHost = urlHost(clientHost);
    const bootstrapState = serializeBootstrapState(currentState);
    const bootstrapConfig = serializeBootstrapState({ currentSlug });
    const apiBaseUrl = `http://${clientUrlHost}:${resolvedApiPort}`;
    dashboardServer = createServer(createDashboardHandler({ dashboardRoot, apiBaseUrl, bootstrapState, bootstrapConfig }));
    const dashboardPort = await listenOnAvailablePort(dashboardServer, host, port, options["strict-port"] === "true");
    const dashboardBaseUrl = `http://${clientUrlHost}:${dashboardPort}`;
    registeredServer = {
      service: "build-dashboard",
      protocolVersion: DASHBOARD_PROTOCOL_VERSION,
      instanceId,
      archiveId: archive,
      bindHost: host,
      pid: process.pid,
      dashboardUrl: dashboardBaseUrl,
      apiUrl: apiBaseUrl,
      startedAt: timestamp(),
    };
    writeAtomicJson(lease.state, registeredServer);
    releaseStartupLock();

    const dashboardUrl = `${dashboardBaseUrl}/runs/${encodeURIComponent(currentSlug)}`;
    process.stdout.write(`Build dashboard: ${dashboardUrl}\nStatus API: ${apiBaseUrl}/api/runs/${encodeURIComponent(currentSlug)}/status\n`);
    if (options.open === "true") await reportBrowserLaunch(dashboardUrl);
  } catch (error) {
    if (apiServer) apiServer.close();
    if (dashboardServer) dashboardServer.close();
    releaseStartupLock();
    throw error;
  }

  const shutdown = async () => {
    dashboardServer.close();
    apiServer.close();
    removeLeaseIfOwned(lease.state, instanceId);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
}

function createDashboardHandler({ dashboardRoot, apiBaseUrl, bootstrapState, bootstrapConfig }) {
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  return (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const upstream = httpRequest(`${apiBaseUrl}${request.url}`, { method: request.method, headers: request.headers }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on("error", (error) => sendJson(response, 502, { error: error.message }));
      request.pipe(upstream);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      return response.end("Method not allowed");
    }
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      return response.end("Invalid path");
    }
    const isAppRoute = requestedPath === "/" || requestedPath.startsWith("/runs/");
    const relativePath = isAppRoute ? "index.html" : requestedPath.replace(/^\/+/, "");
    const filePath = resolve(dashboardRoot, relativePath);
    const pathWithinRoot = relative(dashboardRoot, filePath);
    if (pathWithinRoot.startsWith("..") || isAbsolute(pathWithinRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return response.end("Not found");
    }
    let body = readFileSync(filePath);
    if (relativePath === "index.html") {
      const bootstrap = `<script>globalThis.__BUILD_STATUS__ = ${bootstrapState}; globalThis.__BUILD_DASHBOARD__ = ${bootstrapConfig};</script>`;
      body = Buffer.from(body.toString("utf8").replace("<head>", `<head>${bootstrap}`));
    }
    const extension = relativePath.slice(relativePath.lastIndexOf("."));
    response.writeHead(200, {
      "Cache-Control": relativePath === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Content-Length": body.length,
    });
    response.end(request.method === "HEAD" ? undefined : body);
  };
}

function createApiHandler({ paths, runsRoot, currentSlug, instanceId, archive, bindHost }) {
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, service: "build-dashboard", protocolVersion: DASHBOARD_PROTOCOL_VERSION, instanceId, archiveId: archive, bindHost });
    }
    if (url.pathname === "/api/status") {
      try {
        await reconcilePendingHandoffs(paths.root);
        return sendJson(response, 200, readNormalizedState(paths.state));
      } catch (error) {
        return sendJson(response, 500, { error: error.message });
      }
    }
    if (url.pathname === "/api/runs") {
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const requestedLimit = Number(url.searchParams.get("limit") || (query ? 50 : 20));
      const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 20;
      const catalog = discoverRuns(runsRoot, paths.state);
      const matches = catalog.filter(({ state, error }) => !error && runMatches(state, query));
      return sendJson(response, 200, { runs: matches.slice(0, limit).map(({ state }) => runMetadata(state)), total: matches.length });
    }
    const match = url.pathname.match(/^\/api\/runs\/([^/]+)\/(status|export)$/);
    if (match) {
      let slug;
      try {
        slug = validRunSlug(decodeURIComponent(match[1]));
      } catch (error) {
        return sendJson(response, 400, { error: error.message });
      }
      let entry = findRun(runsRoot, paths.state, slug);
      if (!entry) return sendJson(response, 404, { error: `Unknown run: ${slug}` });
      if (entry.error) return sendJson(response, 422, { error: entry.error });
      try {
        await reconcilePendingHandoffs(entry.statusDir);
        entry = findRun(runsRoot, paths.state, slug);
      } catch (error) {
        return sendJson(response, 500, { error: error.message });
      }
      if (match[2] === "status") return sendJson(response, 200, entry.state);
      try {
        return sendDownload(response, `${slug}-build-status.json`, createRunExport(entry));
      } catch (error) {
        return sendJson(response, 500, { error: error.message });
      }
    }
    if (url.pathname === "/api/current") return sendJson(response, 200, { slug: currentSlug });
    return sendJson(response, 404, { error: "Not found" });
  };
}

function discoverRuns(runsRoot, currentStatePath = "") {
  const candidates = new Map();
  if (existsSync(runsRoot)) {
    for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !RUN_SLUG.test(entry.name)) continue;
      const statePath = join(runsRoot, entry.name, "status", "status.json");
      if (existsSync(statePath)) candidates.set(resolve(statePath), { slug: entry.name, statePath, durable: true });
    }
  }
  if (currentStatePath && existsSync(currentStatePath) && !candidates.has(resolve(currentStatePath))) {
    try {
      const state = JSON.parse(readFileSync(currentStatePath, "utf8"));
      const slug = state.run?.slug || slugFor(state.run?.id);
      candidates.set(resolve(currentStatePath), { slug, statePath: resolve(currentStatePath), durable: false });
    } catch {
      // The normal catalog pass below reports durable corrupt entries; legacy launch state stays available through /api/status.
    }
  }
  const runs = [...candidates.values()].map((candidate) => {
    try {
      const state = readNormalizedState(candidate.statePath);
      state.run.slug = state.run.slug || candidate.slug;
      const slug = validRunSlug(state.run.slug);
      if (candidate.durable && slug !== candidate.slug) throw new Error(`Run slug ${slug} does not match archive directory ${candidate.slug}`);
      return { ...candidate, slug, statusDir: dirname(candidate.statePath), state };
    } catch (error) {
      return { ...candidate, statusDir: dirname(candidate.statePath), error: error.message };
    }
  });
  const duplicates = new Map();
  for (const entry of runs.filter(({ error }) => !error)) {
    const previous = duplicates.get(entry.slug);
    if (!previous) duplicates.set(entry.slug, entry);
    else {
      previous.error = `Duplicate run slug: ${entry.slug}`;
      entry.error = `Duplicate run slug: ${entry.slug}`;
    }
  }
  return runs.sort((first, second) => String(second.state?.run?.updatedAt || "").localeCompare(String(first.state?.run?.updatedAt || "")) || first.slug.localeCompare(second.slug));
}

function findRun(runsRoot, currentStatePath, slug) {
  const candidates = [];
  const runDirectory = join(runsRoot, slug);
  const durableStatePath = join(runDirectory, "status", "status.json");
  if (existsSync(runDirectory)) {
    const directoryState = lstatSync(runDirectory);
    if (directoryState.isDirectory() && !directoryState.isSymbolicLink() && existsSync(durableStatePath)) {
      candidates.push({ slug, statePath: durableStatePath, durable: true });
    }
  }
  if (currentStatePath && resolve(currentStatePath) !== resolve(durableStatePath) && existsSync(currentStatePath)) {
    try {
      const currentState = readNormalizedState(currentStatePath);
      if ((currentState.run?.slug || slugFor(currentState.run?.id)) === slug) candidates.push({ slug, statePath: resolve(currentStatePath), durable: false });
    } catch {
      // /api/status remains the compatibility path for an unreadable external launch state.
    }
  }
  if (candidates.length > 1) return { slug, error: `Duplicate run slug: ${slug}` };
  if (candidates.length === 0) return null;
  const candidate = candidates[0];
  try {
    const state = readNormalizedState(candidate.statePath);
    state.run.slug = state.run.slug || candidate.slug;
    const recordedSlug = validRunSlug(state.run.slug);
    if (candidate.durable && recordedSlug !== candidate.slug) throw new Error(`Run slug ${recordedSlug} does not match archive directory ${candidate.slug}`);
    return { ...candidate, slug: recordedSlug, statusDir: dirname(candidate.statePath), state };
  } catch (error) {
    return { ...candidate, statusDir: dirname(candidate.statePath), error: error.message };
  }
}

function runMetadata(state) {
  return {
    slug: state.run.slug,
    id: state.run.id,
    repo: state.run.repo,
    branch: state.run.branch,
    base: state.run.base,
    status: state.run.status,
    progress: state.run.progress,
    startedAt: state.run.startedAt,
    updatedAt: state.run.updatedAt,
    completedAt: state.run.completedAt || "",
  };
}

function runMatches(state, query) {
  if (!query) return true;
  const normalizedQuery = String(query).toLowerCase();
  return [state.run.slug, state.run.id, state.run.repo, state.run.branch, state.run.status]
    .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
}

function createRunExport(entry) {
  const exportPaths = { state: entry.statePath, events: join(entry.statusDir, "events.ndjson"), lock: join(entry.statusDir, ".status.lock") };
  const lockHandle = acquireLock(exportPaths.lock);
  try {
    const state = readNormalizedState(exportPaths.state);
    const events = reconcileEventLog(exportPaths, state);
    const { events: recentEvents, ...snapshot } = state;
    const seen = new Set(events.map(({ id }) => id));
    const completeEvents = [...events, ...(recentEvents || []).filter(({ id }) => !seen.has(id))];
    return { exportSchemaVersion: 1, generatedAt: timestamp(), status: snapshot, events: completeEvents };
  } finally {
    releaseLock(lockHandle, exportPaths.lock);
  }
}

function dashboardLeaseFiles(runsRoot) {
  return { state: join(runsRoot, "dashboard-server.json"), lock: join(runsRoot, ".dashboard-server.lock") };
}

function archiveId(runsRoot) {
  return createHash("sha256").update(resolve(runsRoot)).digest("hex").slice(0, 16);
}

function isReusableDashboard(registry, health, expectedArchiveId, expectedBindHost) {
  return Boolean(health.ok
    && health.body?.service === "build-dashboard"
    && health.body?.protocolVersion === DASHBOARD_PROTOCOL_VERSION
    && health.body?.instanceId === registry?.instanceId
    && health.body?.archiveId === expectedArchiveId
    && registry?.bindHost === expectedBindHost
    && health.body?.bindHost === expectedBindHost);
}

function readOptionalJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeAtomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function processExists(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function probeDashboard(registry, timeoutMs = 800) {
  return new Promise((resolvePromise) => {
    if (!registry?.apiUrl) return resolvePromise({ ok: false });
    const request = httpRequest(`${registry.apiUrl}/api/health`, { method: "GET", timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolvePromise({ ok: response.statusCode === 200, body: JSON.parse(body) });
        } catch {
          resolvePromise({ ok: false });
        }
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolvePromise({ ok: false }));
    request.end();
  });
}

function releaseLock(handle, lockPath) {
  if (handle === undefined || handle === null) return;
  closeSync(handle);
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function removeLeaseIfOwned(path, instanceId) {
  const lease = readOptionalJson(path);
  if (lease?.instanceId !== instanceId) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function reportBrowserLaunch(url) {
  const launch = await openDefaultBrowser(url);
  process.stdout.write(launch.ok
    ? `Browser launch requested with ${launch.command}.\n`
    : `Browser launch unavailable: ${launch.error}\n`);
}

async function listenOnAvailablePort(server, host, preferredPort, strict) {
  let candidate = preferredPort;
  for (let attempt = 0; attempt < (strict ? 1 : 20); attempt += 1) {
    try {
      await new Promise((resolvePromise, rejectPromise) => {
        const onError = (error) => {
          server.off("listening", onListening);
          rejectPromise(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolvePromise();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(candidate, host);
      });
      return candidate;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || strict) throw error;
      candidate += 1;
      if (candidate > 65535) candidate = 1024;
    }
  }
  throw new Error(`No available API port found near ${preferredPort}`);
}

function browserHost(host) {
  return host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
}

function urlHost(host) {
  return String(host).includes(":") && !String(host).startsWith("[") ? `[${host}]` : host;
}

function serializeBootstrapState(state) {
  return JSON.stringify(state).replaceAll("<", "\\u003c");
}

function browserLaunchCommand(platform, url) {
  return platform === "darwin"
    ? { command: "open", args: [url] }
    : platform === "win32"
      ? { command: "cmd", args: ["/d", "/s", "/c", "start", "", url] }
      : { command: "xdg-open", args: [url] };
}

async function openDefaultBrowser(url, spawnProcess = spawn) {
  const launch = browserLaunchCommand(process.platform, url);
  return new Promise((resolvePromise) => {
    let settled = false;
    const child = spawnProcess(launch.command, launch.args, { stdio: "ignore" });
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(result);
    };
    const timeout = setTimeout(() => {
      child.unref();
      settle({ ok: true, command: launch.command });
    }, 3000);
    child.once("error", (error) => settle({ ok: false, error: error.message }));
    child.once("exit", (code) => settle(code === 0
      ? { ok: true, command: launch.command }
      : { ok: false, error: `${launch.command} exited with status ${code}` }));
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body)}\n`);
}

function sendDownload(response, filename, body) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printUsage() {
  process.stdout.write("Usage: build-status.mjs <init|run|team|agent|task|event|context|hook|read|serve> [options]\nHook options: context --state-dir <path> --team <id> --task <id> [--agent <id>] [--workspace <path>] | hook [--runs-dir <durable-archive>] < event.json\nServe options: --runs-dir <durable-archive> --host <host> --port <preferred-port> --api-port <preferred-port> --open [--strict-port]\n");
}

export { archiveId, browserHost, browserLaunchCommand, createRunExport, discoverRuns, findRun, hookToolOutcome, isReusableDashboard, normalizeState, normalizeTeamId, openDefaultBrowser, pathContains, pipelineTeam, reconcileTeamReceipt, runMatches, runMetadata, sameCommand, serializeBootstrapState, slugFor, subagentFinalStatus, summarizeState, urlHost, validRunSlug };
