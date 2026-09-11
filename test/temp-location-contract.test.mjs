import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PROJECT,
  resolveTempLocation,
  tempPath,
} from "../.agents/shared/temp-location.mjs";

test("a configured general root owns concise project and topic paths", () => {
  const location = resolveTempLocation({ environment: { BASICS_TEMP_ROOT: "/scratch/root" }, platform: "linux" });
  assert.equal(location.root, "/scratch/root");
  assert.equal(location.source, "BASICS_TEMP_ROOT");
  assert.equal(tempPath(location, { project: "agent-workflows", topic: "expo", name: "expo-go-qr.txt" }), "/scratch/root/agent-workflows/expo/expo-go-qr.txt");
});

test("blank new variable falls back to the legacy Build root before platform temp", () => {
  const legacy = resolveTempLocation({ environment: { BASICS_TEMP_ROOT: "  ", BASICS_WORKTREE_ROOT: "/legacy" }, platform: "linux" });
  assert.equal(legacy.root, "/legacy");
  assert.equal(legacy.source, "BASICS_WORKTREE_ROOT");
  const fallback = resolveTempLocation({ environment: {}, platform: "win32", platformTemporaryRoot: "C:\\Users\\Jeff\\AppData\\Local\\Temp" });
  assert.equal(fallback.source, "platform-temp");
  assert.equal(fallback.root, "C:\\Users\\Jeff\\AppData\\Local\\Temp");
});

test("project and topic values cannot escape the resolved root", () => {
  const location = resolveTempLocation({ environment: { BASICS_TEMP_ROOT: "/scratch/root" }, platform: "linux" });
  assert.equal(DEFAULT_PROJECT, "agent-workflows");
  for (const invalid of ["", ".", "..", "a/b", "a\\b"]) {
    assert.throws(() => tempPath(location, { project: invalid, topic: "expo", name: "qr.txt" }), /safe path segment/);
  }
});
