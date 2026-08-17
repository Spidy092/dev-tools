# Security

## Reporting a vulnerability

Please do not publish exploit details in a public issue. Report security-sensitive findings privately to the repository owner through GitHub's available private security reporting/contact mechanism.

Include the affected tool, reproduction steps, impact, and any proposed mitigation.

## File-processing threat model

DevToolkit accepts untrusted files. Public deployments should assume filenames, archive paths, image metadata, PDFs, source code, and file contents may be malicious.

The application therefore:

- validates client-provided relative paths before using them in ZIP entries
- enforces per-file and aggregate upload limits
- invokes Ghostscript without a shell
- limits decoded image pixels
- uses temporary per-job upload directories
- automatically cleans stale processing files
- applies Helmet/CSP and production HSTS
- rate-limits application requests
- avoids rendering uploaded filenames as HTML in the current shared processing workflow

## Production requirements

Do not expose a development process directly to the internet. Use:

- HTTPS
- reverse-proxy request body limits
- a dedicated non-root service account
- container/process CPU and memory limits
- restricted temporary filesystem permissions
- regular dependency updates and vulnerability scanning
- production error logging that is not shown directly to users

## Remaining hardening work

Before high-volume public deployment, move expensive jobs into isolated workers, add persistent/centralized job state when horizontally scaling, add cancellation/timeouts per processor, and introduce broader integration/end-to-end security tests.
