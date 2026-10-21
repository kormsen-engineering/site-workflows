import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("the build wrote the home page with the note", () => {
	assert.ok(existsSync("dist/index.html"), "run pnpm build first");
	assert.match(readFileSync("dist/index.html", "utf8"), /Hello from the fixture/);
});
