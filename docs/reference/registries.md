# Supported Registries

**39** registries. Pass the canonical registry id as the `registry` argument on
lookup and project tools. Aliases below are also accepted by the registry client
layer when resolving a package.

The **package name format** column notes anything non-obvious.

## Language package managers

| Registry | Aliases | Package name format |
|---|---|---|
| `npm` | | `package` or `@scope/package` |
| `pypi` | `python` | `package` |
| `maven` | | `groupId:artifactId` |
| `crates` | `crates.io`, `rust` | `crate` |
| `rubygems` | `gem`, `ruby` | `gem` |
| `go` | `golang` | module path |
| `nuget` | `.net`, `dotnet` | `Package.Id` |
| `packagist` | `php`, `composer` | `vendor/package` |
| `hex` | `elixir` | `package` |
| `pub.dev` | `pub`, `dart`, `flutter` | `package` |
| `cran` | `r` | `package` |
| `cpan` | `perl` | `Module::Name` |
| `clojars` | `clojure` | `group/artifact` |
| `hackage` | `haskell` | `package` |
| `dub` | `dlang`, `d` | `package` |
| `luarocks` | `lua` | `manifest/package` |
| `elm` | | `author/package` |
| `swift` | `spm` | `owner/repo` |
| `jsr` | `deno` | `@scope/package` |
| `conda` | `anaconda` | `package` |
| `bioconductor` | `bioc` | `package` |

## Containers

| Registry | Aliases | Package name format |
|---|---|---|
| `dockerhub` | `docker` | `[namespace/]image` |
| `ghcr` | `ghcr.io` | `owner/package` |
| `quay` | `quay.io` | `namespace/repository` |
| `gcr` | `gcr.io` | `project/image` |

## Source forges

| Registry | Package name format |
|---|---|
| `github` | `owner/repo` |
| `gitlab` | `namespace/project` |

## OS / system package managers

| Registry | Aliases | Package name format |
|---|---|---|
| `homebrew` | `brew` | `formula` |
| `aur` | `arch` | `package` |
| `snap` | `snapcraft` | `package` |
| `flatpak` | `flathub` | `app.id` |
| `chocolatey` | `choco` | `package` |
| `cocoapods` | `pods` | `Pod` |

## Build / infra / ecosystem

| Registry | Aliases | Package name format |
|---|---|---|
| `gradle` | | plugin id |
| `terraform` | `tf` | `namespace/name/provider` |
| `ansible` | `galaxy` | `namespace.collection` |
| `vscode` | `vscode-extensions` | `publisher.extension` |
| `wordpress` | `wp` | plugin slug |
| `jenkins` | | plugin id |

!!! note "GitHub API rate limits"
    `github`, `ghcr`, and `swift` use the GitHub API. Set `GITHUB_TOKEN` to raise
    rate limits. It is never required for basic use.

!!! tip "Resilience"
    Every registry call has a per-request timeout (`REGISTRY_TIMEOUT_MS`, default
    15s), response caching (`REGISTRY_CACHE_TTL_MS`, default 5 min), retries with
    exponential backoff, and a per-registry circuit breaker. Client errors
    (including 404) do not trip the breaker. See [Configuration](../configuration.md).
