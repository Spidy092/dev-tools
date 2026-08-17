# Contributing to DevToolkit

Thanks for helping improve DevToolkit. The project welcomes bug fixes, accessibility improvements, documentation, tests, performance work, and useful developer tools.

## Before you start

- Search existing issues before opening a new one.
- For small fixes, you can open a pull request directly.
- For large architectural changes or major new tools, open a feature/tool request first so effort is not duplicated.
- Security vulnerabilities should follow `SECURITY.md`, not a public issue.

## Development setup

```bash
git clone https://github.com/Spidy092/dev-tools.git
cd dev-tools/php-protector
npm ci
cp .env.example .env
npm test
npm start
```

Open `http://localhost:3000`.

## Project architecture

The application intentionally uses Express + EJS + modular vanilla JavaScript.

Important locations:

- `php-protector/web/tool-registry.js` — canonical tool metadata/workflow registry
- `php-protector/web/routes/` — HTTP processing endpoints
- `php-protector/core/` — processor implementations
- `php-protector/views/` — EJS pages
- `php-protector/views/partials/tool-workflow.ejs` — shared batch workflow UI
- `php-protector/public/js/tool-runner-v2.js` — shared queue/process/results runner
- `php-protector/tests/` — security, runtime, jobs, and integration tests

## Adding a new tool

New tools should fit the product instead of creating an isolated mini-application.

A normal tool contribution should:

1. Add tool metadata and workflow configuration to `web/tool-registry.js`.
2. Add a processing route under `web/routes/`.
3. Add only unique configuration UI in its EJS view.
4. Reuse the shared queue/progress/results workflow.
5. Support one file, multiple files, and/or folders where the underlying operation makes sense.
6. Validate untrusted paths and inputs.
7. Enforce appropriate resource limits.
8. Emit the shared job progress lifecycle.
9. Add integration tests.
10. Update README/roadmap documentation when appropriate.

Avoid copying the entire workflow markup or building a second queue implementation.

## Security expectations

All uploads, filenames, relative paths, metadata, PDFs, images, and source code must be treated as untrusted.

Do not:

- build shell command strings from user input
- write client paths directly into archives without validation
- disable processor resource limits for convenience
- render uploaded filenames through `innerHTML`
- expose raw production errors to users
- describe server-side processing as browser-local

For subprocesses, prefer argument arrays with `shell: false` and explicit timeouts.

## UI/UX expectations

DevToolkit aims for a clean, consistent developer experience.

- Reuse the existing design primitives.
- Keep tool pages focused on their unique configuration.
- Preserve keyboard/accessibility behavior.
- Provide clear loading, failure, retry, and result states.
- Avoid unnecessary animations, gradients, and decorative complexity.
- Do not introduce React or another framework for a contribution that can use the existing stack cleanly.

## Testing

Run the full suite before submitting:

```bash
cd php-protector
npm test
```

A change that adds or fixes behavior should generally add a regression test.

Useful test categories:

- path/input validation
- endpoint HTTP behavior
- single and bulk processing
- failure behavior
- cancellation/job lifecycle
- EJS renderability
- security regressions

## Commit and pull request guidance

Keep commits understandable and scoped. A PR should explain:

- what problem it solves
- what changed
- how it was tested
- security/resource implications for processors
- screenshots for meaningful UI changes

Do not mix unrelated refactors into a small bug fix.

## What makes a good tool proposal?

Strong proposals answer:

- What repetitive developer problem does it solve?
- Who would use it?
- Why is bulk/folder support useful?
- Can it run safely on untrusted input?
- What dependencies would it add?
- What resource limits are needed?

## First-time contributors

You do not need to know the entire codebase. Documentation fixes, tests, small accessibility improvements, and contained tool enhancements are excellent first contributions.

If an issue is unclear, ask questions before spending significant time implementing it.

## Code of Conduct

By participating, you agree to follow `CODE_OF_CONDUCT.md`.
