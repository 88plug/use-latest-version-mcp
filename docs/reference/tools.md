# Tool Reference

15 MCP tools. Arguments marked _(optional)_ have safe defaults.

`registry` accepts any of the 39 [supported registry ids](registries.md)
(tool schemas use the canonical id; the server also accepts the aliases listed
on the registries page when resolving clients).

## At a glance

| Tool | Writes? | Purpose |
|---|---|---|
| `get_latest_version` | no | Latest version for one package |
| `get_package_info` | no | Latest version + description, homepage, publish date |
| `get_install_command` | no | Install command at latest version |
| `compare_versions` | no | Your pin vs latest (`update-available` / `up-to-date` / `ahead-of-latest`) |
| `check_multiple_packages` | no | Batch latest-version check |
| `check_compatibility` | no | Does `version` satisfy constraints? |
| `detect_conflicts` | no | Incompatible constraints in a dependency list |
| `find_compatible_version` | no | Highest published version that satisfies constraints |
| `suggest_upgrade_path` | no | Step-by-step multi-major path |
| `scan_project` | no | Inventory manifests and lock files |
| `check_outdated` | no | Project outdated report (type + risk) |
| `resolve_conflicts` | no | Project conflict detection + suggested resolution |
| `optimize_versions` | no | Whole-project upgrade plan |
| `validate_upgrade_plan` | no | Pre-flight gate on a plan |
| `apply_upgrades` | **yes** (opt-in) | Apply plan; **`dry_run: true` by default** |

## Lookup

### `get_latest_version`

Latest version of a package.

- `package_name` (string) — format depends on registry (e.g. `groupId:artifactId`
  for Maven, `owner/repo` for GitHub)
- `registry` (string) — one of the [supported registries](registries.md)

### `get_package_info`

Latest version plus description, homepage, and publish date when the registry
exposes them.

- `package_name` (string)
- `registry` (string)

### `get_install_command`

Ready-to-use install command for the package at its latest version
(`npm install …`, `pip install …`, `cargo add …`, etc.).

- `package_name` (string)
- `registry` (string)
- `dev` _(boolean, optional, default false)_ — dev dependency (npm)

### `compare_versions`

Semver comparison of a version you hold against the latest. Reports
`update-available` / `up-to-date` / `ahead-of-latest`. Handles `v`-prefixes.

- `package_name` (string)
- `current_version` (string)
- `registry` (string)

### `check_multiple_packages`

Batch latest-version check; per-item success/error.

- `packages` (array of `{ package_name, registry }`)

## Version reasoning

### `check_compatibility`

Does `version` satisfy each given constraint?

- `package_name` (string)
- `version` (string)
- `dependencies` (array of `{ name, constraint }`)

### `detect_conflicts`

Find packages required at incompatible versions.

- `dependencies` (array of `{ name, constraint, source? }`)

### `find_compatible_version`

Highest published version satisfying all constraints.

- `package_name` (string)
- `registry` (string)
- `constraints` (array of `{ name, constraint }`)

### `suggest_upgrade_path`

Step-by-step path from current to target (defaults to latest), stepping through
intermediate majors, with risk and breaking-change notes.

- `package_name` (string)
- `registry` (string)
- `current_version` (string)
- `target_version` _(string, optional)_ — defaults to latest
- `dependencies` _(array of `{ name, constraint }`, optional)_ — must stay compatible

## Project tools

### `scan_project`

Inventory dependency manifests (`package.json`, `requirements.txt`, `go.mod`,
`Cargo.toml`, `Gemfile`, `pom.xml`, `pyproject.toml`, …) and lock files.

- `project_path` (string, absolute)
- `include_lock_files` _(boolean, optional, default true)_
- `max_depth` _(number, optional, default 10)_

### `check_outdated`

Scan a project and check every dependency against its registry. Reports outdated
packages with upgrade type (major/minor/patch) and estimated risk.

- `project_path` (string, absolute)
- `include_dev` _(boolean, optional, default true)_
- `include_lock_files` _(boolean, optional, default true)_

### `resolve_conflicts`

Detect version conflicts in a project (same package at incompatible versions
across files) and suggest a compatible resolution per package. Read-only.

- `project_path` (string, absolute)
- `include_lock_files` _(boolean, optional, default true)_
- `allow_downgrade` _(boolean, optional, default false)_
- `prefer_latest` _(boolean, optional, default true)_

### `optimize_versions`

Whole-project upgrade plan (per dependency: `keep` / `upgrade` / `downgrade` /
`remove`, with risk). Read-only. Feed the result to `validate_upgrade_plan` and
`apply_upgrades`.

- `project_path` (string, absolute)
- `include_lock_files` _(boolean, optional, default true)_
- `allow_downgrade` _(boolean, optional, default false)_
- `prefer_latest` _(boolean, optional, default true)_

### `validate_upgrade_plan`

Check a plan for breaking (major) bumps, circular dependencies, and constraint
violations before applying. Read-only.

- `project_path` (string, absolute)
- `plan` (array of plan items, as from `optimize_versions`)
- `allow_major_version_changes` _(boolean, optional, default true)_
- `strict_mode` _(boolean, optional, default false)_ — fail on warnings too

### `apply_upgrades`

Apply a plan to the project's dependency manifests (`package.json`,
`requirements.txt`, `Cargo.toml`, `go.mod`, `pom.xml`, and other supported
formats).

**This is the only tool that can write to disk.**

- `project_path` (string, absolute)
- `plan` (array of plan items)
- `dry_run` _(boolean, optional, **default true**)_ — preview only; pass
  `false` to write
- `create_backup` _(boolean, optional, default true)_ — when writing, back up
  each file under `.dependency-backups/` first; ignored when `dry_run` is true

Recommended flow:

1. `optimize_versions` → plan
2. `validate_upgrade_plan` → confirm safe
3. `apply_upgrades` with default `dry_run: true` → review preview
4. `apply_upgrades` with `dry_run: false` → write (with backups)

Absolute paths in `affectedFiles` are normalized to project-relative before
apply. On write error, per-file changes roll back.

#### Plan item shape

```json
{
  "package": "express",
  "registry": "npm",
  "currentVersion": "4.18.0",
  "currentConstraint": "^4.18.0",
  "suggestedVersion": "4.21.2",
  "suggestedConstraint": "^4.21.2",
  "action": "upgrade",
  "reason": "patch available",
  "risk": "low",
  "affectedFiles": ["package.json"]
}
```

| Field | Required | Notes |
|---|---|---|
| `package` | yes | Package name |
| `suggestedVersion` | yes | Target version, or `"removed"` to drop |
| `action` | yes | `keep` \| `upgrade` \| `downgrade` \| `remove` |
| `affectedFiles` | yes | Paths relative to `project_path` |
| `registry` | no | Registry id |
| `currentVersion` | no | May be empty if unknown |
| `currentConstraint` | no | Current constraint string |
| `suggestedConstraint` | no | Defaults to `suggestedVersion` when writing |
| `reason` | no | Why this change is suggested |
| `risk` | no | `low` \| `medium` \| `high` |

## Prompts and resources

The server also exposes MCP prompts (`check-versions-reminder`,
`verify-package-version`) and a registries resource so clients can remind the
model to check versions and list supported registries. Tools are the primary
interface.
