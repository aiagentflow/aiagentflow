---
name: release
description: Cut a new release of @aiagentflow/cli. Triggers the GitHub Actions release pipeline — bumps version, opens bump PR, then tags and publishes to npm after merge.
---

# Release @aiagentflow/cli

Run this skill whenever you want to cut a new version. It will walk through every step and confirm each one before continuing.

## Step 1 — Determine bump type

If the user did not pass an argument, ask:

> What kind of release is this?
> - `patch` — bug fixes only (0.9.0 → 0.9.1)
> - `minor` — new features, backward-compatible (0.9.0 → 0.10.0)
> - `major` — breaking changes (0.9.0 → 1.0.0)

Use the argument directly if provided: `/release patch`, `/release minor`, `/release major`.

## Step 2 — Verify you are on main and clean

```bash
git checkout main
git pull
git status
```

If there are uncommitted changes, stop and tell the user to commit or stash them first.

## Step 3 — Confirm current version

```bash
node -p "require('./package.json').version"
```

Show the user: "Current version is X.Y.Z — this will bump to A.B.C. Proceed?"

Wait for confirmation before continuing.

## Step 4 — Trigger the Release workflow

```bash
gh workflow run release.yml --field bump=<patch|minor|major>
```

Then watch the run start:

```bash
gh run list --workflow=release.yml --limit=1
```

## Step 5 — Watch the Release workflow

```bash
gh run watch <run-id>
```

The workflow will:
- Run `typecheck`, `build`, `test` in CI
- Bump version in `package.json` and `src/cli/index.ts`
- Push branch `chore/bump-vX.Y.Z`
- Open a PR automatically (requires "Allow GitHub Actions to create and approve pull requests" enabled in repo Settings → Actions → General)

If the workflow fails at "Push branch and open PR" with `createPullRequest` permission error:
- The branch was still pushed — create the PR manually:
  ```bash
  gh pr create --title "Bump version to X.Y.Z" \
    --body "Automated version bump. Merging triggers tag creation and npm publish." \
    --base main --head chore/bump-vX.Y.Z
  ```
- Remind the user to enable: Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"

## Step 6 — Show the bump PR

```bash
gh pr list --head chore/bump-v --limit=1
```

Show the PR URL and tell the user:

> PR is open. Once CI passes, merge it to trigger the tag and npm publish automatically.

## Step 7 — After the user merges the bump PR

Pull main and verify:

```bash
git checkout main && git pull
node -p "require('./package.json').version"
```

Then watch `tag-on-merge.yml` fire:

```bash
gh run list --workflow=tag-on-merge.yml --limit=1
```

Watch it complete:

```bash
gh run watch <run-id>
```

## Step 8 — Watch npm publish

Once `tag-on-merge.yml` creates the release, `publish.yml` fires automatically:

```bash
gh run list --workflow=publish.yml --limit=1
gh run watch <run-id>
```

## Step 9 — Confirm release is live

```bash
gh release view vX.Y.Z
```

Tell the user:

> `@aiagentflow/cli@X.Y.Z` is published to npm.
> Release: https://github.com/aiagentflow/aiagentflow/releases/tag/vX.Y.Z

---

## Known gotchas

| Problem | Cause | Fix |
|---------|-------|-----|
| `createPullRequest` error in workflow | Repo setting not enabled | Settings → Actions → General → enable "Allow GitHub Actions to create and approve pull requests" |
| `tag-on-merge` skips tag creation | Merge commit message doesn't contain `chore/bump-v` | Check that the bump branch was named `chore/bump-vX.Y.Z` |
| Orphaned tag pointing to wrong commit | Cancelled/failed push to main | `git push origin --delete refs/tags/vX.Y.Z` then re-run |
| Release workflow bumps wrong version | Triggered twice or on wrong base | Cancel duplicate with `gh run cancel <id>` before it commits |
