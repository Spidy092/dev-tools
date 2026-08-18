# DevToolkit

> Open-source, self-hostable **bulk developer operations** for files, folders, images, PDFs, and code.

[![CI](https://github.com/Spidy092/dev-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/Spidy092/dev-tools/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Spidy092/dev-tools?style=social)](https://github.com/Spidy092/dev-tools/stargazers)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

DevToolkit is built for the point where tiny online utilities become annoying: **real folders, repeated work, large batches, and project-wide operations**.

Instead of learning a different interface for every utility, DevToolkit uses one workflow:

**Select → Review → Configure → Preview → Process → Results**

It supports single files, multiple files, and complete folders. The application uses **Express + EJS + modular vanilla JavaScript** to stay approachable for contributors.

## Why use DevToolkit?

### Bulk and folder workflows

Many developer utilities are excellent for one text box or one file. DevToolkit is designed to make the same operation practical across dozens, hundreds, or thousands of files where the processor supports it.

### Understand the folder before acting

Folder Intelligence summarizes file count, total size, folders, top extensions, largest files, and useful file groups before processing. Dry-run previews then show the planned impact before the operation starts.

### Reusable settings

Per-tool presets can be saved locally, reapplied, exported, and imported as versioned JSON without accounts or cloud storage.

### One consistent interface

A file renamer, duplicate scanner, checksum verifier, image converter, PDF processor, and code tool should not feel like unrelated products. DevToolkit keeps the same queue, review, preview, progress, and result concepts across the catalog.

### Self-hostable

For sensitive project files, run DevToolkit on infrastructure you control rather than depending on unrelated third-party upload sites.

### Open source

DevToolkit is MIT licensed. The code, roadmap, tests, security guidance, and contribution process are public.

## Website

The project landing site lives in [`docs/`](docs/) and is designed for GitHub Pages.

Expected public URL after Pages is enabled and this branch reaches `main`:

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
| Duplicate File Finder | Finds exact duplicate files with size grouping + streaming SHA-256 verification | Yes |
| Checksum & Manifest | Generates SHA-256 project manifests and verifies later snapshots for valid, changed, missing, and new files | Yes |
| Code Minifier | Minifies HTML, CSS, and JavaScript | Yes |

> PHP Protector performs **obfuscation, not cryptographic encryption**.

## File integrity tools

### Duplicate File Finder

Duplicate File Finder is intentionally read-only. It never removes files automatically.

1. Files are grouped by byte size.
2. Unique-size files are skipped without hashing.
3. Only likely duplicate candidates are streamed through SHA-256.
4. Files are reported as duplicates only when both size and SHA-256 match.
5. Recoverable storage is calculated from extra copies while preserving one copy per group.

### Checksum & Manifest

Checksum & Manifest creates a reusable SHA-256 snapshot of a project. Generate mode can download either DevToolkit `manifest.json` or standard `checksums.sha256` text. Verify mode compares a later project snapshot and reports:

- valid files
- changed files
- missing files
- new files

Hashing streams files from disk rather than loading complete large files into Node memory. Verification is read-only. The current browser verification channel intentionally caps imported manifest JSON at about 120 KB to stay within the hardened 128 KB form-field limit; a dedicated large-manifest upload channel is a follow-up improvement.

## Product direction

DevToolkit is not trying to win by listing hundreds of tiny utilities. The product direction is:

- excellent large-folder review and filtering
- dry-run previews before mutating files
- reusable/exportable presets
- folder summaries and result analytics
- high-value bulk tools such as duplicate detection, checksums, metadata removal, PDF merge/split, and project normalization
- eventually, multi-step workflow recipes such as `resize → convert → compress → ZIP`
- browser-local processing for lightweight tools where practical, with clear privacy labels for every tool
- CLI/API automation using the same processing concepts

See [ROADMAP.md](ROADMAP.md) for the prioritized plan.

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

## Privacy

Files selected for server-processed tools are uploaded temporarily to the running DevToolkit server and cleaned automatically. Folder Intelligence and dry-run metadata analysis are client-side. Presets are browser-local unless the user explicitly exports them.

For sensitive workloads, self-host DevToolkit in an environment you control.

We plan to distinguish every tool clearly as **browser-local** or **server-processed** as the catalog grows.

## Production deployment

Use HTTPS, reverse-proxy body limits, a non-root service account, CPU/memory constraints, restricted temporary storage, and `NODE_ENV=production`.

See [DEPLOYMENT.md](DEPLOYMENT.md) and [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. Good ways to help include bug fixes, tests, documentation, accessibility improvements, performance work, and useful new developer tools.

Read [CONTRIBUTING.md](CONTRIBUTING.md) and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

DevToolkit is licensed under the [MIT License](LICENSE).

## Support the project for free

If DevToolkit saves you time:

1. ⭐ Star the repository.
2. Share a real workflow it helped you solve.
3. Open high-quality bug reports and tool ideas.
4. Contribute fixes, tests, docs, or new tools.

Genuine users and contributors are the best way to grow the project.
