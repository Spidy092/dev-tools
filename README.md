# DevToolkit

> Open-source bulk developer utilities for files, images, PDFs, source code, and everyday developer workflows.

[![CI](https://github.com/Spidy092/dev-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/Spidy092/dev-tools/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Spidy092/dev-tools?style=social)](https://github.com/Spidy092/dev-tools/stargazers)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

DevToolkit is a self-hostable developer utility suite designed around one consistent workflow:

**Select → Review → Configure → Process → Results**

It works with one file, many files, or complete folders. The project intentionally stays on **Express + EJS + modular vanilla JavaScript** so contributors can understand and extend it without a heavy frontend framework.

## Why DevToolkit?

Developers repeatedly need small utilities: resize images, compress PDFs, rename hundreds of files, minify a codebase, convert formats, or process a whole project directory. DevToolkit brings those tasks into one consistent interface with bulk/folder support instead of requiring a different website or CLI for every operation.

If DevToolkit saves you time, **please star the repository**. Stars help other developers discover the project and are one of the easiest ways to support an open-source project for free.

## Current tools

| Tool | What it does | Bulk/folder support |
|---|---|---|
| PHP Protector | Obfuscates PHP source while preserving project structure | Yes |
| Image Resizer | Resizes images with safe dimension controls | Yes |
| Image Converter | Converts common/modern image formats | Yes |
| Image Compressor | Compresses and optimizes images | Yes |
| PDF Compressor | Compresses PDFs through guarded Ghostscript execution | Yes |
| Smart File Renamer | Applies reusable rename and organization rules | Yes |
| Code Minifier | Minifies HTML, CSS, and JavaScript | Yes |

> PHP Protector performs **obfuscation, not cryptographic encryption**. Do not treat obfuscation as a security boundary.

## Screens and workflow

The UI supports:

- files + folders in the same queue
- drag and drop
- search/filter within large batches
- include/exclude patterns
- review before processing
- processing progress and cancellation
- per-file results
- retries for failed work
- aggregate downloads
- dark/light appearance
- keyboard/command-palette navigation
- dashboard search, categories, favorites, and recent tools

## Quick start

### Requirements

- Node.js 18.18+ (Node 20 recommended)
- npm
- Ghostscript (`gs`) for PDF compression
- a Sharp-compatible runtime for image tools

### Install

```bash
git clone https://github.com/Spidy092/dev-tools.git
cd dev-tools/php-protector
npm ci
cp .env.example .env
npm test
npm start
```

Open `http://localhost:3000`.

## Project structure

```text
dev-tools/
├── .github/
│   ├── ISSUE_TEMPLATE/       # Structured bug/feature/tool requests
│   ├── workflows/            # GitHub Actions CI
│   └── pull_request_template.md
├── php-protector/            # Main application package (historical directory name)
│   ├── core/                 # Processor implementations (Sharp, Ghostscript, obfuscation)
│   ├── public/
│   │   ├── css/              # Enterprise UI, queue, results, discovery styles
│   │   └── js/               # Shared browser modules and tool runner
│   ├── tests/                # Security, runtime, jobs, and HTTP integration tests
│   ├── views/
│   │   ├── partials/         # Reusable EJS app/tool workflow components
│   │   └── *.ejs             # Tool-specific configuration views
│   └── web/
│       ├── routes/            # HTTP processing routes
│       ├── app.js             # Express application/runtime lifecycle
│       ├── multer-setup.js    # Upload limits/temp-file lifecycle
│       ├── security.js        # Path validation and upload safety
│       └── tool-registry.js   # Single source of truth for the tool catalog
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── DEPLOYMENT.md
├── ROADMAP.md
├── SECURITY.md
└── LICENSE
```

The directory `php-protector/` is the historical application root even though DevToolkit now contains multiple tools. A future cleanup may rename it, but avoiding a disruptive path migration keeps this release easier to review and deploy.

## Adding a new tool

A typical new tool requires only four pieces:

1. Add metadata/workflow configuration in `php-protector/web/tool-registry.js`.
2. Add the processing route under `php-protector/web/routes/`.
3. Add a small EJS view containing only that tool's unique options.
4. Add integration/security tests under `php-protector/tests/`.

The shared queue, progress, results, navigation, search, favorites, and command palette should work from the central registry instead of being copied into each tool.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution workflow.

## Architecture principles

- Keep tools useful for **single + multiple + folder/bulk** workflows where sensible.
- Prefer shared primitives over duplicated tool-specific UI.
- Treat all uploaded files and paths as untrusted.
- Keep processing limits explicit.
- Preserve honest product language about server-side file processing.
- Do not add React simply for UI polish; introduce major dependencies only when they solve a real product constraint.
- Keep the project approachable for first-time open-source contributors.

## Privacy

When using the web application, selected files are uploaded to the DevToolkit server temporarily for processing. They are **not processed purely in your browser**. Runtime upload/temp directories are cleaned automatically and ignored by Git.

For sensitive workloads, self-host DevToolkit in an environment you control.

## Production deployment

Do not expose the development server directly to the public internet. Production deployments should use HTTPS, reverse-proxy body limits, a non-root service account, CPU/memory constraints, restricted temporary storage, and `NODE_ENV=production`.

See [DEPLOYMENT.md](DEPLOYMENT.md) and [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome from beginners and experienced developers.

Good ways to help:

- report a reproducible bug
- improve accessibility or UX
- improve docs/tests
- propose a developer utility
- improve an existing bulk workflow
- review open issues/PRs
- share the project with developers who may find it useful

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Roadmap

The long-term goal is to make DevToolkit a trusted open-source toolbox that can grow from a small catalog into dozens of high-quality developer utilities without becoming messy.

See [ROADMAP.md](ROADMAP.md).

## Security

Please **do not publish exploitable security details in a public issue**. Follow the private reporting guidance in [SECURITY.md](SECURITY.md).

## License

DevToolkit is licensed under the [MIT License](LICENSE). You may use, modify, distribute, and build on the project, including commercially, subject to the license terms.

## Support the project for free

If you want DevToolkit to grow:

1. ⭐ Star the repository.
2. Share it with other developers.
3. Open useful bug reports and feature/tool ideas.
4. Contribute fixes, tests, docs, or new tools.
5. Mention DevToolkit when it solves a real problem for you.

Every useful contribution and genuine star improves the project's discoverability.
