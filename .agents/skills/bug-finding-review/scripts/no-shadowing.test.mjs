import assert from "node:assert/strict";
import test from "node:test";
import { lintText } from "./no-shadowing.mjs";

const blocked = new Set(["file", "window", "error"]);
test("detects declarations, loop variables, catches, and parameters case-insensitively", () => {
  const issues = lintText("local File := 1\nfor Window in items\ncatch Error\nRun(ByRef file, ok) {", blocked);
  assert.deepEqual(issues.map(([line, message]) => [line, message]), [[1, "shadowed name in declaration: File"], [2, "shadowed name in for-variable: Window"], [3, "shadowed name in catch-variable: Error"], [4, "shadowed name in parameter: file"]]);
});
test("ignores comments, assignments, and safe identifiers", () => assert.deepEqual(lintText("; local File\nFile := 1\nlocal safe := 2", blocked), []));
test("handles BOM and comma-separated declarations", () => assert.deepEqual(lintText("\uFEFFglobal safe, Window := 1", blocked), [[1, "shadowed name in declaration: Window"]]));
