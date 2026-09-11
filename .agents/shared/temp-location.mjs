import { tmpdir } from "node:os";
import { posix, win32 } from "node:path";

const DEFAULT_PROJECT = "agent-workflows";

function pathApi(platform = process.platform) {
  return platform === "win32" ? win32 : posix;
}

function configuredValue(environment, name) {
  const value = environment?.[name];
  return typeof value === "string" ? value.trim() : "";
}

function safePathSegment(value, label) {
  const segment = String(value ?? "").trim();
  if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
    throw new Error(`${label} must be one safe path segment`);
  }
  return segment;
}

function resolveTempLocation(options = {}) {
  const environment = options.environment || process.env;
  const platform = options.platform || process.platform;
  const paths = pathApi(platform);
  const configured = configuredValue(environment, "BASICS_TEMP_ROOT");
  const legacy = configuredValue(environment, "BASICS_WORKTREE_ROOT");
  const fallback = String(options.platformTemporaryRoot || tmpdir()).trim();
  const root = configured || legacy || fallback;
  if (!root) throw new Error("A temporary root is required");
  if (!paths.isAbsolute(root)) throw new Error(`Temporary root must be absolute: ${root}`);
  return {
    root: paths.normalize(root),
    source: configured ? "BASICS_TEMP_ROOT" : legacy ? "BASICS_WORKTREE_ROOT" : "platform-temp",
    platform,
  };
}

function tempPath(location, options = {}) {
  if (!location?.root) throw new Error("A resolved temporary location is required");
  const paths = pathApi(location.platform);
  const root = paths.normalize(String(location.root));
  if (!paths.isAbsolute(root)) throw new Error(`Temporary root must be absolute: ${root}`);
  const project = safePathSegment(options.project ?? DEFAULT_PROJECT, "project");
  const topic = safePathSegment(options.topic, "topic");
  const name = safePathSegment(options.name, "name");
  return paths.join(root, project, topic, name);
}

export { DEFAULT_PROJECT, resolveTempLocation, safePathSegment, tempPath };
