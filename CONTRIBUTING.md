# Contributing to DevToolkit

Thanks for helping improve DevToolkit. The project welcomes bug fixes, accessibility improvements, documentation, tests, performance work, and useful developer tools.

## Before you start

- Search existing issues before opening a new one.
- For small fixes, you can open a pull request directly.
- For large architectural changes or major new tools, open a feature/tool request first.
- Security vulnerabilities should follow `SECURITY.md`, not a public issue.

## Development setup

```bash
git clone https://github.com/Spidy092/dev-tools.git
cd dev-tools
npm ci
cp .env.example .env
npm test
npm start
```

Open `http://localhost:3000`.

## Project architecture

The application intentionally uses Express + EJS + modular vanilla JavaScript.

Important locations:

- `web/tool-registry.js` — canonical tool metadata/workflow registry
- `web/routes/` — HTTP processing endpoints
- `core/` — processor implementations
- `views/` — EJS pages
- `views/partials/tool-workflow.ejs` — shared batch workflow UI
- `public/js/tool-runner-v2.js` — shared queue/process/results runner
- `tests/` — security, runtime, jobs, and integration tests
- `docs/` — GitHub Pages project website

## Adding a new tool

New tools should fit the product instead of creating an isolated mini-application.

A normal tool contribution should:

1. Add tool metadata and workflow configuration to `web/tool-registry.js`.
2. Add a processing route under `web/routes/`.
3. Add processing logic under `core/` when needed.
4. Add only unique configuration UI in its EJS view.
5. Reuse the shared queue/progress/results workflow.
6. Support one file, multiple files, and/or folders where sensible.
7. Validate untrusted paths and inputs.
8. Enforce appropriate resource limits.
9. Emit the shared job lifecycle.
10. Add integration tests.

Avoid copying the entire workflow markup or building a second queue implementation.

## Security expectations

Treat uploads, filenames, relative paths, metadata, PDFs, images, and source code as untrusted.

Do not:

- build shell command strings from user input
- write client paths into archives without validation
- disable processor limits for convenience
- render uploaded filenames through `innerHTML`
- expose raw production errors
- describe server-side processing as browser-local

For subprocesses, prefer argument arrays with `shell: false` and explicit timeouts.

## UI/UX expectations

- Reuse existing design primitives.
- Keep tool pages focused on unique configuration.
- Preserve keyboard/accessibility behavior.
- Provide clear loading, failure, retry, and result states.
- Avoid unnecessary framework additions.

## Testing

Run the full suite before submitting:

```bash
npm test
```

Behavior changes should generally add a regression test.

Useful categories include path/input validation, endpoint behavior, single/bulk processing, failure states, cancellation/job lifecycle, EJS rendering, and security regressions.

## Pull request guidance

A PR should explain:

- what problem it solves
- what changed
- how it was tested
- security/resource implications
- screenshots for meaningful UI changes

Keep unrelated refactors out of focused fixes.

## First-time contributors

You do not need to know the entire codebase. Docs, tests, accessibility improvements, and contained tool enhancements are excellent first contributions.

## Code of Conduct

By participating, you agree to follow `CODE_OF_CONDUCT.md`.
