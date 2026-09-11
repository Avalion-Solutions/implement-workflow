#!/usr/bin/env node
import { accessSync, constants, existsSync, readFileSync, realpathSync, statfsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PROJECT, resolveTempLocation, tempPath } from "../../../shared/temp-location.mjs";

const NETWORK_FILESYSTEMS = new Set(["9p", "afs", "ceph", "cifs", "fuse.sshfs", "nfs", "nfs4", "smb3", "smbfs"]);
const DEFAULT_MINIMUM_FREE_BYTES = 1024 ** 3;
const directExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function mountInfoFor(path, mountInfo = readMountInfo()) {
  const absolute = resolve(path);
  return mountInfo
    .filter(({ mountPoint }) => absolute === mountPoint || (!relative(mountPoint, absolute).startsWith("..") && !isAbsolute(relative(mountPoint, absolute))))
    .sort((left, right) => right.mountPoint.length - left.mountPoint.length || right.mountId - left.mountId)[0] || null;
}

function readMountInfo(path = "/proc/self/mountinfo") {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => {
    const [left, right = ""] = line.split(" - ", 2);
    const fields = left.split(" ");
    const after = right.split(" ");
    return {
      mountId: Number(fields[0]) || 0,
      mountPoint: fields[4].replaceAll("\\040", " "),
      options: new Set([...(fields[5] || "").split(","), ...(after[2] || "").split(",")]),
      filesystem: after[0] || "unknown",
    };
  });
}

function inspectRoot(path, minimumFreeBytes = DEFAULT_MINIMUM_FREE_BYTES, operations = {}) {
  const exists = operations.exists || existsSync;
  const stat = operations.stat || statSync;
  const access = operations.access || accessSync;
  const realpath = operations.realpath || realpathSync;
  const statfs = operations.statfs || statfsSync;
  const findMount = operations.mountInfo || mountInfoFor;
  if (!exists(path)) throw new Error(`temporary root does not exist: ${path}`);
  if (!stat(path).isDirectory()) throw new Error(`temporary root is not a directory: ${path}`);
  try { access(path, constants.W_OK | constants.X_OK); } catch { throw new Error(`temporary root is not writable and searchable: ${path}`); }
  const root = realpath(path);
  const filesystem = statfs(root);
  const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  if (availableBytes < minimumFreeBytes) throw new Error(`temporary root has ${availableBytes} free bytes; ${minimumFreeBytes} required`);
  const mount = findMount(root);
  if (mount && NETWORK_FILESYSTEMS.has(mount.filesystem)) throw new Error(`temporary root uses unsupported network filesystem ${mount.filesystem}`);
  if (mount?.options.has("ro") || mount?.options.has("noexec")) throw new Error(`temporary root has incompatible mount options: ${[...mount.options].filter((option) => option === "ro" || option === "noexec").join(",")}`);
  return { root, availableBytes, filesystem: mount?.filesystem || "unknown", mountPoint: mount?.mountPoint || null };
}

function resolveBuildWorktree(options = {}) {
  const environment = options.environment || process.env;
  const runId = String(options.runId || "").trim();
  if (!runId || runId.includes("/") || runId.includes("\\") || runId === "." || runId === "..") throw new Error("runId must be one safe path segment");
  const location = resolveTempLocation({ environment, platformTemporaryRoot: options.fallbackRoot });
  const candidate = resolve(location.root);
  const inspected = (options.inspect || inspectRoot)(candidate, options.minimumFreeBytes || DEFAULT_MINIMUM_FREE_BYTES);
  const runRoot = tempPath({ ...location, root: inspected.root }, { project: options.project || DEFAULT_PROJECT, topic: "build-runs", name: runId });
  return {
    ...inspected,
    source: location.source,
    runRoot,
    integration: join(runRoot, "integration"),
  };
}

function requireRecordedWorktree(ledger, requestedRoot = "") {
  const recorded = ledger?.worktree;
  if (!recorded?.root || !recorded?.runRoot || !recorded?.integration) throw new Error("Run ledger has no recorded worktree root");
  if (requestedRoot && resolve(requestedRoot) !== recorded.root) throw new Error(`Child worktree root override rejected: ${resolve(requestedRoot)} != ${recorded.root}`);
  return recorded;
}

if (directExecution) {
  try {
    const [command, ...tokens] = process.argv.slice(2);
    const options = Object.fromEntries(tokens.reduce((pairs, token, index) => token.startsWith("--") ? [...pairs, [token.slice(2), tokens[index + 1]]] : pairs, []));
    if (command !== "resolve") throw new Error("usage: worktree-root.mjs resolve --run <run-id>");
    process.stdout.write(`${JSON.stringify(resolveBuildWorktree({ runId: options.run }))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export { DEFAULT_MINIMUM_FREE_BYTES, NETWORK_FILESYSTEMS, inspectRoot, mountInfoFor, readMountInfo, requireRecordedWorktree, resolveBuildWorktree };
