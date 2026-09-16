#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TUNNEL_SCRIPT = "node scripts/expo-go-launch.mjs tunnel";
export const STATUS_SCRIPT = "node scripts/expo-go-launch.mjs status";
const REQUIRED_TUNNEL_DEPENDENCIES = ["@expo/ngrok", "qrcode-terminal"];

function dependencyNames(packageJson) {
  return new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
  ]);
}

export function inspectPackage(packageJson) {
  const dependencies = dependencyNames(packageJson);
  return {
    expo: dependencies.has("expo"),
    missing: REQUIRED_TUNNEL_DEPENDENCIES.filter((name) => !dependencies.has(name)),
  };
}

export function configurePackage(packageJson) {
  const scripts = { ...(packageJson?.scripts ?? {}) };
  return {
    ...packageJson,
    scripts: {
      ...scripts,
      start: TUNNEL_SCRIPT,
      "start:status": STATUS_SCRIPT,
    },
  };
}

export async function configureProject({ projectRoot = process.cwd(), write = false } = {}) {
  const packagePath = join(resolve(projectRoot), "package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${packagePath}: ${error.message}`);
  }

  const inspection = inspectPackage(packageJson);
  if (!inspection.expo) {
    throw new Error(`Refusing to configure ${packagePath}: it does not declare the project-local expo package.`);
  }

  const configured = configurePackage(packageJson);
  if (write) {
    const launcher = join(resolve(projectRoot), "scripts", "expo-go-launch.mjs");
    const source = await readFile(new URL("./expo-go-launch.mjs", import.meta.url), "utf8");
    let existing;
    try { existing = await readFile(launcher, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing !== undefined && existing !== source) {
      throw new Error(`Existing launcher differs: ${launcher}. Adapt it to preserve repository-specific behavior.`);
    }
    await mkdir(dirname(launcher), { recursive: true });
    if (existing === undefined) await writeFile(launcher, source, { flag: "wx" });
    await writeFile(packagePath, `${JSON.stringify(configured, null, 2)}\n`);
  }
  return { packagePath, configured, missing: inspection.missing, wrote: write };
}

function usage() {
  return "Usage: node configure-expo-run.mjs --check|--write [project-root]";
}

async function main(argv) {
  const options = new Set(argv.filter((argument) => argument.startsWith("--")));
  const roots = argv.filter((argument) => !argument.startsWith("--"));
  if (options.size !== 1 || roots.length > 1 || (!options.has("--check") && !options.has("--write"))) {
    throw new Error(usage());
  }

  const result = await configureProject({ projectRoot: roots[0] ?? ".", write: options.has("--write") });
  const mode = result.wrote ? "Updated" : "Preview";
  process.stdout.write(`${mode} ${result.packagePath}\n`);
  process.stdout.write(`start: ${TUNNEL_SCRIPT}\nstart:status: ${STATUS_SCRIPT}\n`);
  if (result.missing.length) {
    process.stdout.write(
      `Missing tunnel dependencies: ${result.missing.join(", ")}. With approval, run: pnpm add -D ${result.missing.join(" ")}\n`,
    );
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`expo-run configuration failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
