# Operations Guide

This document explains how the application runs, what it requires, how each feature works, and how to troubleshoot it locally.

## 1. Overview

This project is a local Node.js developer tool suite with:

- A web dashboard and browser UI
- A CLI for PHP obfuscation
- Temporary file-based job processing
- No database
- No authentication system
- No required `.env` file

Main entrypoints:

- Web server: `web/app.js`
- CLI: `cli/index.js`
- Dashboard view: `views/index.ejs`

## 2. Is an env file required?

No.

There is no `dotenv` dependency and no `.env` loader in the codebase.

The only environment variable currently used is:

- `PORT` — optional, used by the web server

If `PORT` is not provided, the app starts at port `3000` and will automatically retry a few higher ports if `3000` is already occupied.

## 3. Runtime Requirements

### Required

- Node.js
- npm
- Installed project dependencies via `npm install`
- Write access to the project directory
- Write access to the `uploads/` directory

### Required only for PDF compression

- Ghostscript installed and accessible on `PATH` as `gs`

### Recommended

- Chromium/Chrome/Edge for best folder drag-and-drop compatibility

## 4. Installation

Install dependencies:

```bash
npm install
```

Start the web app:

```bash
npm start
```

Run the CLI:

```bash
npm run cli -- ./path/to/folder
```

## 5. Dependency Summary

Dependencies are declared in `package.json`.

Key packages:

- `express` — web server
- `ejs` — server-side views
- `multer` — multipart file uploads
- `archiver` — ZIP creation
- `sharp` — image resize/convert engine
- `helmet` — HTTP security headers
- `compression` — response compression
- `express-rate-limit` — request throttling
- `node-cron` — periodic cleanup of temporary uploads
- `commander` — CLI argument parsing
- `chalk` — CLI output formatting

## 6. How the Web App Starts

The `start` script in `package.json` runs:

```bash
node --max-old-space-size=2048 web/app.js
```

That means:

- the Node process starts from `web/app.js`
- the V8 old-space heap limit is set to 2048 MB

Startup flow in `web/app.js`:

1. Creates the Express app
2. Reads optional `PORT`
3. Enables `helmet`
4. Enables `compression`
5. Enables rate limiting
6. Serves static files from `public/`
7. Enables JSON and form parsing
8. Configures EJS templates from `views/`
9. Registers page routes
10. Registers API routes
11. Starts the HTTP server

## 7. Port Handling

The server uses this behavior:

- If `PORT` is set, it uses that port
- If `PORT` is not set, it starts at `3000`
- If `3000` is busy, it retries the next ports automatically

Examples:

```bash
npm start
PORT=3010 npm start
```

## 8. Exposed Web Routes

Page routes:

- `/` → dashboard
- `/php-protector` → PHP Protector UI
- `/image-resizer` → Image Resizer UI
- `/image-converter` → Image Converter UI
- `/pdf-compressor` → PDF Compressor UI

API routes:

- `POST /upload` → PHP protection
- `POST /image-tools/resize` → image resizing
- `POST /image-tools/convert` → image conversion
- `POST /pdf-tools/compress` → PDF compression

## 9. File and Directory Layout

Primary runtime directories:

- `web/` — Express app and API route handlers
- `core/` — feature processing logic
- `views/` — EJS templates
- `public/` — CSS and browser JavaScript
- `cli/` — command-line entrypoint
- `uploads/` — temporary uploaded files for web requests

Supporting or non-core directories:

- `tmp/` — present in repo, not used by active runtime flow
- `webp-test-extract/` — appears to be debugging/test material
- `node_modules/` — installed dependencies

## 10. Upload Pipeline

Uploads are handled by `web/multer-setup.js`.

Behavior:

- Uses `multer.diskStorage`
- Creates one random per-request job folder under `uploads/`
- Prefixes uploaded filenames with a short random token
- Enforces a 100 MB limit per individual file

Job lifecycle:

- files are written to `uploads/<jobId>/`
- route handlers read/process those files
- results are streamed back to the browser
- the job folder is removed when the response finishes or closes
- a cron job also removes stale job folders older than 30 minutes

## 11. Browser-Side Processing Flow

Shared browser workflow is implemented in:

- `public/js/tool-runner.js`
- `public/js/utils.js`

The older PHP-specific drag/drop script is `public/js/drop.js`, but the current PHP page uses the shared runner.

Frontend flow:

1. User selects a file or folder
2. Browser builds `FormData`
3. Files are submitted under `files`
4. Relative paths are submitted under `paths`
5. Server processes each file
6. Browser receives either a single file or ZIP blob
7. Browser triggers download

Bulk folder uploads depend on browser support for folder selection and drag/drop entry traversal.

## 12. Feature: PHP Protector

Relevant files:

- `views/php-protector.ejs`
- `web/routes/php-tools.js`
- `core/obfuscator.js`
- `cli/index.js`

### Web behavior

- Single file upload returns one processed file
- Folder/bulk upload returns `protected.zip`

### CLI behavior

- Recursively scans the input folder
- Writes output to a sibling folder unless `--output` is provided
- Optionally creates a ZIP with `--zip`

### Obfuscation logic

In `core/obfuscator.js`:

- PHP files are read as text
- The content is prefixed with `?>`
- The result is base64-encoded
- The encoded payload is wrapped in:

```php
<?php eval(base64_decode('...'));
```

- Non-PHP files are copied without modification
- Folder structure is preserved exactly

### Limitation

This is obfuscation, not strong encryption. It makes code harder to read but does not provide cryptographic protection.

## 13. Feature: Image Resizer

Relevant files:

- `views/image-resizer.ejs`
- `web/routes/image-tools.js`
- `core/imageProcessor.js`

Processing engine:

- Uses `sharp`

Capabilities:

- width/height resizing
- fit modes: `cover`, `contain`, `fill`, `inside`
- background fill color
- grayscale
- blur
- negate/invert
- sharpen

Response behavior:

- one file in single mode
- ZIP archive in bulk mode

In bulk mode, known image files are transformed; non-image files are copied through unchanged.

## 14. Feature: Image Converter

Relevant files:

- `views/image-converter.ejs`
- `web/routes/image-tools.js`
- `core/imageProcessor.js`

Processing engine:

- Uses `sharp`

Supported output formats in processor:

- `webp`
- `jpeg`
- `png`
- `avif`
- `tiff`

The current UI exposes:

- `webp`
- `jpeg`
- `png`
- `avif`

Additional options:

- quality
- grayscale
- blur
- negate
- sharpen

Bulk mode preserves folder structure and renames processed files to the target extension.

## 15. Feature: PDF Compressor

Relevant files:

- `views/pdf-compressor.ejs`
- `web/routes/pdf-tools.js`
- `core/pdfProcessor.js`

Processing engine:

- Uses Ghostscript via `child_process.exec`

Supported quality levels:

- `/screen`
- `/ebook`
- `/printer`
- `/prepress`

Behavior:

- single PDF returns a processed PDF
- bulk mode returns a ZIP archive
- non-PDF files in a bulk upload are copied through unchanged

### Important requirement

PDF compression only works if the `gs` executable is installed and available on `PATH`.

## 16. CLI Usage

Entrypoint: `cli/index.js`

Examples:

```bash
npm run cli -- ./my-project
npm run cli -- ./my-project --zip
npm run cli -- ./my-project --output ./custom-output
```

CLI validations:

- input path must exist
- input path must be a directory

CLI output:

- logs copied files
- logs obfuscated PHP files
- reports output folder
- optionally produces a ZIP archive

## 17. Filesystem Assumptions

The app assumes:

- the project directory is writable
- `uploads/` can be created or written to
- temporary files can be deleted after processing
- output ZIP streams can be produced in memory/streamed to the client

The app does not require:

- database storage
- object storage
- cache servers
- external queue workers

## 18. Request Limits and Constraints

Current operational constraints from the code:

- 100 MB per uploaded file
- 30 requests per minute per IP
- no background queue for processing
- processing happens inline during the request
- large jobs may consume significant CPU/RAM depending on file count and size

## 19. Error Handling Model

Each route generally:

- validates whether files were uploaded
- attempts single-file or bulk processing
- returns HTTP 400 when no files are received
- returns HTTP 500 when processing fails
- finalizes the archive or response on errors where possible

PDF bulk mode has fallback behavior:

- if an individual PDF compression fails, the original PDF is added to the ZIP instead

## 20. Security Characteristics

Present:

- `helmet` headers
- rate limiting
- temporary upload isolation per job
- cleanup of stale upload folders

Not present:

- authentication
- user accounts
- antivirus scanning
- MIME signature verification
- CSRF protection
- sandboxed job execution

Note for PHP obfuscation:

- generated PHP uses `eval`
- some hosting/security policies may flag or reject `eval`-based code

## 21. Troubleshooting

### Problem: port 3000 already in use

Run:

```bash
npm start
```

The server now retries the next ports automatically if `PORT` is not explicitly set.

Or force a specific port:

```bash
PORT=3001 npm start
```

### Problem: PDF compression fails

Check Ghostscript:

```bash
which gs
```

If missing, install Ghostscript and ensure `gs` is on `PATH`.

### Problem: uploads fail or disappear

Check:

- directory permissions
- available disk space
- whether the upload exceeds the per-file size limit
- whether the cleanup job removed stale temporary folders

### Problem: folder upload does not work in browser

Check:

- browser support for folder selection / drag-drop entries
- try Chrome/Chromium/Edge
- try the file-picker button instead of drag-and-drop

### Problem: processed PHP is blocked in hosting

Possible cause:

- the host blocks `eval`
- security tooling flags obfuscated PHP payloads

### Problem: image processing errors

Possible causes:

- corrupted input image
- unsupported/invalid image content
- native module issues with `sharp`

## 22. What Is Not Used by Core Runtime

These are present in the repository but are not part of the main startup path:

- `debug-webp.js` — manual/debug helper script
- `webp-test-extract/` — test/debug material
- `tmp/` — not referenced by active runtime code

## 23. Minimal Local Run Checklist

Use this checklist for a fresh machine:

1. Install Node.js and npm
2. Install Ghostscript if you want PDF compression
3. Clone or extract the project
4. Run `npm install`
5. Run `npm start`
6. Open the printed localhost URL
7. Test each tool from the browser
8. Use `npm run cli -- ./your-folder` for CLI PHP obfuscation

## 24. Practical Summary

You need these things for a full working local setup:

- Node.js
- npm
- installed dependencies
- writable project folder
- writable `uploads/` folder
- Ghostscript for PDF support
- a modern browser for folder upload UX

You do not need:

- a `.env` file
- a database
- API credentials
- Docker
- Redis
- a build step
