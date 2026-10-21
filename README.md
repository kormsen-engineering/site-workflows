# site-workflows

Shared GitHub Actions workflows and a Renovate preset for Kormsen client site repos (Astro sites
edited with the Kormsen CMS). Every site made from
[`site-template`](https://github.com/kormsen-engineering/site-template) uses them.

This repo holds **no secrets** and is meant to be **public** (see "Why this repo must be public").

| File | What it is |
|---|---|
| `.github/workflows/site-ci.yml` | Reusable site CI: `pnpm install --frozen-lockfile`, typecheck (`typecheck` or `check` script), build, `test` if present, `cms:schema:check` if present |
| `.github/workflows/clean-room.yml` | Reusable clean-room build: proves the site builds with no Kormsen credential |
| `default.json` | Renovate preset for site repos |
| `.github/workflows/self-test.yml` | This repo's own CI: runs both workflows against `test-fixture/` and tests the scripts they inline |
| `test-fixture/` | A tiny Astro site with public npm packages only |

## How a site uses them

Pin by **full commit SHA** (the org requires SHA pinning; Renovate keeps the SHA current):

```yaml
# .github/workflows/ci.yml in a site repo
name: ci
on:
  push:
    branches: [main]
  pull_request: {}
permissions:
  contents: read
jobs:
  site-ci:
    uses: kormsen-engineering/site-workflows/.github/workflows/site-ci.yml@<sha> # main
  clean-room:
    uses: kormsen-engineering/site-workflows/.github/workflows/clean-room.yml@<sha> # main
    with:
      allow-vendor: true # warn, not fail, on vendor/ tarballs while sites still vendor
```

Do **not** pass `secrets:` (or `secrets: inherit`) to either: the clean-room build fails if it gets any.

```json
// renovate.json in a site repo
{ "extends": ["github>kormsen-engineering/site-workflows"] }
```

### Inputs

| Workflow | Input | Default | |
|---|---|---|---|
| both | `working-directory` | `.` | the site's folder |
| both | `node-version` | `""` | empty: `node` from `mise.toml`, else `.node-version`/`.nvmrc`, else `24` |
| `site-ci` | `runs-on` | `ubuntu-24.04` | for example a self-hosted CI box |
| `site-ci` | `build-env` | `""` | `KEY=value` lines for build and tests (dummy values only) |
| `clean-room` | `allow-vendor` | `true` | `true`: vendor/ tarballs warn; `false`: they fail |

pnpm comes from the site's `packageManager` field through corepack (bundled with Node 24). No
third-party pnpm action.

## The clean-room build

`distribution-design.md` §7: every site must build with no Kormsen credential, during the contract
and after the client leaves. The job:

- runs on a fresh GitHub-hosted runner (never a self-hosted box);
- has `permissions: contents: read` only: the `GITHUB_TOKEN` has no packages scope; checkout does
  not keep it (`persist-credentials: false`);
- fails if the caller passed any secret;
- uses no user or global npm config, and `--registry=https://registry.npmjs.org/`;
- **fails** if `.npmrc` or `pnpm-workspace.yaml` sets another registry or holds a credential, if a
  dependency in `package.json` or `pnpm-lock.yaml` comes from another registry, a git repo or a URL,
  or if a `file:`/`link:` dependency points outside the repo;
- **warns** (or fails with `allow-vendor: false`) when the lockfile references `vendor/` tarballs;
- then runs `pnpm install --frozen-lockfile && pnpm build`.

Not enforced: network egress. GitHub-hosted runners reach the whole internet, and egress-blocking
actions are third-party (not allowed in the org). A build step that downloads from elsewhere is not
caught by this job.

### "Package not published yet"

Both workflows first ask npmjs.com whether every `@kormsen-engineering/*` dependency is published.
While one is not (today: `@kormsen-engineering/cms-astro`), they **skip** install, build and tests
with the warning *"Package not published yet"* and a line in the job summary, so a site made from
`site-template` is green with a clear reason instead of failing obscurely. A published package whose
pinned version does not exist fails with a clear error.

## The Renovate preset (`default.json`)

- weekly (Monday before 4 am, Europe/London), with the Dependency Dashboard;
- every version pinned exactly; GitHub Actions and reusable workflows pinned by digest;
- all non-major updates in one weekly PR;
- `@kormsen-engineering/cms-astro` and `astro` in one group ("Kormsen CMS and Astro"), pinned exactly:
  the CMS edit build patches one Astro file, so they must move together;
- `@kormsen-engineering/*` minor and patch updates **merge themselves only when every status check
  passes** (`platformAutomerge: false`, so Renovate checks CI itself, even without branch protection).
  Astro never merges by itself, so a group with an Astro bump waits for review;
- majors need approval on the Dependency Dashboard.

## Why this repo must be public

Clients own their site repo from day one, in **their own GitHub org** (`distribution-design.md` §12).
GitHub lets a workflow call a reusable workflow from a **private** repo only inside the same owner
(with the repo's Actions access set to the organisation). A site in a client's org cannot call
`kormsen-engineering/site-workflows` while it is private, and Renovate in the client's org cannot
read the preset either.

Until it is public:

- sites inside `kormsen-engineering` (private repos) can call it: this repo's Actions access is set
  to "Accessible from repositories in the kormsen-engineering organization";
- a site in a client's org cannot. Make this repo public before the first site moves, or copy the
  workflows into that site (Renovate then updates them).

Before making it public: check that nothing here is client-specific or secret (it is designed so
nothing is), and add a licence.

## Tests

```sh
node --test tests/*.test.mjs   # the inlined scripts, the preset rules, SHA pinning
cd test-fixture && pnpm install && pnpm check && pnpm build && pnpm test
```

The scripts the workflows run are inlined as heredocs, because a calling job cannot fetch files
from this repo while it is private. The tests extract and run that exact text.
