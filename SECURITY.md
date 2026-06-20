# Security Policy

`use-latest-version-mcp` is local-first and designed to run on your own machine
as an MCP server.

## What it does and does not do

- It makes outbound HTTPS calls to a fixed set of public package registries. The
  package name you pass becomes a path/query component of those registry URLs;
  it is never used to construct an arbitrary host.
- It reads dependency manifests and lock files under a `project_path` you
  provide.
- The only tool that writes to disk is `apply_upgrades`. It defaults to a **dry
  run**, writes only to dependency manifests under `project_path`, backs up every
  file it touches to `.dependency-backups/`, and rolls back on error.
- It stores no credentials. The only secret it reads is an optional
  `GITHUB_TOKEN` from the environment, used solely to raise GitHub API rate
  limits. It is never logged or persisted.

## HTTP transport

If you run the optional HTTP transport (`node build/index.js http`), it adds
`helmet` headers and per-IP rate limiting. Lock it down for exposure:

- set `ALLOWED_ORIGINS` to an explicit CORS allow-list,
- set `TRUST_PROXY` appropriately if behind a reverse proxy,
- do not expose it to untrusted networks without an auth layer in front.

## Reporting a vulnerability

Email **andrew@88plug.com** with details and reproduction steps. Please do not
open a public issue for an unpatched vulnerability. If the report concerns path
traversal on `project_path`, an SSRF angle on registry resolution, or unexpected
file writes, say so explicitly in the subject line.
