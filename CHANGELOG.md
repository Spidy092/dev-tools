# Changelog

All notable changes to DevToolkit will be documented here.

The project uses semantic-style version numbers for public releases:

- **MAJOR** — incompatible behavior or architecture changes users must actively migrate for
- **MINOR** — new tools or meaningful backwards-compatible features
- **PATCH** — bug fixes, security hardening, documentation, and small compatible improvements

## Unreleased

### Added

- enterprise Express/EJS application shell
- shared single/multi/folder processing workflow
- central tool registry
- queue review, progress, cancellation, results, retry, and downloads
- dashboard search, categories, favorites, and recent tools
- health/readiness endpoints and graceful shutdown
- security/runtime/job/integration test suites
- deployment and open-source contributor documentation

### Security

- shell-free Ghostscript execution
- client path validation and traversal protection
- aggregate upload/request limits
- bounded Sharp input/output resource behavior
- temporary upload cleanup protections
- unified cancellable job lifecycle
- safer production headers/errors

### Changed

- PHP source protection is described accurately as obfuscation rather than encryption
- server-side file processing privacy language is explicit
- service-worker strategy no longer caches server-rendered application pages or obsolete runner assets

## Release process

For each public release:

1. Ensure the exact release commit passes CI.
2. Move relevant items from `Unreleased` into a versioned section such as `## 1.0.0 — YYYY-MM-DD`.
3. Create a Git tag such as `v1.0.0`.
4. Create a GitHub Release with a concise user-facing summary.
5. Mention new contributors and major fixes/features.
6. Link upgrade notes when a release changes configuration or deployment requirements.

The first public release should be created only after the enterprise/open-source foundation is merged into `main` and validated from a clean checkout.
