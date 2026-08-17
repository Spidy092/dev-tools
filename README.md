# DevToolkit

DevToolkit is a bulk-capable developer utility suite for processing single files, multiple files, and complete folders through a consistent web workflow.

## Current tools

- PHP Protector — basic PHP source obfuscation
- Image Resizer
- Image Converter
- Image Compressor
- PDF Compressor
- Smart File Renamer
- Code Minifier for HTML, CSS, and JavaScript

## Enterprise redesign

The `agent/enterprise-devtool-redesign` work introduces the first enterprise foundation:

- centralized tool registry
- restrained responsive design system
- review-before-process file workflow
- safe filename rendering
- centralized archive path validation
- consistent total-upload enforcement across processing routes
- Ghostscript execution without a shell
- bounded image pixel processing
- production-aware Helmet/HSTS configuration
- buffered SSE progress
- runtime upload/temp cleanup protections
- Node security regression tests
- GitHub Actions CI

## Run locally

```bash
cd php-protector
npm ci
npm test
npm start
```

Then open `http://localhost:3000`.

## Runtime requirements

- Node.js 18.18+
- Ghostscript for PDF compression
- Sharp-compatible native runtime for image processing

## Privacy model

Web-based processing uploads files to the running DevToolkit server temporarily. Runtime upload and temporary directories are automatically swept and are ignored by Git. Do not describe remotely hosted processing as browser-local processing.

## Production guidance

Run behind HTTPS/reverse proxy infrastructure with request-body limits, a non-root application user, CPU/memory limits, restricted temporary storage, and `NODE_ENV=production`.

See `SECURITY.md` and `php-protector/OPERATIONS.md` before exposing the service publicly.
