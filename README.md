# DevToolkit

> Open-source bulk developer utilities for files, images, PDFs, source code, and everyday developer workflows.

[![CI](https://github.com/Spidy092/dev-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/Spidy092/dev-tools/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Spidy092/dev-tools?style=social)](https://github.com/Spidy092/dev-tools/stargazers)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

DevToolkit is a self-hostable developer utility suite built around one consistent workflow:

**Select → Review → Configure → Process → Results**

It supports single files, multiple files, and complete folders. The application uses **Express + EJS + modular vanilla JavaScript** to stay approachable for contributors.

## Website

The project landing site is designed for GitHub Pages and lives in [`docs/`](docs/).

After GitHub Pages is enabled with **GitHub Actions** as the source, the expected public URL is:

`https://spidy092.github.io/dev-tools/`

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

> PHP Protector performs **obfuscation, not cryptographic encryption**.

## Quick start

### Requirements

- Node.js 18.18+ (Node 20 recommended)
- npm
- Ghostscript (`gs`) for PDF compression
- a Sharp-compatible runtime for image tools

### Install

```bash
git clone https://github.com/Spidy092/dev-tools.git
cd dev-tools
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
│   ├── ISSUE_TEMPLATE/
│   ├── workflows/
│   ├── CODEOWNERS
│   └── dependabot.yml
├── cli/                    # Command-line entrypoint
├── core/                   # Processing engines
├── docs/                   # GitHub Pages project website
├── public/
│   ├── css/                # Application styles
│   └── js/                 # Shared browser modules
├── tests/                  # Security/runtime/job/integration tests
├── views/
│   ├── partials/           # Shared EJS components
│   └── *.ejs               # Tool views
├── web/
│   ├── routes/             # Processing endpoints
│   ├── app.js              # Express app/runtime lifecycle
│   ├── multer-setup.js     # Upload/temp lifecycle
│   ├── security.js         # Path/input safety
│   └── tool-registry.js    # Tool catalog source of truth
├── package.json
├── package-lock.json
├── README.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── DEPLOYMENT.md
├── ROADMAP.md
├── CHANGELOG.md
└── LICENSE
```

## Adding a new tool

A normal tool contribution should:

1. Add metadata/workflow config to `web/tool-registry.js`.
2. Add processing logic under `core/` when needed.
3. Add an HTTP route under `web/routes/`.
4. Add only tool-specific controls to its EJS view.
5. Reuse the shared queue/progress/results workflow.
6. Add integration/security tests under `tests/`.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture principles

- Support single + multi + folder workflows where sensible.
- Prefer shared primitives over duplicated tool-specific UI.
- Treat uploads and paths as untrusted.
- Keep processor limits explicit.
- Be accurate about server-side processing and privacy.
- Keep the codebase easy for open-source contributors to understand.

## Privacy

Files selected in the web app are uploaded temporarily to the running DevToolkit server for processing. They are **not processed purely in your browser**. Runtime upload/temp directories are cleaned automatically and ignored by Git.

For sensitive workloads, self-host DevToolkit in an environment you control.

## Production deployment

Use HTTPS, reverse-proxy body limits, a non-root service account, CPU/memory constraints, restricted temporary storage, and `NODE_ENV=production`.

See [DEPLOYMENT.md](DEPLOYMENT.md) and [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. Good ways to help include bug fixes, tests, documentation, accessibility improvements, performance work, and useful new developer tools.

Read [CONTRIBUTING.md](CONTRIBUTING.md) and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Roadmap

The long-term goal is to make DevToolkit a trusted open-source toolbox that can grow into dozens of useful developer utilities without becoming messy.

See [ROADMAP.md](ROADMAP.md).

## License

DevToolkit is licensed under the [MIT License](LICENSE).

## Support the project for free

If DevToolkit saves you time:

1. ⭐ Star the repository.
2. Share it with developers who may find it useful.
3. Open high-quality bug reports and tool ideas.
4. Contribute fixes, tests, docs, or new tools.

Genuine users and contributors are the best way to grow the project.
