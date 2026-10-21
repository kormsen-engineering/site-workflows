// Tests for the scripts inlined in the reusable workflows. They are inlined (heredocs in `run:`) because a
// caller's job cannot fetch files from this repo while it is private; these tests run the exact text.
//   node --test tests/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repo = new URL("..", import.meta.url).pathname;
const fixtures = join(repo, "tests/fixtures");
const work = mkdtempSync(join(tmpdir(), "site-workflows-"));

/** The heredoc that writes `name` in `workflow`, with the YAML indentation removed. */
function inlineScript(workflow, name) {
	const lines = readFileSync(join(repo, ".github/workflows", workflow), "utf8").split("\n");
	const start = lines.findIndex((l) => l.includes(`/${name}" <<'JS'`));
	assert.ok(start >= 0, `${workflow}: no heredoc for ${name}`);
	const indent = lines[start].match(/^ */)[0].length;
	const end = lines.findIndex((l, i) => i > start && l.trim() === "JS");
	const body = lines.slice(start + 1, end).map((l) => l.slice(indent)).join("\n");
	const file = join(work, `${workflow}-${name}`);
	writeFileSync(file, body);
	return { file, body };
}

const checker = inlineScript("clean-room.yml", "check-dependency-sources.mjs").file;
function check(fixture, allowVendor = "true") {
	const r = spawnSync(process.execPath, [checker, join(fixtures, fixture), allowVendor], { encoding: "utf8", env: { PATH: process.env.PATH } });
	return { code: r.status, out: r.stdout + r.stderr };
}

test("npmjs.com-only dependencies pass", () => {
	const r = check("npm-only");
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /Dependency sources OK/);
});

test("link: inside the repo passes (also relative to a workspace package)", () => {
	const r = check("link-inside");
	assert.equal(r.code, 0, r.out);
});

test("link: outside the repo fails", () => {
	const r = check("link-outside");
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /::error.*link:\.\.\/\.\.\/machine-ui\/packages\/kormsen-cms-astro points outside the repo/);
});

test("vendor/ tarballs warn while allow-vendor is true", () => {
	const r = check("vendor", "true");
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /::warning.*vendor\/kormsen-cms-astro-0\.1\.0\.tgz is a vendored tarball/);
	assert.doesNotMatch(r.out, /::error/);
});

test("vendor/ tarballs fail when allow-vendor is false", () => {
	const r = check("vendor", "false");
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /::error.*vendored tarball/);
});

test("a tarball from GitHub Packages fails", () => {
	const r = check("other-registry");
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /::error.*tarball from https:\/\/npm\.pkg\.github\.com/);
});

test("an .npmrc scope registry and token fail", () => {
	const r = check("npmrc-registry");
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /\.npmrc: @kormsen-engineering:registry is https:\/\/npm\.pkg\.github\.com/);
	assert.match(r.out, /\.npmrc holds a credential setting/);
});

test("a git dependency fails", () => {
	const r = check("git-dep");
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /thing is github:someone\/thing#main/);
	assert.match(r.out, /tarball from https:\/\/codeload\.github\.com/);
});

test("a missing lockfile fails", () => {
	const r = check("no-lockfile");
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /no pnpm-lock\.yaml/);
});

test("both workflows inline the same published-package check", () => {
	const a = inlineScript("site-ci.yml", "kormsen-packages-published.mjs").body;
	const b = inlineScript("clean-room.yml", "kormsen-packages-published.mjs").body;
	assert.equal(a, b);
});

const published = inlineScript("site-ci.yml", "kormsen-packages-published.mjs").file;
function preflight(fixture) {
	const output = join(work, `${fixture.replace("/", "-")}.out`);
	writeFileSync(output, "");
	const r = spawnSync(process.execPath, [published, join(fixtures, fixture)], { encoding: "utf8", env: { PATH: process.env.PATH, GITHUB_OUTPUT: output } });
	return { code: r.status, out: r.stdout + r.stderr, output: readFileSync(output, "utf8") };
}

test("an unpublished @kormsen-engineering package skips with a clear warning (asks npmjs.com)", () => {
	const r = preflight("pkg/unpublished");
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /::warning title=Package not published yet::@kormsen-engineering\/site-workflows-test-never-published not published on npmjs\.com yet/);
	assert.equal(r.output, "skip=true\n");
});

test("a site with no @kormsen-engineering package does not skip", () => {
	const r = preflight("pkg/none");
	assert.equal(r.code, 0, r.out);
	assert.equal(r.output, "skip=false\n");
});

test("default.json is valid JSON with the agreed rules", () => {
	const preset = JSON.parse(readFileSync(join(repo, "default.json"), "utf8"));
	const rules = preset.packageRules;
	const cms = rules.find((r) => r.groupName === "Kormsen CMS and Astro");
	assert.deepEqual(cms.matchPackageNames.sort(), ["@kormsen-engineering/cms-astro", "astro"]);
	assert.equal(cms.rangeStrategy, "pin");
	const auto = rules.filter((r) => r.automerge === true);
	assert.equal(auto.length, 1);
	assert.deepEqual(auto[0].matchPackageNames, ["@kormsen-engineering/**"]);
	assert.deepEqual(auto[0].matchUpdateTypes.sort(), ["minor", "patch"]);
	assert.ok(rules.some((r) => r.matchUpdateTypes?.includes("major") && r.dependencyDashboardApproval === true));
	assert.equal(preset.platformAutomerge, false);
});

test("every action is pinned to a full commit SHA", () => {
	for (const wf of ["site-ci.yml", "clean-room.yml", "self-test.yml"]) {
		const text = readFileSync(join(repo, ".github/workflows", wf), "utf8");
		for (const [, ref] of text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
			if (ref.startsWith("./")) continue;
			assert.match(ref, /^actions\/[\w-]+@[0-9a-f]{40}$|^kormsen-engineering\/[\w.-]+\/\.github\/workflows\/[\w.-]+@[0-9a-f]{40}$/, `${wf}: ${ref}`);
		}
	}
});

