# Tool Reference

15 tools. Arguments marked _(optional)_ have safe defaults. `registry` accepts
any of the [supported registries](registries.md) (and their aliases).

## Lookup

### `get_latest_version`
Latest version of a package.
- `package_name` (string) — format depends on registry (e.g. `groupId:artifactId` for Maven, `owner/repo` for GitHub).
- `registry` (string)

### `get_package_info`
Latest version plus description, homepage, and publish date when available.
- `package_name` (string), `registry` (string)

### `get_install_command`
Ready-to-use install command for the package at its latest version.
- `package_name` (string), `registry` (string)
- `dev` _(boolean, optional)_ — dev dependency (npm).

### `compare_versions`
Semver comparison of a version you hold against the latest. Reports
`update-available` / `up-to-date` / `ahead-of-latest`.
- `package_name` (string), `current_version` (string), `registry` (string)

### `check_multiple_packages`
Batch latest-version check; per-item success/error.
- `packages` (array of `{ package_name, registry }`)

## Version reasoning (no network for the pure-semver tools)

### `check_compatibility`
Does `version` satisfy each given constraint?
- `package_name` (string), `version` (string)
- `dependencies` (array of `{ name, constraint }`)

### `detect_conflicts`
Find packages required at incompatible versions.
- `dependencies` (array of `{ name, constraint, source? }`)

### `find_compatible_version`
Highest published version satisfying all constraints.
- `package_name` (string), `registry` (string)
- `constraints` (array of `{ name, constraint }`)

### `suggest_upgrade_path`
Step-by-step path from current to target (defaults to latest), stepping through
intermediate majors, with risk and breaking-change notes.
- `package_name` (string), `registry` (string), `current_version` (string)
- `target_version` _(string, optional)_, `dependencies` _(array, optional)_

## Project tools

### `scan_project`
Inventory every dependency manifest and lock file.
- `project_path` (string, absolute)
- `include_lock_files` _(boolean, optional, default true)_
- `max_depth` _(number, optional, default 10)_

### `check_outdated`
Scan a project and check every dependency against its registry; reports
outdated packages with upgrade type and risk.
- `project_path` (string)
- `include_dev` _(boolean, optional, default true)_
- `include_lock_files` _(boolean, optional, default true)_

### `resolve_conflicts`
Detect version conflicts in a project and suggest a compatible resolution per
package. Read-only.
- `project_path` (string)
- `include_lock_files` _(optional)_, `allow_downgrade` _(optional, default false)_, `prefer_latest` _(optional, default true)_

### `optimize_versions`
Whole-project upgrade plan (per dependency: keep / upgrade / downgrade / remove,
with risk). Read-only. Feed the result to `validate_upgrade_plan` / `apply_upgrades`.
- `project_path` (string)
- `include_lock_files` _(optional)_, `allow_downgrade` _(optional)_, `prefer_latest` _(optional)_

### `validate_upgrade_plan`
Check a plan for breaking (major) bumps, circular dependencies, and constraint
violations before applying. Read-only.
- `project_path` (string)
- `plan` (array of plan items, as from `optimize_versions`)
- `allow_major_version_changes` _(optional, default true)_, `strict_mode` _(optional, default false)_

### `apply_upgrades`
Apply a plan to the project's manifests (package.json, requirements.txt,
Cargo.toml, go.mod, pom.xml, ...).
- `project_path` (string)
- `plan` (array of plan items)
- `dry_run` _(boolean, optional, **default true** — pass `false` to write)_
- `create_backup` _(boolean, optional, default true)_

A plan item is: `{ package, registry, currentVersion?, currentConstraint?,
suggestedVersion, suggestedConstraint?, action, reason?, risk?, affectedFiles }`
where `action` is one of `keep | upgrade | downgrade | remove` and
`affectedFiles` are paths relative to `project_path`.
